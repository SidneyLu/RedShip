"""Session-scoped document intelligence.

Per PLAN.md — strict two-path routing, no cross-fallback:

  ≤ FILES_API_INLINE_MAX_TOKENS  → DashScope Files API (`fileid://` in system message)
  > threshold                    → MinerU parse → chunk → embed → Milvus session namespace
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
from app.knowledge.indexer import (
    IndexableChunk,
    ensure_collection,
    upsert_chunks,
)
from app.knowledge.ingestion.chunker import chunk_document
from app.knowledge.ingestion.parser import parse_document
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
    """Decide Files API vs session RAG before ingestion — no runtime fallback."""
    ext = path.suffix.lower()
    size = path.stat().st_size

    if ext in {".md", ".markdown", ".txt", ".text"}:
        text = path.read_text(encoding="utf-8", errors="strict")
        return _estimate_tokens(text) <= settings.files_api_inline_max_tokens

    if ext in {".pdf", ".docx"}:
        # Binary formats: size heuristic aligned with ~60 pages / 100k tokens in PLAN.
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
    parsed = parse_document(storage_path)
    parents = chunk_document(parsed)
    children = [c for p in parents for c in p.children]
    if not children:
        raise ValueError("No content could be extracted from the uploaded file.")

    embeddings = await dashscope_client.embed([c.text for c in children])
    collection = ensure_collection(settings.milvus_kb_collection)
    namespace = f"{settings.session_doc_chunk_prefix}{thread_id}"
    fake_doc_id = f"sess_{thread_id}_{sha[:12]}"

    rows = [
        IndexableChunk(
            id=f"{fake_doc_id}_{child.parent_index}_{child.child_index_in_parent}",
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

    logger.info("Session file {} → MinerU + session RAG path", original_filename)
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

    collection = settings.milvus_kb_collection
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
    return [
        {"role": "system", "content": f"fileid://{r.dashscope_file_id}"}
        for r in rows
        if r.dashscope_file_id
    ]


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
