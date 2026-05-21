"""异步 Redis 单例：JSON 缓存与 LangGraph checkpoint 共用连接。

用途分离：
- `cache_*`：embedding、联网搜索结果等短期 JSON 缓存
- checkpoint：见 `core/checkpoint.py`，键前缀 `ckpt:{thread_id}`
"""
from __future__ import annotations

import json
from typing import Any

import redis.asyncio as redis_async

from app.core.config import settings

_client: redis_async.Redis | None = None


def get_redis() -> redis_async.Redis:
    """获取进程内单例 Redis 客户端；decode_responses=False 以兼容二进制 checkpoint。"""
    global _client
    if _client is None:
        _client = redis_async.from_url(
            settings.resolved_redis_url,
            decode_responses=False,
            encoding="utf-8",
        )
    return _client


async def cache_get_json(key: str) -> Any | None:
    """读取 JSON 缓存；键不存在或 JSON 损坏时返回 None。"""
    client = get_redis()
    raw = await client.get(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


async def cache_set_json(key: str, value: Any, ttl_seconds: int) -> None:
    """写入 JSON 缓存并设置 TTL（秒）。"""
    client = get_redis()
    await client.set(key, json.dumps(value, ensure_ascii=False), ex=ttl_seconds)


async def close_redis() -> None:
    """应用关闭时释放连接，在 main lifespan 中调用。"""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
