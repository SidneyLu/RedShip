"""bibliography/ 增量同步：按 SHA-256 检测新增或变更文件。

触发：main 启动后台任务、POST /api/admin/bibliography/sync。
流程：parse → chunk → embed → Milvus upsert → 更新 Document/KnowledgeChunk 状态。
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Document, KnowledgeChunk
from app.knowledge.indexer import (
    IndexableChunk,
    drop_doc,
    ensure_collection,
    upsert_chunks,
)
from app.knowledge.ingestion.chunker import chunk_document, ParentChunk
from app.knowledge.ingestion.parser import parse_document, iter_bibliography
from app.llm.dashscope import dashscope_client

MAX_PARENT_CHUNKS_PER_DOCUMENT = 24


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


_ERA_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"1921|1922|1923|1924|1925|1926|1927|建党|大革命|一大|二大|三大|四大|五大|六大"), "建党与大革命"),
    (re.compile(r"1928|1929|193[0-7]|苏区|土地革命|红军|长征"), "土地革命战争"),
    (re.compile(r"193[7-9]|194[0-5]|抗战|抗日"), "抗日战争"),
    (re.compile(r"194[5-9]|解放战争|建国"), "解放战争"),
    (re.compile(r"195[0-9]|建国后|抗美|大跃进|一五|二五"), "建国初期"),
    (re.compile(r"196[0-9]|文革|文化大革命"), "文革时期"),
    (re.compile(r"197[8-9]|198[0-9]|199[0-9]|改革|开放"), "改革开放"),
]


def infer_era(path: Path, title: str) -> str:
    blob = f"{path.as_posix()} {title}"
    for pat, era in _ERA_RULES:
        if pat.search(blob):
            return era
    return ""


def infer_series(path: Path) -> str:
    parts = path.parts
    # the first directory under the bibliography root is treated as the series
    try:
        idx = parts.index(Path(settings.bibliography_dir).name)
        if idx + 1 < len(parts) - 1:
            return parts[idx + 1]
    except ValueError:
        pass
    if len(parts) >= 2:
        return parts[-2]
    return ""


@dataclass
class SyncSummary:
    scanned: int = 0
    new: int = 0
    updated: int = 0
    skipped: int = 0
    failed: int = 0
    failures: list[tuple[str, str]] = None  # type: ignore

    def __post_init__(self) -> None:
        if self.failures is None:
            self.failures = []


def _sample_parent_chunks(parents: list[ParentChunk]) -> list[ParentChunk]:
    if len(parents) <= MAX_PARENT_CHUNKS_PER_DOCUMENT:
        return parents
    step = (len(parents) - 1) / (MAX_PARENT_CHUNKS_PER_DOCUMENT - 1)
    return [parents[round(i * step)] for i in range(MAX_PARENT_CHUNKS_PER_DOCUMENT)]


async def _ingest_one(
    session: AsyncSession,
    path: Path,
    collection_name: str,
    bibliography_root: Path,
    *,
    source: str = "bibliography",
    relative_path: str | None = None,
    force: bool = False,
) -> str:
    """Parse, chunk, embed, upsert into Milvus, and persist Document/Chunk rows."""
    file_hash = _sha256(path)
    rel = relative_path or (
        str(path.relative_to(bibliography_root))
        if bibliography_root in path.parents or bibliography_root == path.parent
        else str(path)
    )
    existing = (
        await session.execute(select(Document).where(Document.relative_path == rel))
    ).scalar_one_or_none()
    duplicate_by_hash = (
        await session.execute(
            select(Document).where(
                Document.file_sha256 == file_hash,
                Document.relative_path != rel,
            )
        )
    ).scalar_one_or_none()

    if source == "bibliography" and duplicate_by_hash is not None:
        logger.info(
            "Skipping duplicate bibliography file {} (same SHA-256 as {})",
            rel,
            duplicate_by_hash.relative_path,
        )
        return "skipped"

    if (
        not force
        and existing
        and existing.file_sha256 == file_hash
        and existing.status == "indexed"
    ):
        return "skipped"

    if existing:
        await asyncio.to_thread(drop_doc, collection_name, existing.id)
        await session.execute(
            KnowledgeChunk.__table__.delete().where(KnowledgeChunk.document_id == existing.id)
        )

    doc = existing or Document(
        title=path.stem,
        source=source,
        file_path=str(path),
        relative_path=rel,
        mime_type=path.suffix.lstrip("."),
        size_bytes=path.stat().st_size,
        era=infer_era(path, path.stem),
        series=infer_series(path) if source == "bibliography" else "用户上传",
        status="parsing",
    )
    doc.file_sha256 = file_hash
    doc.status = "parsing"
    doc.error = None
    if not existing:
        session.add(doc)
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            duplicate = (
                await session.execute(select(Document).where(Document.file_sha256 == file_hash))
            ).scalar_one_or_none()
            if source == "bibliography" and duplicate is not None:
                logger.info(
                    "Skipping duplicate bibliography file {} (same SHA-256 as {})",
                    rel,
                    duplicate.relative_path,
                )
                return "skipped"
            raise

    parsed = parse_document(path)
    parents: list[ParentChunk] = chunk_document(parsed)
    sampled_count = len(parents)
    parents = _sample_parent_chunks(parents)
    if len(parents) < sampled_count:
        logger.info(
            "Sampled {} representative chunks from {} chunks for {}",
            len(parents),
            sampled_count,
            rel,
        )
    children = [c for p in parents for c in p.children]

    if not children:
        doc.status = "failed"
        doc.error = "No content extracted"
        await session.commit()
        return "failed"

    # Embed
    embeddings = await dashscope_client.embed([c.text for c in children])

    # Build Milvus rows
    rows: list[IndexableChunk] = []
    for child, vec in zip(children, embeddings):
        rows.append(
            IndexableChunk(
                id=f"{doc.id}_{child.parent_index}_{child.child_index_in_parent}",
                text=child.text,
                dense=vec,
                source="bibliography" if source == "bibliography" else source,
                doc_id=doc.id,
                chunk_type="child",
                parent_index=child.parent_index,
                heading_path=child.heading_path[:500],
                era=doc.era or "",
                namespace="",
            )
        )
    upsert_chunks(collection_name, rows)

    # Persist parent chunks
    for parent in parents:
        child_ids = [
            f"{doc.id}_{c.parent_index}_{c.child_index_in_parent}" for c in parent.children
        ]
        session.add(
            KnowledgeChunk(
                document_id=doc.id,
                parent_index=parent.parent_index,
                parent_text=parent.text,
                heading_path=parent.heading_path[:500],
                era=doc.era,
                child_ids=child_ids,
                extra_metadata=parent.metadata or None,
            )
        )

    doc.chunks_count = len(parents)
    doc.status = "indexed"
    await session.commit()
    return "new" if not existing else "updated"


async def ingest_upload_file(
    session: AsyncSession,
    path: Path,
    *,
    original_filename: str | None = None,
) -> Document:
    """Ingest a user-uploaded knowledge document (source=upload)."""
    collection = ensure_collection(settings.milvus_kb_collection)
    rel = f"uploads/{original_filename or path.name}"
    outcome = await _ingest_one(
        session,
        path,
        collection,
        Path(settings.upload_dir),
        source="upload",
        relative_path=rel,
        force=True,
    )
    doc = (
        await session.execute(select(Document).where(Document.relative_path == rel))
    ).scalar_one()
    if outcome == "failed":
        raise ValueError(doc.error or "Ingestion failed")
    return doc


async def reindex_bibliography(session: AsyncSession) -> SyncSummary:
    """Force re-ingest every bibliography file regardless of SHA-256."""
    root = Path(settings.bibliography_dir)
    summary = SyncSummary()
    if not root.exists():
        logger.warning("Bibliography path {} does not exist; skipping reindex.", root)
        return summary

    collection = ensure_collection(settings.milvus_kb_collection)
    for path in iter_bibliography(root):
        summary.scanned += 1
        try:
            outcome = await _ingest_one(
                session, path, collection, root, source="bibliography", force=True
            )
            if outcome == "new":
                summary.new += 1
            elif outcome == "updated":
                summary.updated += 1
            elif outcome == "skipped":
                summary.skipped += 1
            elif outcome == "failed":
                summary.failed += 1
                summary.failures.append((str(path), "no content"))
        except Exception as e:
            await session.rollback()
            logger.exception("Failed to reindex {}: {}", path, e)
            summary.failed += 1
            summary.failures.append((str(path), str(e)[:300]))
    return summary


async def sync_bibliography(session: AsyncSession) -> SyncSummary:
    root = Path(settings.bibliography_dir)
    summary = SyncSummary()
    if not root.exists():
        logger.warning("Bibliography path {} does not exist; skipping sync.", root)
        return summary

    collection = ensure_collection(settings.milvus_kb_collection)

    for path in iter_bibliography(root):
        summary.scanned += 1
        try:
            outcome = await _ingest_one(session, path, collection, root)
            if outcome == "new":
                summary.new += 1
            elif outcome == "updated":
                summary.updated += 1
            elif outcome == "skipped":
                summary.skipped += 1
            elif outcome == "failed":
                summary.failed += 1
                summary.failures.append((str(path), "no content"))
        except Exception as e:  # pragma: no cover
            await session.rollback()
            logger.exception("Failed to ingest {}: {}", path, e)
            summary.failed += 1
            summary.failures.append((str(path), str(e)[:300]))
    return summary


async def stream_sync_bibliography(session: AsyncSession) -> AsyncIterator[dict]:
    """Run sync and yield progress events suitable for SSE."""
    root = Path(settings.bibliography_dir)
    if not root.exists():
        yield {"type": "error", "message": f"Bibliography dir not found: {root}"}
        return

    collection = ensure_collection(settings.milvus_kb_collection)
    files = list(iter_bibliography(root))
    yield {"type": "begin", "total": len(files)}

    summary = SyncSummary()
    for idx, path in enumerate(files, start=1):
        summary.scanned += 1
        yield {"type": "progress", "current": idx, "total": len(files), "path": path.name}
        try:
            outcome = await _ingest_one(session, path, collection, root)
            yield {"type": "file", "path": path.name, "outcome": outcome}
            if outcome == "new":
                summary.new += 1
            elif outcome == "updated":
                summary.updated += 1
            elif outcome == "skipped":
                summary.skipped += 1
            elif outcome == "failed":
                summary.failed += 1
        except Exception as e:
            await session.rollback()
            summary.failed += 1
            yield {"type": "error", "path": path.name, "message": str(e)[:300]}
    yield {
        "type": "done",
        "scanned": summary.scanned,
        "new": summary.new,
        "updated": summary.updated,
        "skipped": summary.skipped,
        "failed": summary.failed,
    }


__all__ = [
    "sync_bibliography",
    "stream_sync_bibliography",
    "reindex_bibliography",
    "ingest_upload_file",
    "SyncSummary",
]
