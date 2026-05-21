"""引用详情：从 Message.citations 按 id 取预览，供前端 citation 页与悬停。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.db.models import Message, Thread

router = APIRouter(prefix="/api/threads", tags=["citations"])


class CitationOut(BaseModel):
    id: str
    ordinal: int
    title: str | None
    snippet: str | None
    highlight_text: str | None
    parent_text: str | None = None
    content: str | None = None
    source_type: str
    url: str | None = None
    site_name: str | None = None
    heading_path: str | None = None
    era: str | None = None
    series: str | None = None
    relative_path: str | None = None
    doc_id: str | None = None


def _to_out(c: dict[str, Any]) -> CitationOut:
    return CitationOut(
        id=str(c.get("id") or c.get("ordinal")),
        ordinal=int(c.get("ordinal") or 0),
        title=c.get("title"),
        snippet=c.get("snippet"),
        highlight_text=c.get("highlight_text"),
        parent_text=c.get("parent_text"),
        content=c.get("content"),
        source_type=str(c.get("source_type") or "kb"),
        url=c.get("url"),
        site_name=c.get("site_name"),
        heading_path=c.get("heading_path"),
        era=c.get("era"),
        series=c.get("series"),
        relative_path=c.get("relative_path"),
        doc_id=c.get("doc_id"),
    )


@router.get("/{thread_id}/messages/{message_id}/citations", response_model=list[CitationOut])
async def list_citations(
    thread_id: str, message_id: str, user: CurrentUser, session: DbSession
) -> list[CitationOut]:
    t = (
        await session.execute(select(Thread).where(Thread.id == thread_id, Thread.user_id == user.id))
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    m = (
        await session.execute(
            select(Message).where(Message.id == message_id, Message.thread_id == thread_id)
        )
    ).scalar_one_or_none()
    if not m or not m.citations:
        return []
    return [_to_out(c) for c in m.citations]


@router.get(
    "/{thread_id}/messages/{message_id}/citations/{citation_id}",
    response_model=CitationOut,
)
async def get_citation(
    thread_id: str,
    message_id: str,
    citation_id: str,
    user: CurrentUser,
    session: DbSession,
) -> CitationOut:
    t = (
        await session.execute(select(Thread).where(Thread.id == thread_id, Thread.user_id == user.id))
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    m = (
        await session.execute(
            select(Message).where(Message.id == message_id, Message.thread_id == thread_id)
        )
    ).scalar_one_or_none()
    if not m or not m.citations:
        raise HTTPException(status_code=404, detail="Citation not found")
    for c in m.citations:
        if str(c.get("id")) == citation_id or str(c.get("ordinal")) == citation_id:
            return _to_out(c)
    raise HTTPException(status_code=404, detail="Citation not found")
