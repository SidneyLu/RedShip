"""Unit tests for retriever merge / evidence render."""
from __future__ import annotations

import pytest

from app.knowledge.contracts import HybridSearchHit
from app.knowledge.retriever import RetrievedPassage, _merge_hits, render_evidence_block

pytestmark = pytest.mark.unit


def test_merge_hits_keeps_highest_score():
    def hit(i: str, score: float, text: str) -> HybridSearchHit:
        return HybridSearchHit(
            id=i,
            score=score,
            text=text,
            doc_id="d",
            source="bibliography",
            parent_index=0,
            heading_path="",
            era="",
            chunk_type="child",
            namespace="",
        )

    a = hit("1", 0.5, "a")
    b = hit("1", 0.9, "b")
    c = hit("2", 0.3, "c")
    merged = _merge_hits([a, c], [b])
    assert len(merged) == 2
    by_id = {h.id: h for h in merged}
    assert by_id["1"].score == 0.9
    assert merged[0].id == "1"


def test_render_evidence_block():
    p = RetrievedPassage(
        id="c-1",
        doc_id="d",
        document_title="文献A",
        heading_path="第一章",
        parent_index=0,
        parent_text="正文内容",
        snippet="正文",
        source="bibliography",
        score=0.8,
        era="抗日战争",
    )
    block = render_evidence_block([p])
    assert "[1]" in block
    assert "文献A" in block
    assert "正文内容" in block
