"""DashScope 统一客户端：embed / rerank / chat / responses / files。

对应 PLAN.md「dashscope-client」。全项目无本地大模型，均经 OpenAI 兼容端点调用；
embedding 结果可缓存至 Redis（键 `emb:v4:{dim}:{sha256}`）。
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator, Iterable

import httpx
from loguru import logger
from openai import APIConnectionError, APITimeoutError, AsyncOpenAI, PermissionDeniedError
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.core.redis import cache_get_json, cache_set_json


# text-embedding-v4 单次请求最多 10 条文本
EMBEDDING_BATCH_SIZE = 10
EMBED_CACHE_TTL = 60 * 60  # 1 小时
_RETRYABLE_LLM_ERRORS = (
    httpx.HTTPError,
    asyncio.TimeoutError,
    APIConnectionError,
    APITimeoutError,
)
_FALLBACK_CHAT_MODELS = ("qwen-turbo",)


def _model_candidates(primary: str | None) -> list[str]:
    model = primary or settings.chat_model
    candidates = [model]
    for fallback in _FALLBACK_CHAT_MODELS:
        if fallback not in candidates:
            candidates.append(fallback)
    return candidates


def _is_quota_permission_error(exc: PermissionDeniedError) -> bool:
    text = str(exc).lower()
    return "quota" in text or "free tier" in text or "freetieronly" in text


@dataclass
class RerankResult:
    """rerank API 单条结果：index 指向入参 documents 下标。"""
    index: int
    score: float
    text: str | None = None


class DashScopeClient:
    """DashScope OpenAI 兼容 API 的异步薄封装；懒加载 chat 客户端与 httpx。"""

    def __init__(self) -> None:
        self._chat_client: AsyncOpenAI | None = None
        self._http: httpx.AsyncClient | None = None

    # --- 懒加载 HTTP 资源 ---
    def _ensure_chat_client(self) -> AsyncOpenAI:
        if self._chat_client is None:
            self._chat_client = AsyncOpenAI(
                api_key=settings.dashscope_api_key,
                base_url=settings.dashscope_base_url,
                timeout=httpx.Timeout(120.0, connect=30.0),
            )
        return self._chat_client

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
        if self._chat_client is not None:
            await self._chat_client.close()
            self._chat_client = None

    # --- Embedding（text-embedding-v4）---
    async def embed(
        self,
        texts: list[str] | str,
        *,
        dimensions: int | None = None,
        use_cache: bool = True,
    ) -> list[list[float]]:
        """计算稠密向量；顺序与输入 texts 一致。

        参数:
            texts: 单条字符串或列表。
            dimensions: 向量维度，默认 settings.embedding_dim。
            use_cache: 是否读/写 Redis 缓存。

        返回:
            每条文本对应一个 float 列表；空输入返回 []。
        """
        if isinstance(texts, str):
            single = True
            input_texts: list[str] = [texts]
        else:
            single = False
            input_texts = list(texts)

        if not input_texts:
            return []

        dim = dimensions or settings.embedding_dim
        client = self._ensure_chat_client()

        results: list[list[float] | None] = [None] * len(input_texts)
        cache_keys: list[str | None] = [None] * len(input_texts)

        # 先查 Redis，未命中再批量请求 API
        if use_cache:
            for i, text in enumerate(input_texts):
                key = f"emb:v4:{dim}:{hashlib.sha256(text.encode('utf-8')).hexdigest()}"
                cache_keys[i] = key
                hit = await cache_get_json(key)
                if hit is not None and isinstance(hit, list):
                    results[i] = hit

        # Build pending batches
        pending = [i for i, r in enumerate(results) if r is None]
        for start in range(0, len(pending), EMBEDDING_BATCH_SIZE):
            batch_idx = pending[start : start + EMBEDDING_BATCH_SIZE]
            batch_texts = [input_texts[i] for i in batch_idx]
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(4),
                wait=wait_exponential(multiplier=1, min=2, max=15),
                retry=retry_if_exception_type((httpx.HTTPError, asyncio.TimeoutError)),
                reraise=True,
            ):
                with attempt:
                    resp = await client.embeddings.create(
                        model=settings.embedding_model,
                        input=batch_texts,
                        dimensions=dim,
                        encoding_format="float",
                    )
            for j, item in enumerate(resp.data):
                idx = batch_idx[j]
                results[idx] = list(item.embedding)
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
        """对 documents 按与 query 的相关性重排。

        参数:
            query: 用户检索问句。
            documents: 待打分段落列表。
            top_n: 返回条数上限。
            instruct: 党史领域默认英文 instruct，可覆盖。

        返回:
            按相关分降序的 RerankResult，index 为 documents 下标。
        """
        if not documents:
            return []

        url = "https://dashscope.aliyuncs.com/compatible-api/v1/reranks"
        body: dict[str, Any] = {
            "model": settings.rerank_model,
            "query": query,
            "documents": documents,
        }
        if top_n is not None:
            body["top_n"] = min(top_n, len(documents))
        if instruct:
            body["instruct"] = instruct
        else:
            body["instruct"] = (
                "Given a Chinese Communist Party history research query, "
                "retrieve the most relevant passages that answer the query."
            )

        http = self._ensure_http()
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(4),
            wait=wait_exponential(multiplier=1, min=2, max=15),
            retry=retry_if_exception_type((httpx.HTTPError, asyncio.TimeoutError)),
            reraise=True,
        ):
            with attempt:
                resp = await http.post(url, json=body)
                resp.raise_for_status()
                data = resp.json()

        results = data.get("results") or data.get("output", {}).get("results", [])
        out: list[RerankResult] = []
        for item in results:
            idx = int(item.get("index", -1))
            score = float(item.get("relevance_score", item.get("score", 0.0)))
            doc = item.get("document")
            text = None
            if isinstance(doc, dict):
                text = doc.get("text")
            elif isinstance(doc, str):
                text = doc
            out.append(RerankResult(index=idx, score=score, text=text))
        return out

    # --- Chat Completions（快速问答、query_analyzer 等）---
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
        """流式 Chat Completions。

        产出事件类型:
            delta / reasoning / search_info / done（见 rag nodes generator_stream）。
        """
        client = self._ensure_chat_client()
        body: dict[str, Any] = {}
        if extra_body:
            body.update(extra_body)
        if enable_search:
            body["enable_search"] = True
            body["search_options"] = {
                "search_strategy": search_strategy,
                "forced_search": forced_search,
                "enable_source": True,
            }
            body.setdefault("enable_source", True)

        kwargs: dict[str, Any] = {
            "model": model or settings.chat_model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            "extra_body": body or None,
        }
        if temperature is not None:
            kwargs["temperature"] = temperature

        last_quota_error: PermissionDeniedError | None = None
        for candidate in _model_candidates(model or settings.chat_model):
            kwargs["model"] = candidate
            try:
                async for attempt in AsyncRetrying(
                    stop=stop_after_attempt(4),
                    wait=wait_exponential(multiplier=1, min=2, max=15),
                    retry=retry_if_exception_type(_RETRYABLE_LLM_ERRORS),
                    reraise=True,
                ):
                    with attempt:
                        stream = await client.chat.completions.create(
                            **{k: v for k, v in kwargs.items() if v is not None}
                        )
                break
            except PermissionDeniedError as e:
                if _is_quota_permission_error(e):
                    last_quota_error = e
                    logger.warning("chat_stream model {} quota unavailable; trying fallback", candidate)
                    continue
                raise
            except Exception as e:
                logger.exception("chat_stream call failed: {}", e)
                raise
        else:
            if last_quota_error:
                raise last_quota_error
            raise RuntimeError("chat_stream could not open a model stream")

        usage: dict[str, Any] | None = None
        async for chunk in stream:
            # Search info often comes as a top-level extra field
            raw = chunk.model_dump() if hasattr(chunk, "model_dump") else {}
            search_info = raw.get("search_info")
            if search_info:
                yield {"type": "search_info", "data": search_info}

            choices = raw.get("choices") or []
            if not choices:
                if raw.get("usage"):
                    usage = raw["usage"]
                continue
            choice = choices[0]
            delta = choice.get("delta") or {}
            reasoning = delta.get("reasoning_content")
            if reasoning:
                yield {"type": "reasoning", "content": reasoning}
            content = delta.get("content")
            if content:
                yield {"type": "delta", "content": content}
            finish = choice.get("finish_reason")
            if finish:
                yield {"type": "done", "finish_reason": finish, "usage": raw.get("usage") or usage}

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str | None = None,
        temperature: float | None = None,
        extra_body: dict[str, Any] | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """非流式 Chat；用于 query_analyzer 等需 JSON 的场景。"""
        client = self._ensure_chat_client()
        kwargs: dict[str, Any] = {
            "model": model or settings.chat_model,
            "messages": messages,
            "extra_body": extra_body or None,
        }
        if temperature is not None:
            kwargs["temperature"] = temperature
        if response_format is not None:
            kwargs["response_format"] = response_format
        last_quota_error: PermissionDeniedError | None = None
        for candidate in _model_candidates(model or settings.chat_model):
            kwargs["model"] = candidate
            try:
                async for attempt in AsyncRetrying(
                    stop=stop_after_attempt(4),
                    wait=wait_exponential(multiplier=1, min=2, max=15),
                    retry=retry_if_exception_type(_RETRYABLE_LLM_ERRORS),
                    reraise=True,
                ):
                    with attempt:
                        resp = await client.chat.completions.create(
                            **{k: v for k, v in kwargs.items() if v is not None}
                        )
                        return resp.model_dump()
            except PermissionDeniedError as e:
                if _is_quota_permission_error(e):
                    last_quota_error = e
                    logger.warning("chat model {} quota unavailable; trying fallback", candidate)
                    continue
                raise
        if last_quota_error:
            raise last_quota_error
        raise RuntimeError("unreachable chat retry state")

    # --- Responses API（深度研究：web_search + web_extractor）---
    async def responses_stream(
        self,
        input_text: str | list[dict[str, Any]],
        *,
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        enable_thinking: bool = True,
        extra_body: dict[str, Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """流式 Responses API；解析 SSE 为结构化 dict 供 research nodes 消费。

        常见 type：response.output_text.delta、web_search_call.completed、
        web_extractor_call.completed、response.completed。
        """
        url = f"{settings.dashscope_responses_base_url.rstrip('/')}/responses"
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

    # --- Files API（小会话文档 fileid:// 注入）---
    async def upload_file(self, path: str | Path, purpose: str = "file-extract") -> str:
        """上传文件至 DashScope，返回 file id 供 system message 引用。"""
        client = self._ensure_chat_client()
        p = Path(path)
        # OpenAI SDK files.create accepts a file path-like object
        with p.open("rb") as fh:
            resp = await client.files.create(file=fh, purpose=purpose)
        return resp.id

    async def delete_file(self, file_id: str) -> None:
        client = self._ensure_chat_client()
        try:
            await client.files.delete(file_id)
        except Exception as e:
            logger.warning("delete_file({}): {}", file_id, e)


_client: DashScopeClient | None = None


def get_dashscope_client() -> DashScopeClient:
    """进程内 DashScope 客户端单例。"""
    global _client
    if _client is None:
        _client = DashScopeClient()
    return _client


dashscope_client = get_dashscope_client()
