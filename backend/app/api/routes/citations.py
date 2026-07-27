"""引用详情：从 Message.citations 按 id 取预览，供前端 citation 页与悬停。"""
from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.db.models import Document, KnowledgeChunk, Message, Thread

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
    parent_index: int | None = None
    locator_label: str | None = None
    previewable: bool | None = None
    preview_mode: str | None = None
    media_url: str | None = None
    score: float | None = None


class CitationPreviewCard(BaseModel):
    citation_id: str
    title: str
    subtitle: str | None = None
    locator_label: str | None = None
    excerpt: str | None = None
    score: float | None = None
    trust_score: float
    href: str
    external_url: str | None = None
    previewable: bool
    preview_mode: Literal["text", "pdf", "image", "web"] | None = None
    media_url: str | None = None


class CitationPreviewPage(BaseModel):
    citation_id: str
    title: str
    subtitle: str | None = None
    locator_label: str | None = None
    excerpt: str | None = None
    content: str | None = None
    highlight_text: str | None = None
    score: float | None = None
    trust_score: float
    preview_mode: Literal["text", "pdf", "image", "web"]
    page_hint: int | None = None
    external_url: str | None = None
    metadata: dict[str, Any] | None = None
    media_url: str | None = None


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
        parent_index=_int_or_none(c.get("parent_index")),
        locator_label=c.get("locator_label"),
        previewable=bool(c.get("previewable")) if c.get("previewable") is not None else None,
        preview_mode=c.get("preview_mode"),
        media_url=c.get("media_url"),
        score=_score_or_none(c.get("score")),
    )


def _int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _score_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _trust_score(c: dict[str, Any]) -> float:
    score = _score_or_none(c.get("score"))
    if score is None:
        return 0.9 if str(c.get("source_type") or "kb") != "web" else 0.6
    return max(0.0, min(1.0, score))


def _text_excerpt(text: str | None, limit: int = 520) -> str | None:
    if not text:
        return None
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def _find_citation(message: Message, citation_id: str) -> dict[str, Any]:
    if not message.citations:
        raise HTTPException(status_code=404, detail="Citation not found")
    for c in message.citations:
        if str(c.get("id")) == citation_id or str(c.get("ordinal")) == citation_id:
            return c
    raise HTTPException(status_code=404, detail="Citation not found")


async def _load_message(
    thread_id: str, message_id: str, user: CurrentUser, session: DbSession
) -> Message:
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
    if not m:
        raise HTTPException(status_code=404, detail="Citation not found")
    return m


async def _lookup_source(
    c: dict[str, Any], session: DbSession
) -> tuple[Document | None, KnowledgeChunk | None]:
    doc_id = c.get("doc_id")
    if not doc_id:
        return None, None
    try:
        uuid.UUID(str(doc_id))
    except ValueError:
        return None, None

    doc = (
        await session.execute(select(Document).where(Document.id == str(doc_id)))
    ).scalar_one_or_none()

    parent: KnowledgeChunk | None = None
    parent_index = _int_or_none(c.get("parent_index"))
    if parent_index is not None:
        parent = (
            await session.execute(
                select(KnowledgeChunk).where(
                    KnowledgeChunk.document_id == str(doc_id),
                    KnowledgeChunk.parent_index == parent_index,
                )
            )
        ).scalar_one_or_none()
    return doc, parent


def _preview_payload(
    *,
    c: dict[str, Any],
    thread_id: str,
    message_id: str,
    doc: Document | None,
    parent: KnowledgeChunk | None,
) -> dict[str, Any]:
    citation_id = str(c.get("id") or c.get("ordinal"))
    source_type = str(c.get("source_type") or "kb")
    is_web = source_type == "web"
    title = str(c.get("title") or (doc.title if doc else "") or c.get("site_name") or "引用详情")
    heading_path = c.get("heading_path") or (parent.heading_path if parent else None)
    relative_path = c.get("relative_path") or (doc.relative_path if doc else None)
    locator = c.get("locator_label") or heading_path or relative_path or title
    content = c.get("content") or c.get("parent_text") or (parent.parent_text if parent else None)
    highlight = c.get("highlight_text") or c.get("snippet")
    excerpt = _text_excerpt(highlight or content or c.get("snippet"))
    parent_index = _int_or_none(c.get("parent_index"))
    if parent_index is None and parent is not None:
        parent_index = parent.parent_index

    preview_mode = str(c.get("preview_mode") or "")
    media_url = c.get("media_url")
    if not preview_mode:
        if is_web:
            preview_mode = "web"
        elif doc and isinstance(doc.extra_metadata, dict) and doc.extra_metadata.get("media_type") == "image":
            preview_mode = "image"
            media_url = media_url or f"/api/knowledge/documents/{doc.id}/media"
        else:
            preview_mode = "text"

    if preview_mode == "image" and not media_url and doc:
        media_url = f"/api/knowledge/documents/{doc.id}/media"

    # web：有正文可预览；image：始终可预览；其余默认非 web
    if c.get("previewable") is not None:
        previewable = bool(c.get("previewable"))
    elif preview_mode == "image":
        previewable = True
    elif is_web:
        previewable = bool(content)
    else:
        previewable = True

    metadata = {
        "doc_id": c.get("doc_id"),
        "relative_path": relative_path,
        "heading_path": heading_path,
        "era": c.get("era") or (parent.era if parent else None) or (doc.era if doc else None),
        "series": c.get("series") or (doc.series if doc else None),
        "parent_index": parent_index,
        "source_type": source_type,
        "media_url": media_url,
        "preview_mode": preview_mode,
    }
    metadata = {k: v for k, v in metadata.items() if v not in (None, "")}

    return {
        "citation_id": citation_id,
        "title": title,
        "subtitle": relative_path or heading_path,
        "locator_label": locator,
        "excerpt": excerpt,
        "content": content,
        "highlight_text": highlight,
        "score": _score_or_none(c.get("score")),
        "trust_score": _trust_score(c),
        "href": f"/threads/{thread_id}/messages/{message_id}/citations/{citation_id}",
        "external_url": c.get("url"),
        "previewable": previewable,
        "preview_mode": preview_mode,
        "page_hint": parent_index + 1 if parent_index is not None else None,
        "metadata": metadata,
        "media_url": media_url,
    }


@router.get("/{thread_id}/messages/{message_id}/citations", response_model=list[CitationOut])
async def list_citations(
    thread_id: str, message_id: str, user: CurrentUser, session: DbSession
) -> list[CitationOut]:
    m = await _load_message(thread_id, message_id, user, session)
    if not m.citations:
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
    m = await _load_message(thread_id, message_id, user, session)
    return _to_out(_find_citation(m, citation_id))


@router.get(
    "/{thread_id}/messages/{message_id}/citations/{citation_id}/preview",
    response_model=CitationPreviewCard | CitationPreviewPage,
)
async def preview_citation(
    thread_id: str,
    message_id: str,
    citation_id: str,
    user: CurrentUser,
    session: DbSession,
    detail: Literal["card", "page"] = Query(default="card"),
) -> CitationPreviewCard | CitationPreviewPage:
    m = await _load_message(thread_id, message_id, user, session)
    c = _find_citation(m, citation_id)
    doc, parent = await _lookup_source(c, session)
    payload = _preview_payload(
        c=c,
        thread_id=thread_id,
        message_id=message_id,
        doc=doc,
        parent=parent,
    )
    if detail == "page":
        return CitationPreviewPage(**payload)
    return CitationPreviewCard(**payload)
