"""Unit tests for knowledge graph helpers."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.knowledge.kg_extract import _edge_payload, _node_payload, _safe_json, canonical_key

pytestmark = pytest.mark.unit


def test_canonical_key_normalizes():
    assert canonical_key("person", "  周恩来  ") == "person:周恩来"
    assert canonical_key("person", "Zhou Enlai") == "person:zhouenlai"


def test_safe_json_valid_and_invalid():
    assert _safe_json('{"a": 1}') == {"a": 1}
    assert _safe_json("not json") == {}
    assert _safe_json('{"entities":[]}')["entities"] == []


def test_node_and_edge_payload():
    ent = SimpleNamespace(
        id="e1",
        name="周恩来",
        type="person",
        canonical_key="person:周恩来",
        doc_count=3,
        extra_metadata={"x": 1},
    )
    node = _node_payload(ent)
    assert node["id"] == "e1"
    assert node["label"] == "周恩来"
    assert node["size"] == 3

    edge = SimpleNamespace(
        id="edge1",
        src_entity_id="a",
        dst_entity_id="b",
        relation="related_to",
        document_id="d1",
        weight=1.5,
        evidence="证据",
    )
    ep = _edge_payload(edge)
    assert ep["source"] == "a"
    assert ep["target"] == "b"
    assert ep["relation"] == "related_to"
