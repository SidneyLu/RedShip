"""Milvus client singleton."""
from __future__ import annotations

from pymilvus import MilvusClient

from app.core.config import settings

_client: MilvusClient | None = None


def get_milvus() -> MilvusClient:
    global _client
    if _client is None:
        uri = f"http://{settings.milvus_host}:{settings.milvus_port}"
        _client = MilvusClient(uri=uri)
    return _client
