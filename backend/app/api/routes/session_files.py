"""会话附件：异步摄入、预览、重试；与 knowledge/bibliography 隔离。"""
from __future__ import annotations

import asyncio
import mimetypes
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.db.models import SessionFile, Thread
from app.db.session import get_session_factory
from app.knowledge.contracts import IMAGE_EXTENSIONS
from app.knowledge.ingestion.parser import SESSION_UPLOAD_EXTENSIONS
from app.knowledge.session_docs import (
    get_preview_text,
    mark_session_file_failed,
    preview_kind_for_filename,
    process_session_file_row,
    purge_session_file_vectors,
)
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
    error: str | None = None
    parser: str | None = None
    preview_kind: str | None = None


class SessionFileTextOut(BaseModel):
    filename: str
    text: str
    truncated: bool


def _to_out(row: SessionFile) -> SessionFileOut:
    meta = row.extra_metadata if isinstance(row.extra_metadata, dict) else {}
    err = meta.get("error") if meta else None
    parser = meta.get("parser") if meta else None
    return SessionFileOut(
        id=row.id,
        thread_id=row.thread_id,
        filename=row.filename,
        mode=row.mode,
        chunks_count=row.chunks_count or 0,
        status=row.status,
        size_bytes=row.size_bytes,
        mime_type=row.mime_type,
        created_at=row.created_at,
        error=str(err) if err else None,
        parser=str(parser) if parser else None,
        preview_kind=preview_kind_for_filename(row.filename),
    )


async def _require_thread(session, thread_id: str, user_id: str) -> Thread:
    t = (
        await session.execute(select(Thread).where(Thread.id == thread_id, Thread.user_id == user_id))
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    return t


async def _require_file(session, thread_id: str, file_id: str) -> SessionFile:
    row = (
        await session.execute(
            select(SessionFile).where(SessionFile.id == file_id, SessionFile.thread_id == thread_id)
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    return row


async def _run_ingest_background(file_id: str) -> None:
    factory = get_session_factory()
    try:
        async with factory() as session:
            row = (
                await session.execute(select(SessionFile).where(SessionFile.id == file_id))
            ).scalar_one_or_none()
            if not row:
                return
            try:
                await process_session_file_row(session, row)
            except Exception as e:
                logger.exception("Background session ingest failed for {}: {}", file_id, e)
                await mark_session_file_failed(session, row, str(e))
    except Exception as e:
        logger.exception("Background session ingest session error for {}: {}", file_id, e)


def _schedule_ingest(file_id: str) -> None:
    asyncio.create_task(_run_ingest_background(file_id))


@router.get("/{thread_id}/files", response_model=list[SessionFileOut])
async def list_files(thread_id: str, user: CurrentUser, session: DbSession) -> list[SessionFileOut]:
    await _require_thread(session, thread_id, user.id)
    rows = await session.execute(
        select(SessionFile)
        .where(SessionFile.thread_id == thread_id)
        .order_by(SessionFile.created_at.desc())
    )
    return [_to_out(r) for r in rows.scalars()]


@router.post("/{thread_id}/files", response_model=SessionFileOut)
async def upload_file(
    thread_id: str,
    user: CurrentUser,
    session: DbSession,
    file: UploadFile = File(...),
) -> SessionFileOut:
    await _require_thread(session, thread_id, user.id)

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

    row = SessionFile(
        thread_id=thread_id,
        filename=original,
        storage_path=str(target),
        file_sha256=None,
        size_bytes=target.stat().st_size,
        mime_type=ext.lstrip("."),
        mode="pending",
        status="processing",
        chunks_count=0,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    _schedule_ingest(row.id)
    return _to_out(row)


@router.post("/{thread_id}/files/{file_id}/retry", response_model=SessionFileOut)
async def retry_file(
    thread_id: str, file_id: str, user: CurrentUser, session: DbSession
) -> SessionFileOut:
    await _require_thread(session, thread_id, user.id)
    row = await _require_file(session, thread_id, file_id)
    if row.status not in {"failed", "ready"}:
        raise HTTPException(status_code=400, detail=f"Cannot retry status={row.status}")
    if not row.storage_path or not Path(row.storage_path).is_file():
        raise HTTPException(status_code=400, detail="Storage file missing; please re-upload")
    meta = dict(row.extra_metadata or {})
    meta.pop("error", None)
    row.extra_metadata = meta or None
    row.status = "processing"
    row.mode = "pending"
    await session.commit()
    await session.refresh(row)
    _schedule_ingest(row.id)
    return _to_out(row)


@router.get("/{thread_id}/files/{file_id}/content")
async def file_content(
    thread_id: str, file_id: str, user: CurrentUser, session: DbSession
) -> FileResponse:
    await _require_thread(session, thread_id, user.id)
    row = await _require_file(session, thread_id, file_id)
    if not row.storage_path:
        raise HTTPException(status_code=404, detail="File content unavailable")
    path = Path(row.storage_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File content unavailable")
    mime, _ = mimetypes.guess_type(row.filename)
    return FileResponse(
        path,
        media_type=mime or "application/octet-stream",
        filename=row.filename,
        content_disposition_type="inline",
    )


@router.get("/{thread_id}/files/{file_id}/text", response_model=SessionFileTextOut)
async def file_text(
    thread_id: str, file_id: str, user: CurrentUser, session: DbSession
) -> SessionFileTextOut:
    await _require_thread(session, thread_id, user.id)
    row = await _require_file(session, thread_id, file_id)
    if row.status == "processing":
        raise HTTPException(status_code=409, detail="File still processing")
    if row.status == "failed":
        raise HTTPException(status_code=400, detail="File ingest failed")
    text, truncated = get_preview_text(row)
    if not text and preview_kind_for_filename(row.filename) != "text":
        # PDF/image may still open via /content; text preview empty until ready extract.
        raise HTTPException(status_code=404, detail="No extracted text available")
    return SessionFileTextOut(filename=row.filename, text=text, truncated=truncated)


@router.delete(
    "/{thread_id}/files/{file_id}",
    status_code=204,
    response_class=Response,
    response_model=None,
)
async def delete_file(thread_id: str, file_id: str, user: CurrentUser, session: DbSession) -> Response:
    await _require_thread(session, thread_id, user.id)
    row = await _require_file(session, thread_id, file_id)
    if row.dashscope_file_id:
        try:
            await dashscope_client.delete_file(row.dashscope_file_id)
        except Exception:
            pass
    if row.milvus_namespace or (row.extra_metadata or {}).get("doc_id"):
        try:
            await purge_session_file_vectors(row)
        except Exception:
            pass
    if row.storage_path:
        try:
            Path(row.storage_path).unlink(missing_ok=True)
        except Exception:
            pass
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)
