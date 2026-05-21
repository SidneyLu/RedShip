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

from dataclasses import dataclass
from typing import Iterable, Sequence

from loguru import logger
from pymilvus import (
    AnnSearchRequest,
    CollectionSchema,
    DataType,
    Function,
    FunctionType,
    MilvusClient,
    RRFRanker,
)

from app.core.config import settings


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


_client: MilvusClient | None = None


def get_milvus() -> MilvusClient:
    global _client
    if _client is None:
        uri = f"http://{settings.milvus_host}:{settings.milvus_port}"
        _client = MilvusClient(uri=uri)
    return _client


def _build_schema(dim: int) -> CollectionSchema:
    client = get_milvus()
    schema = client.create_schema(auto_id=False, enable_dynamic_field=True)
    schema.add_field(field_name="id", datatype=DataType.VARCHAR, is_primary=True, max_length=128)
    schema.add_field(
        field_name="text",
        datatype=DataType.VARCHAR,
        max_length=65535,
        enable_analyzer=True,
        analyzer_params={"tokenizer": "jieba"},
    )
    schema.add_field(field_name="sparse", datatype=DataType.SPARSE_FLOAT_VECTOR)
    schema.add_field(field_name="dense", datatype=DataType.FLOAT_VECTOR, dim=dim)
    schema.add_field(field_name="source", datatype=DataType.VARCHAR, max_length=32)
    schema.add_field(field_name="doc_id", datatype=DataType.VARCHAR, max_length=64)
    schema.add_field(field_name="chunk_type", datatype=DataType.VARCHAR, max_length=16)
    schema.add_field(field_name="parent_index", datatype=DataType.INT64)
    schema.add_field(field_name="heading_path", datatype=DataType.VARCHAR, max_length=512)
    schema.add_field(field_name="era", datatype=DataType.VARCHAR, max_length=64)
    schema.add_field(field_name="namespace", datatype=DataType.VARCHAR, max_length=128)

    schema.add_function(
        Function(
            name="text_bm25",
            input_field_names=["text"],
            output_field_names=["sparse"],
            function_type=FunctionType.BM25,
        )
    )
    return schema


def ensure_collection(collection_name: str | None = None) -> str:
    """若集合不存在则创建 HNSW + BM25 索引并 load；返回集合名。"""
    name = collection_name or settings.milvus_kb_collection
    client = get_milvus()
    if client.has_collection(name):
        return name

    schema = _build_schema(settings.embedding_dim)
    index_params = client.prepare_index_params()
    index_params.add_index(
        field_name="dense",
        index_name="dense_idx",
        index_type="HNSW",
        metric_type="COSINE",
        params={"M": 16, "efConstruction": 200},
    )
    index_params.add_index(
        field_name="sparse",
        index_name="sparse_idx",
        index_type="SPARSE_INVERTED_INDEX",
        metric_type="BM25",
        params={"inverted_index_algo": "DAAT_MAXSCORE", "bm25_k1": 1.2, "bm25_b": 0.75},
    )

    client.create_collection(
        collection_name=name,
        schema=schema,
        index_params=index_params,
        consistency_level="Bounded",
    )
    client.load_collection(name)
    logger.info("Milvus collection '{}' created with hybrid (dense+BM25) schema.", name)
    return name


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


def hybrid_search(
    *,
    collection_name: str,
    query_text: str,
    query_dense: list[float],
    top_k: int = 20,
    extra_filter: str | None = None,
    rrf_k: int = 60,
) -> list[HybridSearchHit]:
    """稠密 ANN + BM25 稀疏检索，RRFRanker 融合后取 top_k。

    参数:
        extra_filter: Milvus 表达式，如 source、namespace 过滤。
    """
    client = get_milvus()

    dense_req = AnnSearchRequest(
        data=[query_dense],
        anns_field="dense",
        param={"metric_type": "COSINE", "params": {"ef": 128}},
        limit=top_k,
        expr=extra_filter,
    )
    sparse_req = AnnSearchRequest(
        data=[query_text],
        anns_field="sparse",
        param={"metric_type": "BM25", "params": {"drop_ratio_build": 0.0}},
        limit=top_k,
        expr=extra_filter,
    )

    results = client.hybrid_search(
        collection_name=collection_name,
        reqs=[dense_req, sparse_req],
        ranker=RRFRanker(k=rrf_k),
        limit=top_k,
        output_fields=[
            "text",
            "doc_id",
            "source",
            "parent_index",
            "heading_path",
            "era",
            "chunk_type",
            "namespace",
        ],
    )

    out: list[HybridSearchHit] = []
    if not results:
        return out
    for hit in results[0]:
        entity = getattr(hit, "entity", None)
        if entity is None and isinstance(hit, dict):
            entity = hit.get("entity") or hit
            score = float(hit.get("distance") or hit.get("score") or 0.0)
            hit_id = hit.get("id")
        else:
            score = float(getattr(hit, "distance", 0.0))
            hit_id = getattr(hit, "id", None)
        if entity is None:
            continue
        get = entity.get if isinstance(entity, dict) else lambda k, default=None: getattr(entity, k, default)
        out.append(
            HybridSearchHit(
                id=str(hit_id),
                score=score,
                text=str(get("text", "")),
                doc_id=str(get("doc_id", "")),
                source=str(get("source", "")),
                parent_index=int(get("parent_index", 0) or 0),
                heading_path=str(get("heading_path", "")),
                era=str(get("era", "")),
                chunk_type=str(get("chunk_type", "child")),
                namespace=str(get("namespace", "")),
            )
        )
    return out
