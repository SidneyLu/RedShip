"""Unit tests for UI message SSE helpers."""
from __future__ import annotations

import json

import pytest

from app.api.streaming.ui_message import (
    UIMessageStreamEncoder,
    extract_user_query,
    format_sse,
    ui_message_stream_headers,
)

pytestmark = pytest.mark.unit


def test_format_sse_dict_and_string():
    line = format_sse({"type": "text-delta", "delta": "hi"})
    assert line.startswith("data: ")
    assert line.endswith("\n\n")
    assert json.loads(line[6:].strip())["delta"] == "hi"
    assert format_sse("[DONE]") == "data: [DONE]\n\n"


def test_headers_include_ui_stream_flag():
    h = ui_message_stream_headers()
    assert h["x-vercel-ai-ui-message-stream"] == "v1"


def test_extract_user_query_from_parts():
    messages = [
        {"role": "assistant", "parts": [{"type": "text", "text": "prev"}]},
        {"role": "user", "parts": [{"type": "text", "text": "长征意义？"}]},
    ]
    assert extract_user_query(messages) == "长征意义？"


def test_extract_user_query_from_content_string():
    assert extract_user_query([{"role": "user", "content": "  你好  "}]) == "你好"
    assert extract_user_query([]) == ""


def test_encoder_maps_analysis_to_data_stage():
    enc = UIMessageStreamEncoder(message_id="m1")
    chunks = enc.map_event(
        {
            "type": "analysis",
            "rewritten_query": "q",
            "entities": {"persons": ["周恩来"]},
        }
    )
    assert chunks
    payload = json.loads(chunks[0][6:].strip())
    assert payload["type"] == "data-stage"
    assert payload["data"]["name"] == "analysis"
    assert payload["data"]["entities"]["persons"] == ["周恩来"]
