"""LangGraph 检查点持久化：Redis 键 `ckpt:{thread_id}`，TTL 7 天。

使同一会话 thread 在快速问答/深度研究中断后可恢复图状态；
序列化使用 LangGraph JsonPlusSerializer + base64 存储。
"""
from __future__ import annotations

import base64
from typing import Any, AsyncIterator, Iterator, Sequence

from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
)
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

from app.core.redis import cache_get_json, cache_set_json

_CKPT_TTL = 7 * 24 * 3600
_SERDE = JsonPlusSerializer()
_DROP = object()


def _key(thread_id: str) -> str:
    """Redis 键：与 thread UUID 一一对应。"""
    return f"ckpt:{thread_id}"


def _json_safe(value: Any) -> Any:
    """Return a JSON-serializable copy, dropping runtime-only objects."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            safe_item = _json_safe(item)
            if safe_item is not _DROP:
                cleaned[str(key)] = safe_item
        return cleaned
    if isinstance(value, (list, tuple, set)):
        cleaned_list = []
        for item in value:
            safe_item = _json_safe(item)
            if safe_item is not _DROP:
                cleaned_list.append(safe_item)
        return cleaned_list
    return _DROP


def _safe_parent_config(config: dict[str, Any]) -> dict[str, Any]:
    configurable = _json_safe(config.get("configurable") or {})
    if not isinstance(configurable, dict):
        configurable = {}
    return {"configurable": configurable}


class RedisCheckpointSaver(BaseCheckpointSaver):
    """基于 Redis 的异步 CheckpointSaver；同步接口未实现，请用 a* 方法。"""

    serde = _SERDE

    def get_tuple(self, config: dict[str, Any]) -> CheckpointTuple | None:
        raise NotImplementedError("Use aget_tuple")

    def list(
        self,
        config: dict[str, Any] | None,
        *,
        filter: dict[str, Any] | None = None,
        before: dict[str, Any] | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        raise NotImplementedError("Use alist")

    def put(
        self,
        config: dict[str, Any],
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: dict[str, Any],
    ) -> dict[str, Any]:
        raise NotImplementedError("Use aput")

    def put_writes(
        self,
        config: dict[str, Any],
        writes: Sequence[tuple[str, Any]],
        task_id: str,
    ) -> None:
        return None

    async def aget_tuple(self, config: dict[str, Any]) -> CheckpointTuple | None:
        """从 Redis 加载最新 checkpoint；不存在则返回 None。"""
        thread_id = config["configurable"]["thread_id"]
        raw = await cache_get_json(_key(thread_id))
        if not raw:
            return None
        checkpoint = self.serde.loads(base64.b64decode(raw["checkpoint_b64"]))
        return CheckpointTuple(
            config=config,
            checkpoint=checkpoint,
            metadata=raw.get("metadata") or {},
            parent_config=raw.get("parent_config"),
        )

    async def alist(
        self,
        config: dict[str, Any] | None,
        *,
        filter: dict[str, Any] | None = None,
        before: dict[str, Any] | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[CheckpointTuple]:
        """当前实现仅返回该 thread 的最新一条 checkpoint。"""
        if config is None:
            return
        tup = await self.aget_tuple(config)
        if tup:
            yield tup

    async def aput(
        self,
        config: dict[str, Any],
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: dict[str, Any],
    ) -> dict[str, Any]:
        """序列化 checkpoint 写入 Redis 并刷新 TTL。"""
        thread_id = config["configurable"]["thread_id"]
        payload = {
            "checkpoint_b64": base64.b64encode(self.serde.dumps(checkpoint)).decode("ascii"),
            "metadata": _json_safe(metadata) or {},
            "parent_config": _safe_parent_config(config),
        }
        await cache_set_json(_key(thread_id), payload, ttl_seconds=_CKPT_TTL)
        return config

    async def aput_writes(
        self,
        config: dict[str, Any],
        writes: Sequence[tuple[str, Any]],
        task_id: str,
    ) -> None:
        return None


_checkpointer: RedisCheckpointSaver | None = None


def get_checkpointer() -> RedisCheckpointSaver:
    """LangGraph 编译图时注入的 checkpointer 单例。"""
    global _checkpointer
    if _checkpointer is None:
        _checkpointer = RedisCheckpointSaver()
    return _checkpointer
