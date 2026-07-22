"""用户长期记忆 API：列出 / 删除。"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.memory.user_memory import delete_user_memory, list_user_memories

router = APIRouter(prefix="/api/me/memories", tags=["memories"])


class MemoryOut(BaseModel):
    id: str
    content: str
    category: str
    source_thread_id: str | None
    created_at: datetime
    last_used_at: datetime | None


@router.get("", response_model=list[MemoryOut])
async def get_memories(user: CurrentUser, session: DbSession) -> list[MemoryOut]:
    rows = await list_user_memories(session, user_id=user.id)
    return [
        MemoryOut(
            id=r.id,
            content=r.content,
            category=r.category,
            source_thread_id=r.source_thread_id,
            created_at=r.created_at,
            last_used_at=r.last_used_at,
        )
        for r in rows
    ]


@router.delete(
    "/{memory_id}",
    status_code=204,
    response_class=Response,
    response_model=None,
)
async def remove_memory(memory_id: str, user: CurrentUser, session: DbSession) -> Response:
    ok = await delete_user_memory(session, user_id=user.id, memory_id=memory_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Memory not found")
    return Response(status_code=204)
