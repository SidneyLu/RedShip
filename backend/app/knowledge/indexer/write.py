"""Milvus write helpers: upsert, drop, purge."""
from __future__ import annotations

from typing import Sequence

from loguru import logger

from app.core.config import settings
from app.knowledge.contracts import IndexableChunk
from app.knowledge.indexer.client import get_milvus


def drop_doc(collection_name: str, doc_id: str) -> int:
    client = get_milvus()
    expr = f'doc_id == "{doc_id}"'
    res = client.delete(collection_name=collection_name, filter=expr)
    return res.get("delete_count", 0) if isinstance(res, dict) else 0


def drop_namespace(collection_name: str, namespace: str) -> int:
    """删除某会话 namespace 下全部 Milvus 行（附件重传前清理）。"""
    if not namespace:
        return 0
    client = get_milvus()
    expr = f'namespace == "{namespace}"'
    res = client.delete(collection_name=collection_name, filter=expr)
    return res.get("delete_count", 0) if isinstance(res, dict) else 0


def purge_legacy_session_from_kb() -> int:
    """清理误写入 knowledge_base 的旧会话向量（source==session）。"""
    client = get_milvus()
    name = settings.milvus_kb_collection
    if not client.has_collection(name):
        return 0
    res = client.delete(collection_name=name, filter='source == "session"')
    count = res.get("delete_count", 0) if isinstance(res, dict) else 0
    if count:
        logger.info("Purged {} legacy session rows from {}", count, name)
    return count


def upsert_chunks(collection_name: str, chunks: Sequence[IndexableChunk]) -> int:
    if not chunks:
        return 0
    client = get_milvus()
    rows = [
        {
            "id": c.id,
            "text": c.text,
            "dense": c.dense,
            "source": c.source,
            "doc_id": c.doc_id,
            "chunk_type": c.chunk_type,
            "parent_index": c.parent_index,
            "heading_path": c.heading_path,
            "era": c.era,
            "namespace": c.namespace,
        }
        for c in chunks
    ]
    res = client.upsert(collection_name=collection_name, data=rows)
    return res.get("upsert_count", len(rows)) if isinstance(res, dict) else len(rows)
