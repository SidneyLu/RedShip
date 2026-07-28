"""会话级文档智能（PLAN.md「文档智能」）。

严格双路径，无运行时回退：
  ≤ FILES_API_INLINE_MAX_TOKENS → DashScope Files API（system 中 fileid://）
  > 阈值 / 图片 → 解析 → 分块 → embed → Milvus session_chunks（与 knowledge_base 隔离）
"""
from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from typing import Iterable

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import SessionFile
from app.knowledge.contracts import IMAGE_EXTENSIONS, build_child_chunk_id
from app.knowledge.indexer import (
    IndexableChunk,
    ensure_collection,
    upsert_chunks,
)
from app.knowledge.ingestion.chunker import chunk_document
from app.knowledge.ingestion.parser import (
    SESSION_UPLOAD_EXTENSIONS,
    parse_document,
    parse_image_document,
)
from app.llm.dashscope import dashscope_client


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    chinese = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    other = len(text) - chinese
    return chinese + max(1, other // 4)


def _file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _uses_files_api(path: Path) -> bool:
    """上传前判定走 Files API 还是会话 Milvus；图片一律 session_rag。"""
    ext = path.suffix.lower()
    size = path.stat().st_size

    if ext in IMAGE_EXTENSIONS:
        return False

    if ext in {".md", ".markdown", ".txt", ".text"}:
        text = path.read_text(encoding="utf-8", errors="strict")
        return _estimate_tokens(text) <= settings.files_api_inline_max_tokens

    if ext in {".pdf", ".docx"}:
        return size <= settings.files_api_inline_max_bytes

    raise ValueError(f"Unsupported session upload type: {ext}")


async def _ingest_files_api(
    session: AsyncSession,
    *,
    thread_id: str,
    storage_path: Path,
    original_filename: str,
    sha: str,
    size: int,
    ext: str,
) -> SessionFile:
    file_id = await dashscope_client.upload_file(storage_path)
    row = SessionFile(
        thread_id=thread_id,
        filename=original_filename,
        storage_path=str(storage_path),
        file_sha256=sha,
        size_bytes=size,
        mime_type=ext.lstrip("."),
        mode="files_api",
        dashscope_file_id=file_id,
        status="ready",
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def _ingest_session_rag(
    session: AsyncSession,
    *,
    thread_id: str,
    storage_path: Path,
    original_filename: str,
    sha: str,
    size: int,
    ext: str,
) -> SessionFile:
    if ext in IMAGE_EXTENSIONS:
        parsed = await parse_image_document(storage_path)
    else:
        parsed = parse_document(storage_path)

    full = parsed.full_text().strip()
    if ext in ({".pdf", ".docx"} | IMAGE_EXTENSIONS) and len(full) < settings.session_min_extract_chars:
        raise ValueError(
            f"Extracted text too short ({len(full)} chars) for {original_filename}. "
            "若为扫描件请确认 MINERU_OCR=true；图片请检查 VISION_MODEL 可用性。"
        )

    parents = chunk_document(parsed)
    children = [c for p in parents for c in p.children]
    if not children:
        raise ValueError("No content could be extracted from the uploaded file.")

    embeddings = await dashscope_client.embed([c.text for c in children])
    collection = ensure_collection(settings.milvus_session_collection)
    namespace = f"{settings.session_doc_chunk_prefix}{thread_id}"
    fake_doc_id = f"sess_{thread_id}_{sha[:12]}"

    rows = [
        IndexableChunk(
            id=build_child_chunk_id(
                fake_doc_id, child.parent_index, child.child_index_in_parent
            ),
            text=child.text,
            dense=vec,
            source="session",
            doc_id=fake_doc_id,
            chunk_type="child",
            parent_index=child.parent_index,
            heading_path=child.heading_path[:500],
            era="",
            namespace=namespace,
        )
        for child, vec in zip(children, embeddings)
    ]
    upsert_chunks(collection, rows)

    row = SessionFile(
        thread_id=thread_id,
        filename=original_filename,
        storage_path=str(storage_path),
        file_sha256=sha,
        size_bytes=size,
        mime_type=ext.lstrip("."),
        mode="session_rag",
        milvus_namespace=namespace,
        chunks_count=len(parents),
        status="ready",
        extra_metadata={"doc_id": fake_doc_id, "title": parsed.title},
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def ingest_session_file(
    session: AsyncSession,
    *,
    thread_id: str,
    storage_path: Path,
    original_filename: str,
) -> SessionFile:
    sha = _file_sha(storage_path)
    size = storage_path.stat().st_size
    ext = storage_path.suffix.lower()
    if ext not in SESSION_UPLOAD_EXTENSIONS:
        raise ValueError(f"Unsupported session upload type: {ext}")
    if ext in IMAGE_EXTENSIONS and size > settings.session_image_max_bytes:
        raise ValueError(
            f"Image too large ({size} bytes); max {settings.session_image_max_bytes}"
        )

    if _uses_files_api(storage_path):
        logger.info("Session file {} → Files API path", original_filename)
        return await _ingest_files_api(
            session,
            thread_id=thread_id,
            storage_path=storage_path,
            original_filename=original_filename,
            sha=sha,
            size=size,
            ext=ext,
        )

    logger.info("Session file {} → session RAG path", original_filename)
    return await _ingest_session_rag(
        session,
        thread_id=thread_id,
        storage_path=storage_path,
        original_filename=original_filename,
        sha=sha,
        size=size,
        ext=ext,
    )


async def purge_session_file_vectors(row: SessionFile) -> None:
    from app.knowledge.indexer import drop_doc, drop_namespace

    collection = settings.milvus_session_collection
    if row.mode == "session_rag":
        meta = row.extra_metadata or {}
        doc_id = meta.get("doc_id")
        if doc_id:
            await asyncio.to_thread(drop_doc, collection, str(doc_id))
        elif row.milvus_namespace:
            await asyncio.to_thread(drop_namespace, collection, row.milvus_namespace)


async def purge_thread_session_resources(
    session: AsyncSession, thread_id: str, rows: Iterable[SessionFile] | None = None
) -> None:
    if rows is None:
        rows = (
            await session.execute(select(SessionFile).where(SessionFile.thread_id == thread_id))
        ).scalars().all()
    for row in rows:
        if row.mode == "files_api" and row.dashscope_file_id:
            try:
                await dashscope_client.delete_file(row.dashscope_file_id)
            except Exception as e:
                logger.warning("Failed to delete DashScope file {}: {}", row.dashscope_file_id, e)
        if row.mode == "session_rag":
            await purge_session_file_vectors(row)


async def build_session_system_messages(
    session: AsyncSession, thread_id: str
) -> list[dict[str, str]]:
    rows = (
        await session.execute(
            select(SessionFile).where(
                SessionFile.thread_id == thread_id,
                SessionFile.mode == "files_api",
                SessionFile.status == "ready",
            )
        )
    ).scalars().all()
    messages: list[dict[str, str]] = []
    for row in rows:
        if row.dashscope_file_id:
            messages.append({"role": "system", "content": f"fileid://{row.dashscope_file_id}"})
        inline = _inline_text_attachment(row)
        if inline:
            messages.append(inline)
    return messages


def _inline_text_attachment(row: SessionFile) -> dict[str, str] | None:
    """Expose small text attachments to models that cannot read fileid://."""
    if not row.storage_path:
        return None
    path = Path(row.storage_path)
    if path.suffix.lower() not in {".md", ".markdown", ".txt", ".text"}:
        return None
    try:
        text = path.read_text(encoding="utf-8", errors="ignore").strip()
    except OSError:
        return None
    if not text:
        return None
    max_chars = 20_000
    clipped = text[:max_chars]
    suffix = "\n\n（附件内容已截断）" if len(text) > max_chars else ""
    return {
        "role": "system",
        "content": f"会话附件《{row.filename}》内容：\n{clipped}{suffix}",
    }


async def session_namespace_filter(
    session: AsyncSession, thread_id: str
) -> str | None:
    rows = (
        await session.execute(
            select(SessionFile).where(
                SessionFile.thread_id == thread_id,
                SessionFile.mode == "session_rag",
                SessionFile.status == "ready",
            )
        )
    ).scalars().all()
    ns_values = [r.milvus_namespace for r in rows if r.milvus_namespace]
    if not ns_values:
        return None
    items = ", ".join(f'"{v}"' for v in ns_values)
    return f"namespace in [{items}]"
