"""Unit tests for DashScope response helpers (no network)."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.llm.dashscope import (
    _is_multimodal_model,
    _is_quota_error,
    _model_candidates,
    _normalize_chat_response,
    _to_multimodal_messages,
)

pytestmark = pytest.mark.unit


def test_is_multimodal_model():
    assert _is_multimodal_model("qwen3.5-flash") is True
    assert _is_multimodal_model("qwen-turbo") is False


def test_to_multimodal_messages():
    msgs = [{"role": "user", "content": "hi"}]
    out = _to_multimodal_messages(msgs)
    assert out[0]["content"] == [{"text": "hi"}]


def test_model_candidates_includes_fallback():
    c = _model_candidates("my-model")
    assert c[0] == "my-model"
    assert "qwen-turbo" in c


def test_is_quota_error():
    assert _is_quota_error(RuntimeError("FreeTierOnly quota exceeded"))
    assert not _is_quota_error(RuntimeError("timeout"))


def test_normalize_chat_response_dict_like():
    resp = SimpleNamespace(
        status_code=200,
        request_id="req-1",
        usage={"total_tokens": 3},
        output={
            "choices": [
                {
                    "message": {"content": "答案", "role": "assistant"},
                    "finish_reason": "stop",
                }
            ]
        },
    )
    result = _normalize_chat_response(resp)
    assert result["choices"][0]["message"]["content"] == "答案"
    assert result["choices"][0]["finish_reason"] == "stop"
