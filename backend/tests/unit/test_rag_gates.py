"""Unit tests for RAG routing gates."""
from __future__ import annotations

import pytest

from app.agents.rag.nodes import after_kb_gate, entry_after_analyzer, kb_evidence_sufficient
from app.core.config import settings

pytestmark = pytest.mark.unit


def test_entry_after_analyzer_routes():
    assert entry_after_analyzer({"route": "web"}) == "web_searcher"
    assert entry_after_analyzer({"route": "kb"}) == "kb_retriever"
    assert entry_after_analyzer({"route": "hybrid"}) == "kb_retriever"


def test_kb_evidence_sufficient():
    floor = settings.rag_kb_score_floor
    min_hits = settings.rag_kb_min_hits
    weak = {"kb_passages": [{"score": floor - 0.1}] * max(1, min_hits)}
    assert kb_evidence_sufficient(weak) is False
    strong = {
        "kb_passages": [{"score": floor + 0.1} for _ in range(min_hits)]
    }
    assert kb_evidence_sufficient(strong) is True
    assert kb_evidence_sufficient({"kb_passages": []}) is False


def test_after_kb_gate():
    state = {"route": "hybrid", "kb_passages": []}
    assert after_kb_gate(state) == "web_searcher"
    state2 = {
        "route": "kb",
        "kb_passages": [{"score": 1.0}] * settings.rag_kb_min_hits,
    }
    assert after_kb_gate(state2) == "evidence_merger"
