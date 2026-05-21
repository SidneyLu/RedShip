"""Thread / message CRUD."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select

from app.api.deps import CurrentUser, DbSession
from app.db.models import Message, SessionFile, Thread
from app.knowledge.session_docs import purge_thread_session_resources

router = APIRouter(prefix="/api/threads", tags=["threads"])


class ThreadCreate(BaseModel):
    title: str | None = None
    mode: str = "chat"


class ThreadOut(BaseModel):
    id: str
    title: str
    mode: str
    pinned: bool
    last_message_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    id: str
    thread_id: str
    role: str
    mode: str
    content_markdown: str
    citations: list[dict[str, Any]] | None
    research_events: list[dict[str, Any]] | None
    attachments: list[dict[str, Any]] | None
    reasoning: str | None
    created_at: datetime


class ThreadWithMessages(ThreadOut):
    messages: list[MessageOut]


def _thread_out(t: Thread) -> ThreadOut:
    return ThreadOut(
        id=t.id,
        title=t.title,
        mode=t.mode,
        pinned=t.pinned,
        last_message_at=t.last_message_at,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


def _message_out(m: Message) -> MessageOut:
    return MessageOut(
        id=m.id,
        thread_id=m.thread_id,
        role=m.role,
        mode=m.mode,
        content_markdown=m.content_markdown,
        citations=m.citations,
        research_events=m.research_events,
        attachments=m.attachments,
        reasoning=m.reasoning,
        created_at=m.created_at,
    )


@router.get("", response_model=list[ThreadOut])
async def list_threads(user: CurrentUser, session: DbSession) -> list[ThreadOut]:
    rows = await session.execute(
        select(Thread)
        .where(Thread.user_id == user.id)
        .order_by(Thread.pinned.desc(), Thread.last_message_at.desc().nulls_last(), Thread.created_at.desc())
    )
    return [_thread_out(t) for t in rows.scalars()]


@router.post("", response_model=ThreadOut)
async def create_thread(payload: ThreadCreate, user: CurrentUser, session: DbSession) -> ThreadOut:
    mode = payload.mode if payload.mode in {"chat", "research"} else "chat"
    t = Thread(user_id=user.id, title=payload.title or "新对话", mode=mode)
    session.add(t)
    await session.commit()
    await session.refresh(t)
    return _thread_out(t)


@router.get("/{thread_id}", response_model=ThreadWithMessages)
async def get_thread(thread_id: str, user: CurrentUser, session: DbSession) -> ThreadWithMessages:
    t = (await session.execute(select(Thread).where(Thread.id == thread_id, Thread.user_id == user.id))).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    rows = await session.execute(select(Message).where(Message.thread_id == t.id).order_by(Message.created_at))
    messages = [_message_out(m) for m in rows.scalars()]
    return ThreadWithMessages(**_thread_out(t).model_dump(), messages=messages)


class ThreadUpdate(BaseModel):
    title: str | None = None
    pinned: bool | None = None


@router.patch("/{thread_id}", response_model=ThreadOut)
async def update_thread(thread_id: str, payload: ThreadUpdate, user: CurrentUser, session: DbSession) -> ThreadOut:
    t = (await session.execute(select(Thread).where(Thread.id == thread_id, Thread.user_id == user.id))).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    if payload.title is not None:
        t.title = payload.title
    if payload.pinned is not None:
        t.pinned = payload.pinned
    await session.commit()
    await session.refresh(t)
    return _thread_out(t)


@router.delete("/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_thread(thread_id: str, user: CurrentUser, session: DbSession) -> None:
    t = (await session.execute(select(Thread).where(Thread.id == thread_id, Thread.user_id == user.id))).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    file_rows = (
        await session.execute(select(SessionFile).where(SessionFile.thread_id == t.id))
    ).scalars().all()
    await purge_thread_session_resources(session, t.id, file_rows)
    await session.execute(delete(Message).where(Message.thread_id == t.id))
    await session.execute(delete(SessionFile).where(SessionFile.thread_id == t.id))
    await session.delete(t)
    await session.commit()
