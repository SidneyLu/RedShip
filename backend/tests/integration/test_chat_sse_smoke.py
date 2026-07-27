"""Integration: chat SSE smoke with mocked RAG stream."""
from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.db.models import Message, Thread

pytestmark = pytest.mark.integration


async def _fake_rag_stream(
    session: Any,
    *,
    user_id: str,
    thread_id: str,
    message_id: str | None,
    query: str,
    history: list | None = None,
    system_messages: list | None = None,
    attachments: list | None = None,
) -> AsyncIterator[dict[str, Any]]:
    yield {
        "type": "ack",
        "thread_id": thread_id,
        "mode": "chat",
        "user_message_id": "u1",
        "assistant_message_id": message_id or "a1",
    }
    yield {
        "type": "analysis",
        "rewritten_query": query,
        "entities": {"persons": ["周恩来"], "organizations": [], "events": []},
        "route": "kb",
    }
    yield {"type": "stage", "name": "generating", "label": "生成中"}
    yield {"type": "token", "content": "这是"}
    yield {"type": "token", "content": "回答"}
    yield {"type": "citations_ready", "items": []}
    yield {"type": "final_state", "citations": [], "content": "这是回答"}


@pytest.mark.asyncio
async def test_chat_sse_smoke(client, auth_header, user):
    with (
        patch("app.api.routes.chat.run_rag_stream", new=_fake_rag_stream),
        patch("app.api.routes.chat.retrieve_user_memories", new=AsyncMock(return_value=[])),
        patch("app.api.routes.chat.maybe_update_rolling_summary", new=AsyncMock(return_value=None)),
        patch("app.api.routes.chat.extract_and_store", new=AsyncMock(return_value=None)),
    ):
        resp = await client.post(
            "/api/chat",
            headers=auth_header,
            json={
                "mode": "chat",
                "messages": [
                    {"role": "user", "parts": [{"type": "text", "text": "测试问题"}]}
                ],
            },
        )
    assert resp.status_code == 200, resp.text
    text = resp.text
    assert "data:" in text
    assert "data-stage" in text or "analysis" in text or "这是" in text


async def _fake_research_stream(
    session: Any,
    *,
    user_id: str,
    thread_id: str,
    message_id: str | None,
    query: str,
    history: list | None = None,
    system_messages: list | None = None,
) -> AsyncIterator[dict[str, Any]]:
    yield {
        "type": "research_step",
        "step": "planning",
        "label": "规划研究子问题...",
    }
    yield {"type": "token", "content": "研究报告"}
    yield {"type": "citations_ready", "items": []}
    yield {"type": "final_state", "citations": [], "content": "研究报告"}


@pytest.mark.asyncio
async def test_research_ignores_usechat_nanoid(client, auth_header, user):
    """New research sends useChat client id (nanoid); must not 500 on UUID cast."""
    with (
        patch("app.api.routes.chat.run_research_stream", new=_fake_research_stream),
        patch("app.api.routes.chat.retrieve_user_memories", new=AsyncMock(return_value=[])),
        patch("app.api.routes.chat.maybe_update_rolling_summary", new=AsyncMock(return_value=None)),
        patch("app.api.routes.chat.extract_and_store", new=AsyncMock(return_value=None)),
    ):
        resp = await client.post(
            "/api/chat",
            headers=auth_header,
            json={
                "id": "g2joAcjd21dIlwY2",
                "mode": "research",
                "messages": [
                    {"role": "user", "parts": [{"type": "text", "text": "深度研究测试"}]}
                ],
            },
        )
    assert resp.status_code == 200, resp.text
    assert "data:" in resp.text
    assert "研究报告" in resp.text or "research" in resp.text


async def _rag_stream_then_cancel(
    session: Any,
    *,
    user_id: str,
    thread_id: str,
    message_id: str | None,
    query: str,
    history: list | None = None,
    system_messages: list | None = None,
    attachments: list | None = None,
) -> AsyncIterator[dict[str, Any]]:
    yield {"type": "token", "content": "半截"}
    yield {"type": "token", "content": "内容"}
    yield {
        "type": "citations_ready",
        "items": [{"id": "c1", "title": "文献A", "snippet": "…"}],
    }
    raise asyncio.CancelledError()


