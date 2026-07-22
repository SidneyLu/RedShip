"""会话附件：上传到 thread，走 Files API 或 session_rag 摄入。

与管理员 knowledge/bibliography 完全隔离，仅写入 session_files + session_chunks。
"""
from __future__ import annotations

import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.db.models import SessionFile, Thread
from app.knowledge.ingestion.parser import IMAGE_EXTENSIONS, SESSION_UPLOAD_EXTENSIONS
from app.knowledge.session_docs import ingest_session_file, purge_session_file_vectors
from app.llm.dashscope import dashscope_client

router = APIRouter(prefix="/api/threads", tags=["session-files"])

_UNSAFE_NAME = re.compile(r"[^\w.\u4e00-\u9fff\-]+", re.UNICODE)


def _safe_filename(name: str | None) -> str:
    raw = (name or "upload.bin").replace("\\", "/").split("/")[-1]
    raw = raw.strip().lstrip(".")
    cleaned = _UNSAFE_NAME.sub("_", raw)[:180] or "upload.bin"
    return cleaned


class SessionFileOut(BaseModel):
    id: str
    thread_id: str
    filename: str
    mode: str
    chunks_count: int
    status: str
    size_bytes: int | None
    mime_type: str | None
    created_at: datetime


def _to_out(row: SessionFile) -> SessionFileOut:
    return SessionFileOut(
        id=row.id,
        thread_id=row.thread_id,
        filename=row.filename,
        mode=row.mode,
        chunks_count=row.chunks_count,
        status=row.status,
        size_bytes=row.size_bytes,
        mime_type=row.mime_type,
        created_at=row.created_at,
    )


@router.get("/{thread_id}/files", response_model=list[SessionFileOut])
async def list_files(thread_id: str, user: CurrentUser, session: DbSession) -> list[SessionFileOut]:
    t = (
        await session.execute(select(Thread).where(Thread.id == thread_id, Thread.user_id == user.id))
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    rows = await session.execute(select(SessionFile).where(SessionFile.thread_id == thread_id))
    return [_to_out(r) for r in rows.scalars()]


@router.post("/{thread_id}/files", response_model=SessionFileOut)
async def upload_file(
    thread_id: str,
    user: CurrentUser,
    session: DbSession,
    file: UploadFile = File(...),
) -> SessionFileOut:
    t = (
        await session.execute(select(Thread).where(Thread.id == thread_id, Thread.user_id == user.id))
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")

    original = _safe_filename(file.filename)
    ext = Path(original).suffix.lower()
    if ext not in SESSION_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {sorted(SESSION_UPLOAD_EXTENSIONS)}",
        )

    upload_root = Path(settings.upload_dir) / "session" / thread_id
    upload_root.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}_{original}"
    target = upload_root / stored_name
    with target.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    if ext in IMAGE_EXTENSIONS and target.stat().st_size > settings.session_image_max_bytes:
        target.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=f"Image exceeds max size {settings.session_image_max_bytes} bytes",
        )

    try:
        row = await ingest_session_file(
            session,
            thread_id=thread_id,
            storage_path=target,
            original_filename=original,
        )
    except Exception as e:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Failed to ingest: {e}") from e
    return _to_out(row)


@router.delete(
    "/{thread_id}/files/{file_id}",
    status_code=204,
    response_class=Response,
    response_model=None,
)
async def delete_file(thread_id: str, file_id: str, user: CurrentUser, session: DbSession) -> Response:
    t = (
        await session.execute(select(Thread).where(Thread.id == thread_id, Thread.user_id == user.id))
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    row = (
        await session.execute(
            select(SessionFile).where(SessionFile.id == file_id, SessionFile.thread_id == thread_id)
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    if row.mode == "files_api" and row.dashscope_file_id:
        try:
            await dashscope_client.delete_file(row.dashscope_file_id)
        except Exception:
            pass
    if row.mode == "session_rag":
        await purge_session_file_vectors(row)
    if row.storage_path:
        try:
            Path(row.storage_path).unlink(missing_ok=True)
        except Exception:
            pass
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)
