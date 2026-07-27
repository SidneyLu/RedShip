"""Unit tests for document chunker."""
from __future__ import annotations

import pytest

from app.knowledge.ingestion.chunker import chunk_document, flatten_children, split_sentences
from app.knowledge.ingestion.parser import ParsedDocument, Section

pytestmark = pytest.mark.unit


def test_split_sentences_basic():
    parts = split_sentences("第一句。第二句！第三句？")
    assert len(parts) >= 2
    assert "第一句" in parts[0]


def test_split_sentences_empty():
    assert split_sentences("") == []
    assert split_sentences("   ") == []


def test_chunk_document_and_flatten():
    doc = ParsedDocument(
        title="测试",
        sections=[
            Section(heading_path="第一章", text="这是一段足够长的测试文字。" * 20),
            Section(heading_path="第一章 > 第一节", text="另一段内容。" * 15),
        ],
    )
    parents = chunk_document(doc)
    assert parents
    assert all(p.text for p in parents)
    children = flatten_children(parents)
    assert children
    assert all(c.parent_index >= 0 for c in children)
