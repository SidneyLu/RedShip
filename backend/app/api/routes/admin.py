"""管理员接口：bibliography 增量同步、全量重建索引（可 SSE 进度）。"""
from __future__ import annotations

import json
from typing import AsyncIterator

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from app.api.deps import AdminUser, DbSession
from app.db.session import get_session_factory
from app.knowledge.ingestion.watcher import (
    reindex_bibliography,
    stream_sync_bibliography,
    sync_bibliography,
)
from app.knowledge.kg_extract import rebuild_knowledge_graph
from app.core.audit import write_audit

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/bibliography/sync")
async def trigger_sync(admin: AdminUser, session: DbSession):
    summary = await sync_bibliography(session)
    await write_audit(
        session,
        user_id=admin.id,
        action="bibliography.sync",
        details={
            "scanned": summary.scanned,
            "new": summary.new,
            "updated": summary.updated,
            "failed": summary.failed,
        },
    )
    await session.commit()
    return {
        "scanned": summary.scanned,
        "new": summary.new,
        "updated": summary.updated,
        "skipped": summary.skipped,
        "failed": summary.failed,
        "failures": [{"path": p, "error": e} for p, e in summary.failures[:50]],
    }


@router.post("/bibliography/reindex")
async def trigger_reindex(admin: AdminUser, session: DbSession):
    """Force re-parse and re-embed every bibliography file."""
    summary = await reindex_bibliography(session)
    await write_audit(
        session,
        user_id=admin.id,
        action="bibliography.reindex",
        details={
            "scanned": summary.scanned,
            "updated": summary.updated,
            "failed": summary.failed,
        },
    )
    await session.commit()
    return {
        "scanned": summary.scanned,
        "new": summary.new,
        "updated": summary.updated,
        "skipped": summary.skipped,
        "failed": summary.failed,
        "failures": [{"path": p, "error": e} for p, e in summary.failures[:50]],
    }


@router.get("/bibliography/sync/stream")
async def sync_stream(admin: AdminUser):
    factory = get_session_factory()

    async def event_gen() -> AsyncIterator[dict[str, str]]:
        async with factory() as work_session:
            async for ev in stream_sync_bibliography(work_session):
                yield {"event": "message", "data": json.dumps(ev, ensure_ascii=False)}

    return EventSourceResponse(event_gen(), media_type="text/event-stream", ping=15)


@router.post("/knowledge/graph/rebuild")
async def rebuild_graph(
    admin: AdminUser,
    session: DbSession,
    extract_entities: bool = True,
    limit: int | None = None,
):
    """重建知识图谱（不重 embed）；可选限制文档数。"""
    summary = await rebuild_knowledge_graph(
        session, extract_entities=extract_entities, limit=limit
    )
    await write_audit(
        session,
        user_id=admin.id,
        action="knowledge.graph.rebuild",
        details={
            "documents": summary.get("documents"),
            "ok": summary.get("ok"),
            "failed": summary.get("failed"),
        },
    )
    await session.commit()
    return summary
