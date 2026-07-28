"""Milvus 集合管理与混合检索写入。

集合 schema（jieba BM25 + 稠密向量，见 PLAN.md Milvus Schema）：

    id            VARCHAR (primary)
    text          VARCHAR (analyzer=jieba)  -- enables BM25 sparse vector
    sparse        SPARSE_FLOAT_VECTOR       -- produced by Milvus Function (BM25)
    dense         FLOAT_VECTOR (dim=1024)
    source        VARCHAR
    doc_id        VARCHAR
    chunk_type    VARCHAR
    parent_index  INT64
    heading_path  VARCHAR
    era           VARCHAR
    namespace     VARCHAR
"""
from __future__ import annotations

from app.knowledge.contracts import HybridSearchHit, IndexableChunk
from app.knowledge.indexer.client import get_milvus
from app.knowledge.indexer.schema import ensure_collection
from app.knowledge.indexer.search import hybrid_search
from app.knowledge.indexer.write import (
    drop_doc,
    drop_namespace,
    purge_legacy_session_from_kb,
    upsert_chunks,
)

__all__ = [
    "HybridSearchHit",
    "IndexableChunk",
    "drop_doc",
    "drop_namespace",
    "ensure_collection",
    "get_milvus",
    "hybrid_search",
    "purge_legacy_session_from_kb",
    "upsert_chunks",
]
