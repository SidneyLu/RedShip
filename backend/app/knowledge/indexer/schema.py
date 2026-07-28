"""Milvus collection schema and ensure_collection."""
from __future__ import annotations

from loguru import logger
from pymilvus import (
    CollectionSchema,
    DataType,
    Function,
    FunctionType,
)

from app.core.config import settings
from app.knowledge.indexer.client import get_milvus


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
