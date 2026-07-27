"""Unit tests for chat query resolution."""
from __future__ import annotations

import uuid

import pytest

from app.api.routes.chat import ChatRequest, _parse_thread_id, _resolve_query

pytestmark = pytest.mark.unit


def test_resolve_prefers_explicit_query():
    p = ChatRequest(query="  显式问题  ", messages=[{"role": "user", "content": "其他"}])
    assert _resolve_query(p) == "显式问题"


def test_resolve_from_messages():
    p = ChatRequest(
        messages=[
            {"role": "user", "parts": [{"type": "text", "text": "从消息来"}]}
        ]
    )
    assert _resolve_query(p) == "从消息来"


def test_resolve_empty():
    assert _resolve_query(ChatRequest()) == ""


def test_parse_thread_id_accepts_uuid():
    uid = uuid.uuid4()
    assert _parse_thread_id(str(uid)) == uid


def test_parse_thread_id_rejects_nanoid():
    # DefaultChatTransport / useChat client id — not a Postgres UUID
    assert _parse_thread_id("g2joAcjd21dIlwY2") is None
    assert _parse_thread_id("") is None
    assert _parse_thread_id(None) is None