@pytest.mark.asyncio
async def test_chat_persists_partial_on_cancel(client, auth_header, user, db_session):
    """Client abort / CancelledError mid-stream must still persist assistant content."""
    with (
        patch("app.api.routes.chat.run_rag_stream", new=_rag_stream_then_cancel),
        patch("app.api.routes.chat.retrieve_user_memories", new=AsyncMock(return_value=[])),
        patch("app.api.routes.chat.maybe_update_rolling_summary", new=AsyncMock(return_value=None)),
        patch("app.api.routes.chat.extract_and_store", new=AsyncMock(return_value=None)),
    ):
        # Persist runs before CancelledError propagates; httpx ASGI may assert on incomplete
        # response lifecycle when CancelledError escapes the stream generator.
        try:
            await client.post(
                "/api/chat",
                headers=auth_header,
                json={
                    "mode": "chat",
                    "messages": [
                        {
                            "role": "user",
                            "parts": [{"type": "text", "text": "会中断的问题"}],
                        }
                    ],
                },
            )
        except (asyncio.CancelledError, AssertionError):
            pass

    threads = (
        await db_session.execute(select(Thread).where(Thread.user_id == user.id))
    ).scalars().all()
    assert threads, "expected a thread to be created"
    msgs = (
        await db_session.execute(
            select(Message)
            .where(Message.thread_id == threads[-1].id)
            .order_by(Message.created_at)
        )
    ).scalars().all()
    roles = [m.role for m in msgs]
    assert "user" in roles
    assistants = [m for m in msgs if m.role == "assistant"]
    assert assistants, "partial assistant message should be persisted on cancel"
    assert "半截内容" in assistants[-1].content_markdown
    assert assistants[-1].extra_metadata and assistants[-1].extra_metadata.get("incomplete")
    assert assistants[-1].citations and assistants[-1].citations[0]["id"] == "c1"


async def _research_stream_then_cancel(
    session: Any,
    *,
    user_id: str,
    thread_id: str,
    message_id: str | None,
    query: str,
    history: list | None = None,
    system_messages: list | None = None,
) -> AsyncIterator[dict[str, Any]]:
    yield {
        "type": "research_step",
        "step": "planning",
        "label": "规划中",
    }
    yield {"type": "token", "content": "研究半截"}
    raise asyncio.CancelledError()


@pytest.mark.asyncio
async def test_research_persists_partial_on_cancel(client, auth_header, user, db_session):
    with (
        patch("app.api.routes.chat.run_research_stream", new=_research_stream_then_cancel),
        patch("app.api.routes.chat.retrieve_user_memories", new=AsyncMock(return_value=[])),
        patch("app.api.routes.chat.maybe_update_rolling_summary", new=AsyncMock(return_value=None)),
        patch("app.api.routes.chat.extract_and_store", new=AsyncMock(return_value=None)),
    ):
        try:
            await client.post(
                "/api/chat",
                headers=auth_header,
                json={
                    "mode": "research",
                    "messages": [
                        {
                            "role": "user",
                            "parts": [{"type": "text", "text": "深度研究会中断"}],
                        }
                    ],
                },
            )
        except (asyncio.CancelledError, AssertionError):
            pass

    threads = (
        await db_session.execute(select(Thread).where(Thread.user_id == user.id))
    ).scalars().all()
    assert threads
    msgs = (
        await db_session.execute(
            select(Message)
            .where(Message.thread_id == threads[-1].id, Message.role == "assistant")
        )
    ).scalars().all()
    assert msgs
    assert "研究半截" in msgs[-1].content_markdown
    assert msgs[-1].research_events
    assert msgs[-1].extra_metadata and msgs[-1].extra_metadata.get("incomplete")
