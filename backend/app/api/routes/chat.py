"""Streaming chat endpoint (fast RAG + Deep Research)."""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.agents.rag.graph import run_rag_stream
from app.agents.research.graph import run_research_stream
from app.api.deps import CurrentUser, DbSession
from app.db.models import Message, Thread, SessionFile
from app.db.session import get_session_factory
from app.knowledge.session_docs import build_session_system_messages

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    thread_id: str | None = None
    query: str
    mode: str = "chat"  # chat | research


async def _load_history(session: AsyncSession, thread_id: str, limit: int = 12) -> list[dict[str, Any]]:
    rows = await session.execute(
        select(Message)
        .where(Message.thread_id == thread_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    msgs = list(reversed(rows.scalars().all()))
    return [
        {"role": m.role, "content": m.content_markdown}
        for m in msgs
        if m.role in {"user", "assistant"} and m.content_markdown
    ]


def _sse(event: dict[str, Any]) -> dict[str, str]:
    return {"event": "message", "data": json.dumps(event, ensure_ascii=False)}


@router.post("")
async def chat(payload: ChatRequest, user: CurrentUser, session: DbSession):
    if not payload.query.strip():
        raise HTTPException(status_code=400, detail="Empty query")
    mode = payload.mode if payload.mode in {"chat", "research"} else "chat"

    # Resolve / create the thread
    thread: Thread | None = None
    if payload.thread_id:
        thread = (
            await session.execute(
                select(Thread).where(Thread.id == payload.thread_id, Thread.user_id == user.id)
            )
        ).scalar_one_or_none()
    if thread is None:
        thread = Thread(
            user_id=user.id,
            title=payload.query.strip()[:32] or "新对话",
            mode=mode,
        )
        session.add(thread)
        await session.commit()
        await session.refresh(thread)
    elif thread.mode != mode:
        thread.mode = mode

    # Persist the user message immediately so the frontend can poll history if needed.
    user_msg = Message(
        thread_id=thread.id,
        role="user",
        mode=mode,
        content_markdown=payload.query,
    )
    session.add(user_msg)
    thread.last_message_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(user_msg)

    history = await _load_history(session, thread.id)
    # Drop the just-saved user echo from history
    if history and history[-1]["role"] == "user" and history[-1]["content"] == payload.query:
        history = history[:-1]

    files_msgs: list[dict[str, str]] = await build_session_system_messages(session, thread.id)
    attachments_meta: list[dict[str, Any]] = []
    rows = (
        await session.execute(select(SessionFile).where(SessionFile.thread_id == thread.id))
    ).scalars().all()
    for r in rows:
        attachments_meta.append(
            {
                "id": r.id,
                "filename": r.filename,
                "mode": r.mode,
                "chunks_count": r.chunks_count,
            }
        )

    user_id = user.id
    thread_id = thread.id
    assistant_message_id = str(uuid.uuid4())

    async def event_stream() -> AsyncIterator[dict[str, str]]:
        factory = get_session_factory()
        async with factory() as work_session:
            try:
                yield _sse(
                    {
                        "type": "ack",
                        "thread_id": thread_id,
                        "user_message_id": user_msg.id,
                        "assistant_message_id": assistant_message_id,
                        "mode": mode,
                    }
                )

                citations: list[dict[str, Any]] = []
                tokens: list[str] = []
                research_events: list[dict[str, Any]] = []
                reasoning: list[str] = []

                if mode == "chat":
                    # Prepend any Files-API system messages so the LLM can use them as context.
                    combined_history = files_msgs + history
                    async for ev in run_rag_stream(
                        work_session,
                        user_id=user_id,
                        thread_id=thread_id,
                        message_id=assistant_message_id,
                        query=payload.query,
                        history=combined_history,
                        attachments=attachments_meta,
                    ):
                        if ev.get("type") == "token":
                            tokens.append(ev.get("content", ""))
                        elif ev.get("type") == "citations_ready":
                            citations = ev.get("items") or []
                        elif ev.get("type") == "final_state":
                            citations = ev.get("citations") or citations
                        elif ev.get("type") == "reasoning":
                            reasoning.append(ev.get("content", ""))
                        yield _sse(ev)
                else:
                    async for ev in run_research_stream(
                        user_id=user_id,
                        thread_id=thread_id,
                        message_id=assistant_message_id,
                        query=payload.query,
                        history=history,
                    ):
                        if ev.get("type") == "token":
                            tokens.append(ev.get("content", ""))
                        elif ev.get("type") == "citations_ready":
                            citations = ev.get("items") or []
                        elif ev.get("type") == "final_state":
                            citations = ev.get("citations") or citations
                        elif ev.get("type") == "research_step":
                            research_events.append(ev)
                        elif ev.get("type") == "reasoning":
                            reasoning.append(ev.get("content", ""))
                        yield _sse(ev)

                content_markdown = "".join(tokens).strip()
                async with factory() as save_session:
                    assistant_msg = Message(
                        id=assistant_message_id,
                        thread_id=thread_id,
                        role="assistant",
                        mode=mode,
                        content_markdown=content_markdown,
                        citations=citations or None,
                        research_events=research_events or None,
                        reasoning="".join(reasoning) or None,
                        attachments=attachments_meta or None,
                    )
                    save_session.add(assistant_msg)
                    th = (
                        await save_session.execute(select(Thread).where(Thread.id == thread_id))
                    ).scalar_one()
                    th.last_message_at = datetime.now(timezone.utc)
                    if th.title in {"新对话", "", None}:
                        th.title = payload.query.strip()[:32] or "新对话"
                    await save_session.commit()

                yield _sse(
                    {
                        "type": "done",
                        "message_id": assistant_message_id,
                        "citations": citations,
                    }
                )
            except Exception as e:
                logger.exception("chat stream failed: {}", e)
                yield _sse({"type": "error", "message": str(e)})

    return EventSourceResponse(event_stream(), media_type="text/event-stream", ping=15)
