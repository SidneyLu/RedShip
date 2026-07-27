"""Unit tests for citation helper functions."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.routes.citations import _find_citation, _text_excerpt, _trust_score

pytestmark = pytest.mark.unit


def test_trust_score_clamps_and_defaults():
    assert _trust_score({"score": 0.5}) == 0.5
    assert _trust_score({"score": 2.0}) == 1.0
    assert _trust_score({"source_type": "kb"}) == 0.9
    assert _trust_score({"source_type": "web"}) == 0.6


def test_text_excerpt_truncates():
    assert _text_excerpt(None) is None
    short = _text_excerpt("hello")
    assert short == "hello"
    long = "字" * 600
    out = _text_excerpt(long, limit=50)
    assert out is not None and out.endswith("…")
    assert len(out) <= 50


def test_find_citation_by_id_or_ordinal():
    msg = SimpleNamespace(
        citations=[
            {"id": "c-1", "ordinal": 1, "title": "A"},
            {"id": "c-2", "ordinal": 2, "title": "B"},
        ]
    )
    assert _find_citation(msg, "c-2")["title"] == "B"
    assert _find_citation(msg, "1")["title"] == "A"
    with pytest.raises(HTTPException):
        _find_citation(msg, "missing")
