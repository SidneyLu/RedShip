"""Async Redis singleton used for embedding/search caches and checkpointing."""
from __future__ import annotations

import json
from typing import Any

import redis.asyncio as redis_async

from app.core.config import settings

_client: redis_async.Redis | None = None


def get_redis() -> redis_async.Redis:
    global _client
    if _client is None:
        _client = redis_async.from_url(
            settings.resolved_redis_url,
            decode_responses=False,
            encoding="utf-8",
        )
    return _client


async def cache_get_json(key: str) -> Any | None:
    client = get_redis()
    raw = await client.get(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


async def cache_set_json(key: str, value: Any, ttl_seconds: int) -> None:
    client = get_redis()
    await client.set(key, json.dumps(value, ensure_ascii=False), ex=ttl_seconds)


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
