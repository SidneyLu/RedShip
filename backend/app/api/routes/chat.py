"""SSE 流式聊天：快速问答（chat）与深度研究（research）。

AI SDK UI Message Stream（x-vercel-ai-ui-message-stream: v1）：
  start / data-ack / data-stage / data-research-step / data-artifact / data-citations
  text-start|delta|end · reasoning-start|delta|end · finish · [DONE]
内部 LangGraph 仍产出 dict 事件，在本路由边界经 UIMessageStreamEncoder 翻译。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select

from app.agents.rag.graph import run_rag_stream
from app.agents.research.graph import run_research_stream
from app.agents.research.artifact_parser import extract_artifacts_from_markdown
from app.api.deps import CurrentUser, DbSession
from app.api.streaming.ui_message import (
    UIMessageStreamEncoder,
    extract_user_query,
    ui_message_stream_headers,
)
from app.db.models import Message, SessionFile, Thread
from app.db.session import get_session_factory
from app.memory.session import build_conversation_context, maybe_update_rolling_summary
from app.memory.user_memory import (
    extract_and_store,
    format_memory_system_message,
    retrieve_user_memories,
)

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    """兼容 useChat DefaultChatTransport 与遗留 {thread_id, query, mode}。"""

    id: str | None = None  # useChat chat / thread id
    messages: list[dict[str, Any]] | None = None
    thread_id: str | None = None
    mode: str = "chat"  # chat | research
    query: str | None = None  # 可选遗留字段


def _resolve_query(payload: ChatRequest) -> str:
    if payload.query and payload.query.strip():
        return payload.query.strip()
    from_messages = extract_user_query(payload.messages)
    if from_messages and from_messages.strip():
        return from_messages.strip()
    return ""


@router.post("")
async def chat(payload: ChatRequest, user: CurrentUser, session: DbSession):
    query = _resolve_query(payload)
    if not query:
        raise HTTPException(status_code=400, detail="Empty query")
    mode = payload.mode if payload.mode in {"chat", "research"} else "chat"
    thread_id_hint = payload.thread_id or payload.id

    thread: Thread | None = None
    if thread_id_hint:
        thread = (
            await session.execute(
                select(Thread).where(Thread.id == thread_id_hint, Thread.user_id == user.id)
            )
        ).scalar_one_or_none()
    if thread is None:
        thread = Thread(
            user_id=user.id,
            title=query[:32] or "新对话",
            mode=mode,
        )
        session.add(thread)
        await session.commit()
        await session.refresh(thread)
    elif thread.mode != mode:
        thread.mode = mode

    user_msg = Message(
        thread_id=thread.id,
        role="user",
        mode=mode,
        content_markdown=query,
    )
    session.add(user_msg)
    thread.last_message_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(user_msg)

    ctx = await build_conversation_context(
        session, thread.id, exclude_last_user_query=query
    )
    memory_rows = await retrieve_user_memories(
        session, user_id=user.id, query=query
    )
    memory_sys = format_memory_system_message(memory_rows)

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

    if attachments_meta:
        user_msg.attachments = attachments_meta
        await session.commit()

    user_id = user.id
    thread_id = thread.id
    assistant_message_id = str(uuid.uuid4())
    protected_system = ctx.protected_system_messages()
    if memory_sys:
        protected_system = [memory_sys, *protected_system]
    recent_history = ctx.recent_messages

    async def event_stream() -> AsyncIterator[str]:
        encoder = UIMessageStreamEncoder(message_id=assistant_message_id)
        factory = get_session_factory()
        async with factory() as work_session:
            try:
                for line in encoder.start(
                    thread_id=thread_id,
                    mode=mode,
                    user_message_id=user_msg.id,
                    assistant_message_id=assistant_message_id,
                ):
                    yield line

                citations: list[dict[str, Any]] = []
                tokens: list[str] = []
                research_events: list[dict[str, Any]] = []
                reasoning: list[str] = []

                if mode == "chat":
                    async for ev in run_rag_stream(
                        work_session,
                        user_id=user_id,
                        thread_id=thread_id,
                        message_id=assistant_message_id,
                        query=query,
                        history=recent_history,
                        system_messages=protected_system,
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
                        for line in encoder.map_event(ev):
                            yield line
                else:
                    async for ev in run_research_stream(
                        work_session,
                        user_id=user_id,
                        thread_id=thread_id,
                        message_id=assistant_message_id,
                        query=query,
                        history=recent_history,
                        system_messages=protected_system,
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
                        for line in encoder.map_event(ev):
                            yield line

                content_markdown = "".join(tokens).strip()
                artifacts = (
                    extract_artifacts_from_markdown(content_markdown)
                    if mode == "research"
                    else []
                )
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
                        artifacts=artifacts or None,
                    )
                    save_session.add(assistant_msg)
                    th = (
                        await save_session.execute(select(Thread).where(Thread.id == thread_id))
                    ).scalar_one()
                    th.last_message_at = datetime.now(timezone.utc)
                    if th.title in {"新对话", "", None}:
                        th.title = query[:32] or "新对话"
                    await save_session.commit()

                    try:
                        await maybe_update_rolling_summary(save_session, thread_id)
                    except Exception as e:
                        logger.warning("rolling summary hook failed: {}", e)

                    try:
                        await extract_and_store(
                            save_session,
                            user_id=user_id,
                            thread_id=thread_id,
                            user_query=query,
                            assistant_answer=content_markdown,
                        )
                    except Exception as e:
                        logger.warning("user memory extract hook failed: {}", e)

                for line in encoder.finish():
                    yield line
            except Exception as e:
                logger.exception("chat stream failed: {}", e)
                for line in encoder.emit_error(str(e), terminate=True):
                    yield line

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=ui_message_stream_headers(),
    )
