"""DashScope 统一客户端：embed / rerank / chat / responses / files。

基于官方 `dashscope` Python SDK（AioGeneration / TextEmbedding / AioTextReRank）。
启动时设置 `dashscope.base_http_api_url` 与 api_key（工作空间专用域或公网域）。

例外（SDK 尚无对等封装，仍走 HTTP）：
- Responses API（深度研究 web_search / web_extractor）→ compatible-mode `/responses`
- Files file-extract（会话小文档 fileid://）→ compatible-mode `/files`

embedding 结果可缓存至 Redis（键 `emb:v4:{dim}:{sha256}`）。
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from typing import Any, AsyncIterator

import base64
import mimetypes

import dashscope
import httpx
from dashscope import AioGeneration, AioMultiModalConversation, AioTextReRank, TextEmbedding
from loguru import logger
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.core.redis import cache_get_json, cache_set_json


EMBEDDING_BATCH_SIZE = 10
EMBED_CACHE_TTL = 60 * 60  # 1 小时
_RETRYABLE_LLM_ERRORS = (httpx.HTTPError, asyncio.TimeoutError, TimeoutError, ConnectionError)
_FALLBACK_CHAT_MODELS = ("qwen-turbo",)
_DEFAULT_RERANK_INSTRUCT = (
    "Given a Chinese Communist Party history research query, "
    "retrieve the most relevant passages that answer the query."
)
# Qwen3.5+ 统一多模态模型必须走 multimodal-generation，用 Generation 会报 url error
_MULTIMODAL_MODEL_PREFIXES = ("qwen3.5", "qwen3.6", "qwen3.7", "qwen3-5", "qwen3-6", "qwen3-7")


def _is_multimodal_model(model: str) -> bool:
    name = (model or "").strip().lower().replace("_", "-")
    return any(name.startswith(prefix) for prefix in _MULTIMODAL_MODEL_PREFIXES)


def _to_multimodal_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """将纯文本 content 转为 MultiModalConversation 的 [{text}] 列表格式。"""
    out: list[dict[str, Any]] = []
    for msg in messages:
        item = dict(msg)
        content = item.get("content")
        if isinstance(content, str):
            item["content"] = [{"text": content}]
        out.append(item)
    return out


class DashScopeAPIError(RuntimeError):
    """官方 SDK / HTTP 调用失败。"""

    def __init__(self, message: str, *, status_code: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def _model_candidates(primary: str | None) -> list[str]:
    model = primary or settings.chat_model
    candidates = [model]
    for fallback in _FALLBACK_CHAT_MODELS:
        if fallback not in candidates:
            candidates.append(fallback)
    return candidates


def _is_quota_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "quota" in text or "free tier" in text or "freetieronly" in text


def _ensure_sdk_configured() -> None:
    """配置官方 SDK 的 api_key 与 base_http_api_url（等同 dashscope.base_http_api_url = ...）。"""
    dashscope.api_key = settings.dashscope_api_key
    dashscope.base_http_api_url = settings.dashscope_http_api_url.rstrip("/")


def _obj_to_dict(obj: Any) -> Any:
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {k: _obj_to_dict(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_obj_to_dict(v) for v in obj]
    if hasattr(obj, "items"):
        try:
            return {k: _obj_to_dict(v) for k, v in obj.items()}  # type: ignore[arg-type]
        except Exception:
            pass
    if hasattr(obj, "__dict__"):
        raw = {k: v for k, v in vars(obj).items() if not k.startswith("_")}
        if raw:
            return {k: _obj_to_dict(v) for k, v in raw.items()}
    return obj


def _raise_if_failed(resp: Any, *, what: str) -> None:
    status = getattr(resp, "status_code", None)
    if status is None and isinstance(resp, dict):
        status = resp.get("status_code")
    if status is None or int(status) == int(HTTPStatus.OK):
        return
    code = getattr(resp, "code", None) or (resp.get("code") if isinstance(resp, dict) else None)
    message = getattr(resp, "message", None) or (resp.get("message") if isinstance(resp, dict) else None)
    raise DashScopeAPIError(
        f"{what} failed: status={status} code={code} message={message}",
        status_code=int(status) if status is not None else None,
        code=str(code) if code else None,
    )


def _message_fields(output: Any) -> tuple[str, str | None, dict[str, Any] | None, str | None]:
    """从 Generation output 提取 content / reasoning / search_info / finish_reason。"""
    data = _obj_to_dict(output) or {}
    if not isinstance(data, dict):
        return "", None, None, None

    search_info = data.get("search_info")
    if search_info is not None and not isinstance(search_info, dict):
        search_info = _obj_to_dict(search_info)

    choices = data.get("choices") or []
    if not choices:
        text = data.get("text") or ""
        return str(text), None, search_info if isinstance(search_info, dict) else None, data.get(
            "finish_reason"
        )

    choice = choices[0] if isinstance(choices[0], dict) else _obj_to_dict(choices[0])
    if not isinstance(choice, dict):
        return "", None, search_info if isinstance(search_info, dict) else None, None
    finish = choice.get("finish_reason")
    message = choice.get("message") or {}
    if not isinstance(message, dict):
        message = _obj_to_dict(message) or {}
    content = message.get("content") or ""
    if isinstance(content, list):
        content = "".join(
            str(part.get("text") if isinstance(part, dict) else part) for part in content
        )
    reasoning = message.get("reasoning_content") or message.get("reasoning")
    return (
        str(content),
        str(reasoning) if reasoning else None,
        search_info if isinstance(search_info, dict) else None,
        str(finish) if finish else None,
    )


def _normalize_chat_response(resp: Any) -> dict[str, Any]:
    """保持下游兼容的 OpenAI-like choices 结构。"""
    _raise_if_failed(resp, what="chat")
    content, reasoning, search_info, finish = _message_fields(getattr(resp, "output", None))
    message: dict[str, Any] = {"role": "assistant", "content": content}
    if reasoning:
        message["reasoning_content"] = reasoning
    out: dict[str, Any] = {
        "id": getattr(resp, "request_id", None),
        "choices": [{"index": 0, "message": message, "finish_reason": finish or "stop"}],
    }
    usage = _obj_to_dict(getattr(resp, "usage", None))
    if usage:
        out["usage"] = usage
    if search_info:
        out["search_info"] = search_info
    return out


@dataclass
class RerankResult:
    """rerank API 单条结果：index 指向入参 documents 下标。"""

    index: int
    score: float
    text: str | None = None


class DashScopeClient:
    """官方 dashscope SDK 异步封装；对外方法签名保持不变。"""

    def __init__(self) -> None:
        self._http: httpx.AsyncClient | None = None

    def _ensure_http(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(180.0, connect=30.0),
                headers={"Authorization": f"Bearer {settings.dashscope_api_key}"},
            )
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    # --- Embedding（text-embedding-v4）---
    async def embed(
        self,
        texts: list[str] | str,
        *,
        dimensions: int | None = None,
        use_cache: bool = True,
    ) -> list[list[float]]:
        """计算稠密向量；顺序与输入 texts 一致。"""
        if isinstance(texts, str):
            single = True
            input_texts: list[str] = [texts]
        else:
            single = False
            input_texts = list(texts)

        if not input_texts:
            return []

        dim = dimensions or settings.embedding_dim
        results: list[list[float] | None] = [None] * len(input_texts)
        cache_keys: list[str | None] = [None] * len(input_texts)

        if use_cache:
            for i, text in enumerate(input_texts):
                key = f"emb:v4:{dim}:{hashlib.sha256(text.encode('utf-8')).hexdigest()}"
                cache_keys[i] = key
                hit = await cache_get_json(key)
                if hit is not None and isinstance(hit, list):
                    results[i] = hit

        pending = [i for i, r in enumerate(results) if r is None]

        def _embed_batch(batch_texts: list[str]) -> list[list[float]]:
            _ensure_sdk_configured()
            resp = TextEmbedding.call(
                model=settings.embedding_model,
                input=batch_texts,
                dimension=dim,
                api_key=settings.dashscope_api_key,
            )
            _raise_if_failed(resp, what="embed")
            output = _obj_to_dict(getattr(resp, "output", None)) or {}
            embeddings = output.get("embeddings") or []
            by_index: dict[int, list[float]] = {}
            for item in embeddings:
                data = item if isinstance(item, dict) else _obj_to_dict(item)
                if not isinstance(data, dict):
                    continue
                idx = int(data.get("text_index", len(by_index)))
                emb = data.get("embedding") or []
                by_index[idx] = list(emb)
            return [by_index.get(i, [0.0] * dim) for i in range(len(batch_texts))]

        for start in range(0, len(pending), EMBEDDING_BATCH_SIZE):
            batch_idx = pending[start : start + EMBEDDING_BATCH_SIZE]
            batch_texts = [input_texts[i] for i in batch_idx]
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(4),
                wait=wait_exponential(multiplier=1, min=2, max=15),
                retry=retry_if_exception_type(_RETRYABLE_LLM_ERRORS + (DashScopeAPIError,)),
                reraise=True,
            ):
                with attempt:
                    vectors = await asyncio.to_thread(_embed_batch, batch_texts)
            for j, vec in enumerate(vectors):
                idx = batch_idx[j]
                results[idx] = vec
                if use_cache and cache_keys[idx]:
                    try:
                        await cache_set_json(cache_keys[idx], results[idx], EMBED_CACHE_TTL)
                    except Exception as e:
                        logger.debug("embedding cache set failed: {}", e)

        out = [r if r is not None else [0.0] * dim for r in results]
        return out[0:1] if single else out

    # --- Rerank（qwen3-rerank）---
    async def rerank(
        self,
        query: str,
        documents: list[str],
        *,
        top_n: int | None = None,
        instruct: str | None = None,
    ) -> list[RerankResult]:
        """对 documents 按与 query 的相关性重排。"""
        if not documents:
            return []

        _ensure_sdk_configured()
        kwargs: dict[str, Any] = {
            "model": settings.rerank_model,
            "query": query,
            "documents": documents,
            "return_documents": True,
            "api_key": settings.dashscope_api_key,
            "instruct": instruct or _DEFAULT_RERANK_INSTRUCT,
        }
        if top_n is not None:
            kwargs["top_n"] = min(top_n, len(documents))

        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(4),
            wait=wait_exponential(multiplier=1, min=2, max=15),
            retry=retry_if_exception_type(_RETRYABLE_LLM_ERRORS + (DashScopeAPIError,)),
            reraise=True,
        ):
            with attempt:
                resp = await AioTextReRank.call(**kwargs)
                _raise_if_failed(resp, what="rerank")

        output = _obj_to_dict(getattr(resp, "output", None)) or {}
        results = output.get("results") or []
        out: list[RerankResult] = []
        for item in results:
            data = item if isinstance(item, dict) else _obj_to_dict(item)
            if not isinstance(data, dict):
                continue
            idx = int(data.get("index", -1))
            score = float(data.get("relevance_score", data.get("score", 0.0)))
            doc = data.get("document")
            text = None
            if isinstance(doc, dict):
                text = doc.get("text")
            elif isinstance(doc, str):
                text = doc
            out.append(RerankResult(index=idx, score=score, text=text))
        return out

    # --- Chat（Generation 或 MultiModalConversation）---
    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str | None = None,
        temperature: float | None = None,
        enable_search: bool = False,
        search_strategy: str = "agent_max",
        forced_search: bool = False,
        extra_body: dict[str, Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """流式对话；产出 delta / reasoning / search_info / done。

        qwen3.5/3.6 等统一多模态模型走 AioMultiModalConversation，其余走 AioGeneration。
        """
        _ensure_sdk_configured()
        kwargs: dict[str, Any] = {
            "messages": messages,
            "result_format": "message",
            "stream": True,
            "incremental_output": True,
            "api_key": settings.dashscope_api_key,
        }
        if temperature is not None:
            kwargs["temperature"] = temperature
        if enable_search:
            kwargs["enable_search"] = True
            kwargs["search_options"] = {
                "search_strategy": search_strategy,
                "forced_search": forced_search,
                "enable_source": True,
            }
        if extra_body:
            # 兼容旧调用方把 enable_source 等放在 extra_body
            search_opts = kwargs.get("search_options")
            if isinstance(search_opts, dict) and "enable_source" in extra_body:
                search_opts["enable_source"] = extra_body["enable_source"]
            for k, v in extra_body.items():
                if k in {"enable_source", "search_options"}:
                    continue
                kwargs.setdefault(k, v)

        last_quota_error: BaseException | None = None
        stream = None
        for candidate in _model_candidates(model or settings.chat_model):
            call_kwargs = {**kwargs, "model": candidate}
            use_mm = _is_multimodal_model(candidate)
            if use_mm:
                call_kwargs["messages"] = _to_multimodal_messages(messages)
            try:
                async for attempt in AsyncRetrying(
                    stop=stop_after_attempt(4),
                    wait=wait_exponential(multiplier=1, min=2, max=15),
                    retry=retry_if_exception_type(_RETRYABLE_LLM_ERRORS),
                    reraise=True,
                ):
                    with attempt:
                        if use_mm:
                            stream = await AioMultiModalConversation.call(**call_kwargs)
                        else:
                            stream = await AioGeneration.call(**call_kwargs)
                break
            except Exception as e:
                if _is_quota_error(e):
                    last_quota_error = e
                    logger.warning("chat_stream model {} quota unavailable; trying fallback", candidate)
                    continue
                logger.exception("chat_stream call failed: {}", e)
                raise
        else:
            if last_quota_error:
                raise last_quota_error
            raise RuntimeError("chat_stream could not open a model stream")

        usage: dict[str, Any] | None = None
        emitted_search = False
        emitted_done = False
        async for resp in stream:  # type: ignore[union-attr]
            try:
                _raise_if_failed(resp, what="chat_stream")
            except DashScopeAPIError as e:
                if _is_quota_error(e):
                    raise
                yield {"type": "error", "message": str(e)}
                return

            content, reasoning, search_info, finish = _message_fields(getattr(resp, "output", None))
            usage_raw = _obj_to_dict(getattr(resp, "usage", None))
            if isinstance(usage_raw, dict) and usage_raw:
                usage = usage_raw

            if search_info and not emitted_search:
                emitted_search = True
                yield {"type": "search_info", "data": search_info}
            if reasoning:
                yield {"type": "reasoning", "content": reasoning}
            if content:
                yield {"type": "delta", "content": content}
            if finish and finish not in {"null", "None"}:
                emitted_done = True
                yield {"type": "done", "finish_reason": finish, "usage": usage}
        if not emitted_done:
            yield {"type": "done", "finish_reason": "stop", "usage": usage}

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str | None = None,
        temperature: float | None = None,
        extra_body: dict[str, Any] | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """非流式对话；返回 OpenAI-like dict 供 query_analyzer / planner 使用。"""
        _ensure_sdk_configured()
        kwargs: dict[str, Any] = {
            "messages": messages,
            "result_format": "message",
            "api_key": settings.dashscope_api_key,
        }
        if temperature is not None:
            kwargs["temperature"] = temperature
        if response_format is not None:
            kwargs["response_format"] = response_format
        if extra_body:
            kwargs.update(extra_body)

        last_quota_error: BaseException | None = None
        for candidate in _model_candidates(model or settings.chat_model):
            call_kwargs = {**kwargs, "model": candidate}
            use_mm = _is_multimodal_model(candidate)
            if use_mm:
                call_kwargs["messages"] = _to_multimodal_messages(messages)
            try:
                async for attempt in AsyncRetrying(
                    stop=stop_after_attempt(4),
                    wait=wait_exponential(multiplier=1, min=2, max=15),
                    retry=retry_if_exception_type(_RETRYABLE_LLM_ERRORS + (DashScopeAPIError,)),
                    reraise=True,
                ):
                    with attempt:
                        if use_mm:
                            resp = await AioMultiModalConversation.call(**call_kwargs)
                        else:
                            resp = await AioGeneration.call(**call_kwargs)
                        return _normalize_chat_response(resp)
            except Exception as e:
                if _is_quota_error(e):
                    last_quota_error = e
                    logger.warning("chat model {} quota unavailable; trying fallback", candidate)
                    continue
                raise
        if last_quota_error:
            raise last_quota_error
        raise RuntimeError("unreachable chat retry state")

    # --- Responses API（深度研究：web_search + web_extractor；SDK 无封装）---
    async def responses_stream(
        self,
        input_text: str | list[dict[str, Any]],
        *,
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        enable_thinking: bool = True,
        extra_body: dict[str, Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """流式 Responses API；解析 SSE 为结构化 dict 供 research nodes 消费。"""
        url = f"{settings.resolved_dashscope_responses_base_url}/responses"
        body: dict[str, Any] = {
            "model": model or settings.research_model,
            "input": input_text,
            "stream": True,
        }
        if tools:
            body["tools"] = tools
        if enable_thinking:
            body["enable_thinking"] = True
        if extra_body:
            body.update(extra_body)

        http = self._ensure_http()
        resp: httpx.Response | None = None
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(4),
            wait=wait_exponential(multiplier=1, min=2, max=15),
            retry=retry_if_exception_type(_RETRYABLE_LLM_ERRORS),
            reraise=True,
        ):
            with attempt:
                request = http.build_request(
                    "POST",
                    url,
                    json=body,
                    headers={
                        "Authorization": f"Bearer {settings.dashscope_api_key}",
                        "Accept": "text/event-stream",
                        "Content-Type": "application/json",
                    },
                )
                resp = await http.send(request, stream=True)
        if resp is None:
            raise RuntimeError("Responses API stream was not opened")

        try:
            if resp.status_code >= 400:
                detail = await resp.aread()
                raise httpx.HTTPStatusError(
                    f"Responses API failed: {detail.decode('utf-8', errors='ignore')}",
                    request=resp.request,
                    response=resp,
                )

            current_event: str | None = None
            async for line in resp.aiter_lines():
                if not line:
                    current_event = None
                    continue
                if line.startswith(":"):
                    continue
                if line.startswith("event:"):
                    current_event = line[len("event:") :].strip()
                    continue
                if line.startswith("data:"):
                    payload = line[len("data:") :].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        data = json.loads(payload)
                    except Exception:
                        continue
                    ev_type = data.get("type") or current_event or "unknown"
                    data["type"] = ev_type
                    yield data
        finally:
            await resp.aclose()

    # --- Files API（file-extract / fileid://；compatible-mode HTTP）---
    async def upload_file(self, path: str | Path, purpose: str = "file-extract") -> str:
        """上传文件至 DashScope compatible-mode Files，返回 file id。"""
        p = Path(path)
        url = f"{settings.resolved_dashscope_files_base_url}/files"
        http = self._ensure_http()

        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(4),
            wait=wait_exponential(multiplier=1, min=2, max=15),
            retry=retry_if_exception_type(_RETRYABLE_LLM_ERRORS),
            reraise=True,
        ):
            with attempt:
                with p.open("rb") as fh:
                    files = {"file": (p.name, fh)}
                    data = {"purpose": purpose}
                    resp = await http.post(
                        url,
                        data=data,
                        files=files,
                        headers={"Authorization": f"Bearer {settings.dashscope_api_key}"},
                    )
                resp.raise_for_status()
                payload = resp.json()

        file_id = payload.get("id") or (payload.get("output") or {}).get("id")
        if not file_id and isinstance(payload.get("data"), dict):
            file_id = payload["data"].get("id")
        if not file_id:
            raise DashScopeAPIError(f"upload_file missing id in response: {payload}")
        return str(file_id)

    async def describe_image(self, path: str | Path) -> str:
        """用 MultiModalConversation 对图片做 OCR + 内容描述（对齐官方示例）。

        本地文件以 data URI（base64）传入，因工作空间 MaaS 无法读取宿主机 file://。
        """
        _ensure_sdk_configured()
        p = Path(path).resolve()
        if not p.is_file():
            raise FileNotFoundError(str(p))

        mime, _ = mimetypes.guess_type(p.name)
        if not mime or not mime.startswith("image/"):
            mime = "image/jpeg"
        b64 = base64.b64encode(p.read_bytes()).decode("ascii")
        image_ref = f"data:{mime};base64,{b64}"

        messages = [
            {
                "role": "user",
                "content": [
                    {"image": image_ref},
                    {
                        "text": (
                            "请完整识别图片中的全部文字（OCR），并简要描述画面内容与版式。"
                            "输出中文；若无文字请说明并描述图像主题。"
                        )
                    },
                ],
            }
        ]

        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=2, max=10),
            retry=retry_if_exception_type(_RETRYABLE_LLM_ERRORS + (DashScopeAPIError,)),
            reraise=True,
        ):
            with attempt:
                resp = await AioMultiModalConversation.call(
                    api_key=settings.dashscope_api_key,
                    model=settings.vision_model,
                    messages=messages,
                )
                status = getattr(resp, "status_code", None)
                if status is not None and int(status) != HTTPStatus.OK:
                    raise DashScopeAPIError(
                        f"describe_image failed: {getattr(resp, 'code', None)} "
                        f"{getattr(resp, 'message', None)}",
                        status_code=int(status) if status is not None else None,
                        code=str(getattr(resp, "code", None) or ""),
                    )
                # 官方示例：response.output.choices[0].message.content[0]["text"]
                output = getattr(resp, "output", None)
                data = _obj_to_dict(output) or {}
                choices = data.get("choices") or []
                if choices:
                    choice0 = choices[0] if isinstance(choices[0], dict) else _obj_to_dict(choices[0])
                    msg = (choice0 or {}).get("message") or {}
                    if not isinstance(msg, dict):
                        msg = _obj_to_dict(msg) or {}
                    content = msg.get("content")
                    if isinstance(content, list) and content:
                        first = content[0]
                        if isinstance(first, dict) and first.get("text"):
                            return str(first["text"]).strip()
                        texts = []
                        for part in content:
                            if isinstance(part, dict) and part.get("text"):
                                texts.append(str(part["text"]))
                            elif isinstance(part, str):
                                texts.append(part)
                        if texts:
                            return "\n".join(texts).strip()
                    if isinstance(content, str) and content.strip():
                        return content.strip()
                text = data.get("text")
                if text:
                    return str(text).strip()
                raise DashScopeAPIError("describe_image returned empty content")
        raise RuntimeError("describe_image unreachable")

    async def extract_page_layout(self, path: str | Path, *, page: int = 1) -> str:
        """VL layout extraction: OCR text blocks with 0–1000 bboxes as JSON text.

        Uses ``settings.vision_model`` (default qwen3.5-flash).
        """
        _ensure_sdk_configured()
        p = Path(path).resolve()
        if not p.is_file():
            raise FileNotFoundError(str(p))

        mime, _ = mimetypes.guess_type(p.name)
        if not mime or not mime.startswith("image/"):
            mime = "image/png"
        b64 = base64.b64encode(p.read_bytes()).decode("ascii")
        image_ref = f"data:{mime};base64,{b64}"
        prompt = (
            f"这是扫描文献 PDF 的第 {page} 页图像。"
            "请做版面分析与 OCR，只输出 JSON（不要 Markdown 解释），格式：\n"
            '{"blocks":[{"type":"text|sectionheader|pagefooter|pageheader",'
            '"text":"...","bbox":[x0,y0,x1,y1]}]}\n'
            "坐标 bbox 使用 0–1000 归一化（相对页宽高）。"
            "页眉页脚用 pageheader/pagefooter；正文用 text；标题用 sectionheader。"
            "尽量完整保留文字，勿编造。"
        )
        messages = [
            {
                "role": "user",
                "content": [
                    {"image": image_ref},
                    {"text": prompt},
                ],
            }
        ]

        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=2, max=10),
            retry=retry_if_exception_type(_RETRYABLE_LLM_ERRORS + (DashScopeAPIError,)),
            reraise=True,
        ):
            with attempt:
                resp = await AioMultiModalConversation.call(
                    api_key=settings.dashscope_api_key,
                    model=settings.vision_model,
                    messages=messages,
                )
                status = getattr(resp, "status_code", None)
                if status is not None and int(status) != HTTPStatus.OK:
                    raise DashScopeAPIError(
                        f"extract_page_layout failed: {getattr(resp, 'code', None)} "
                        f"{getattr(resp, 'message', None)}",
                        status_code=int(status) if status is not None else None,
                        code=str(getattr(resp, "code", None) or ""),
                    )
                output = getattr(resp, "output", None)
                data = _obj_to_dict(output) or {}
                choices = data.get("choices") or []
                if choices:
                    choice0 = choices[0] if isinstance(choices[0], dict) else _obj_to_dict(choices[0])
                    msg = (choice0 or {}).get("message") or {}
                    if not isinstance(msg, dict):
                        msg = _obj_to_dict(msg) or {}
                    content = msg.get("content")
                    if isinstance(content, list) and content:
                        texts = []
                        for part in content:
                            if isinstance(part, dict) and part.get("text"):
                                texts.append(str(part["text"]))
                            elif isinstance(part, str):
                                texts.append(part)
                        if texts:
                            return "\n".join(texts).strip()
                    if isinstance(content, str) and content.strip():
                        return content.strip()
                text = data.get("text")
                if text:
                    return str(text).strip()
                raise DashScopeAPIError("extract_page_layout returned empty content")
        raise RuntimeError("extract_page_layout unreachable")

    async def delete_file(self, file_id: str) -> None:
        url = f"{settings.resolved_dashscope_files_base_url}/files/{file_id}"
        http = self._ensure_http()
        try:
            resp = await http.delete(
                url,
                headers={"Authorization": f"Bearer {settings.dashscope_api_key}"},
            )
            if resp.status_code >= 400:
                logger.warning("delete_file({}): status={} body={}", file_id, resp.status_code, resp.text)
        except Exception as e:
            logger.warning("delete_file({}): {}", file_id, e)


_client: DashScopeClient | None = None


def get_dashscope_client() -> DashScopeClient:
    """进程内 DashScope 客户端单例。"""
    global _client
    if _client is None:
        _ensure_sdk_configured()
        _client = DashScopeClient()
    return _client


dashscope_client = get_dashscope_client()
