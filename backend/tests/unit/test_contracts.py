"""Unit tests for Soft RAG/KB contracts."""
from __future__ import annotations

from app.knowledge.contracts import MILVUS_SCHEMA_VERSION, build_child_chunk_id


def test_milvus_schema_version():
    assert MILVUS_SCHEMA_VERSION == 1


def test_build_child_chunk_id():
    assert build_child_chunk_id("doc-abc", 0, 0) == "doc-abc_0_0"
    assert build_child_chunk_id("doc-abc", 2, 5) == "doc-abc_2_5"
    assert build_child_chunk_id("sess_t1_deadbeef", 1, 3) == "sess_t1_deadbeef_1_3"
