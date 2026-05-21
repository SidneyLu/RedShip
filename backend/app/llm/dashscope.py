"""Unified DashScope client wrapping embed / rerank / chat / responses / files.

All AI capabilities run through DashScope; no local model dependencies.
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
from openai import AsyncOpenAI
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.core.redis import cache_get_json, cache_set_json


# DashScope batch size limit for text-embedding-v3/v4 is 10 inputs per request.
EMBEDDING_BATCH_SIZE = 10
EMBED_CACHE_TTL = 60 * 60  # 1h


@dataclass
class RerankResult:
    index: int
    score: float
    text: str | None = None


class DashScopeClient:
    """Thin async wrapper around DashScope's OpenAI-compatible endpoints."""

    def __init__(self) -> None:
        self._chat_client: AsyncOpenAI | None = None
        self._http: httpx.AsyncClient | None = None

    # ------------------------------------------------------------------
    # Lazy resources
    # ------------------------------------------------------------------
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

    # ------------------------------------------------------------------
    # Embedding
    # ------------------------------------------------------------------
    async def embed(
        self,
        texts: list[str] | str,
        *,
        dimensions: int | None = None,
        use_cache: bool = True,
    ) -> list[list[float]]:
        """Compute dense embeddings via DashScope text-embedding-v4 (OpenAI compatible).

        Returns embeddings in the same order as the input texts.
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

        # Cache lookup
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

    # ------------------------------------------------------------------
    # Rerank
    # ------------------------------------------------------------------
    async def rerank(
        self,
        query: str,
        documents: list[str],
        *,
        top_n: int | None = None,
        instruct: str | None = None,
    ) -> list[RerankResult]:
        """Rerank documents against query via qwen3-rerank.

        Returns indices into `documents` ordered by relevance descending.
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

    # ------------------------------------------------------------------
    # Chat Completions (with optional web search)
    # ------------------------------------------------------------------
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
        """Stream Chat Completions chunks.

        Yields dicts with shape:
            {"type": "delta", "content": str}
            {"type": "reasoning", "content": str}
            {"type": "search_info", "results": list}
            {"type": "done", "finish_reason": str, "usage": dict|None}
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

        try:
            stream = await client.chat.completions.create(**{k: v for k, v in kwargs.items() if v is not None})
        except Exception as e:
            logger.exception("chat_stream call failed: {}", e)
            raise

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
        """Non-streaming Chat Completions call returning a parsed dict."""
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
        resp = await client.chat.completions.create(**{k: v for k, v in kwargs.items() if v is not None})
        return resp.model_dump()

    # ------------------------------------------------------------------
    # Responses API (Deep Research, web_search + web_extractor)
    # ------------------------------------------------------------------
    async def responses_stream(
        self,
        input_text: str | list[dict[str, Any]],
        *,
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        enable_thinking: bool = True,
        extra_body: dict[str, Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream Responses API output events.

        The DashScope Responses endpoint streams Server-Sent Events; we re-emit
        them as structured dicts:
            {"type": "response.output_text.delta", "text": str}
            {"type": "web_search_call.completed", "results": [...]}
            {"type": "web_extractor_call.completed", "url": ..., "title": ..., "output": ...}
            {"type": "response.completed", "response": {...}}
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
        async with http.stream(
            "POST",
            url,
            json=body,
            headers={
                "Authorization": f"Bearer {settings.dashscope_api_key}",
                "Accept": "text/event-stream",
                "Content-Type": "application/json",
            },
        ) as resp:
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

    # ------------------------------------------------------------------
    # Files API
    # ------------------------------------------------------------------
    async def upload_file(self, path: str | Path, purpose: str = "file-extract") -> str:
        """Upload a file to DashScope Files API and return the file id."""
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
    global _client
    if _client is None:
        _client = DashScopeClient()
    return _client


dashscope_client = get_dashscope_client()
