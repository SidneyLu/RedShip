"""Soft RAG/KB contracts: shared types, IDs, and index Protocols.

Build (ingest) and Query (retrieve) both depend on these shapes without
coupling to a concrete Milvus client implementation.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence

MILVUS_SCHEMA_VERSION = 1

# Milvus field names (schema v1)
FIELD_ID = "id"
FIELD_TEXT = "text"
FIELD_SPARSE = "sparse"
FIELD_DENSE = "dense"
FIELD_SOURCE = "source"
FIELD_DOC_ID = "doc_id"
FIELD_CHUNK_TYPE = "chunk_type"
FIELD_PARENT_INDEX = "parent_index"
FIELD_HEADING_PATH = "heading_path"
FIELD_ERA = "era"
FIELD_NAMESPACE = "namespace"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def build_child_chunk_id(doc_id: str, parent_index: int, child_index: int) -> str:
    """Stable Milvus primary key for a child chunk: ``{doc_id}_{parent}_{child}``."""
    return f"{doc_id}_{parent_index}_{child_index}"


@dataclass
class IndexableChunk:
    """待 upsert 的一条 Milvus 记录；子块带 dense，父块仅存 Postgres。"""

    id: str
    text: str
    dense: list[float]
    source: str  # bibliography | upload | session
    doc_id: str
    chunk_type: str = "child"  # child | parent
    parent_index: int = 0
    heading_path: str = ""
    era: str = ""
    namespace: str = ""  # used for session-scoped collections (thread_id)


@dataclass
class HybridSearchHit:
    """混合检索单条命中；parent_index 用于 Postgres 父块回溯。"""

    id: str
    score: float
    text: str
    doc_id: str
    source: str
    parent_index: int
    heading_path: str
    era: str
    chunk_type: str
    namespace: str


class VectorIndexWriter(Protocol):
    def ensure_collection(self, collection_name: str | None = None) -> str: ...

    def upsert_chunks(self, collection_name: str, chunks: Sequence[IndexableChunk]) -> int: ...

    def drop_doc(self, collection_name: str, doc_id: str) -> int: ...

    def drop_namespace(self, collection_name: str, namespace: str) -> int: ...


class VectorIndexReader(Protocol):
    def ensure_collection(self, collection_name: str | None = None) -> str: ...

    def hybrid_search(
        self,
        *,
        collection_name: str,
        query_text: str,
        query_dense: list[float],
        top_k: int = 20,
        extra_filter: str | None = None,
        rrf_k: int = 60,
    ) -> list[HybridSearchHit]: ...
