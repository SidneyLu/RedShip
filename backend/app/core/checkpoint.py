"""LangGraph checkpoint persistence on Redis (`ckpt:{thread_id}`, 7-day TTL)."""
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


def _key(thread_id: str) -> str:
    return f"ckpt:{thread_id}"


class RedisCheckpointSaver(BaseCheckpointSaver):
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
        thread_id = config["configurable"]["thread_id"]
        payload = {
            "checkpoint_b64": base64.b64encode(self.serde.dumps(checkpoint)).decode("ascii"),
            "metadata": metadata,
            "parent_config": config.get("configurable"),
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
    global _checkpointer
    if _checkpointer is None:
        _checkpointer = RedisCheckpointSaver()
    return _checkpointer
