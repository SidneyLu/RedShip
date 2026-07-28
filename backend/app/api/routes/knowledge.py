"""知识库文档列表、详情与管理员上传（触发 ingest_upload_file）。

Reserved source-PDF contract (MD ↔ original PDF):
  GET  /api/knowledge/documents/{id}/source|original
       → JSON probe { available, mime_type, relative_path?, filename? }
       → with Accept: application/pdf (and no application/json) → stream PDF
  GET  .../source/file | .../original/file | .../pdf
       → stream PDF, or 404 JSON { available: false, detail }

Pairing (see app.knowledge.source_pdf): extra_metadata source_pdf|original_path|
original_pdf first, else self .pdf, else sibling stem (foo.md ↔ foo.pdf under
bibliography/ or uploads/). Missing PDF does not affect MD RAG indexing.
"""
from __future__ import annotations

import mimetypes
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AdminUser, CurrentUser, DbSession
from app.core.audit import write_audit
from app.core.config import settings
from app.db.models import Document, KnowledgeChunk
from app.knowledge.indexer import drop_doc
from app.knowledge.ingestion.watcher import ingest_upload_file
from app.knowledge.kg_extract import query_ego_graph, query_graph
from app.knowledge.source_pdf import resolve_source_pdf

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


class DocumentOut(BaseModel):
    id: str
    title: str
    source: str
    status: str
    relative_path: str | None
    era: str | None
    series: str | None
    chunks_count: int
    size_bytes: int | None
    error: str | None
    extra_metadata: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime


class KnowledgeStats(BaseModel):
    total_documents: int
    indexed_documents: int
    pending_documents: int
    failed_documents: int
    total_chunks: int
    by_era: list[dict[str, Any]]
    by_series: list[dict[str, Any]]


def _doc_out(d: Document) -> DocumentOut:
    return DocumentOut(
        id=d.id,
        title=d.title,
        source=d.source,
        status=d.status,
        relative_path=d.relative_path,
        era=d.era,
        series=d.series,
        chunks_count=d.chunks_count,
        size_bytes=d.size_bytes,
        error=d.error,
        extra_metadata=d.extra_metadata,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


@router.get("/stats", response_model=KnowledgeStats)
async def stats(user: CurrentUser, session: DbSession) -> KnowledgeStats:
    total = (await session.execute(select(func.count(Document.id)))).scalar_one()
    indexed = (
        await session.execute(select(func.count(Document.id)).where(Document.status == "indexed"))
    ).scalar_one()
    pending = (
        await session.execute(
            select(func.count(Document.id)).where(Document.status.in_(["pending", "parsing"]))
        )
    ).scalar_one()
    failed = (
        await session.execute(select(func.count(Document.id)).where(Document.status == "failed"))
    ).scalar_one()
    chunks = (await session.execute(select(func.coalesce(func.sum(Document.chunks_count), 0)))).scalar_one()

    era_rows = (
        await session.execute(
            select(Document.era, func.count(Document.id))
            .where(Document.status == "indexed")
            .group_by(Document.era)
        )
    ).all()
    series_rows = (
        await session.execute(
            select(Document.series, func.count(Document.id))
            .where(Document.status == "indexed")
            .group_by(Document.series)
        )
    ).all()
    return KnowledgeStats(
        total_documents=int(total),
        indexed_documents=int(indexed),
        pending_documents=int(pending),
        failed_documents=int(failed),
        total_chunks=int(chunks),
        by_era=[{"era": e or "未分类", "count": int(c)} for e, c in era_rows],
        by_series=[{"series": s or "未归类", "count": int(c)} for s, c in series_rows],
    )


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(
    user: CurrentUser,
    session: DbSession,
    era: str | None = None,
    series: str | None = None,
    status: str | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[DocumentOut]:
    stmt = select(Document)
    if era:
        stmt = stmt.where(Document.era == era)
    if series:
        stmt = stmt.where(Document.series == series)
    if status:
        stmt = stmt.where(Document.status == status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Document.title.ilike(like) | Document.relative_path.ilike(like))
    stmt = stmt.order_by(desc(Document.updated_at)).offset(offset).limit(min(limit, 200))
    rows = await session.execute(stmt)
    return [_doc_out(d) for d in rows.scalars()]


@router.get("/documents/{document_id}", response_model=DocumentOut)
async def get_document(
    user: CurrentUser,
    session: DbSession,
    document_id: str,
) -> DocumentOut:
    doc = await session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return _doc_out(doc)


@router.post("/documents/{document_id}/reparse", response_model=DocumentOut)
async def reparse_document(
    admin: AdminUser,
    session: DbSession,
    document_id: str,
    parser: str = Query(default="vision", description="vision|vision_pdf|mineru"),
) -> DocumentOut:
    """Re-run ingest for an existing document (admin)."""
    doc = await session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    meta = doc.extra_metadata if isinstance(doc.extra_metadata, dict) else {}
    pdf_path = meta.get("source_pdf") or doc.file_path
    path = Path(str(pdf_path)) if pdf_path else None
    if not path or not path.is_file():
        raise HTTPException(status_code=400, detail="Source file missing for reparse")
    try:
        updated = await ingest_upload_file(
            session,
            path,
            original_filename=path.name,
            parser=parser,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Reparse failed: {e}") from e
    await write_audit(
        session,
        user_id=admin.id,
        action="knowledge.reparse",
        target_type="document",
        target_id=updated.id,
        details={"parser": parser},
    )
    await session.commit()
    await session.refresh(updated)
    return _doc_out(updated)


@router.post("/documents/upload", response_model=DocumentOut)
async def upload_document(
    admin: AdminUser,
    session: DbSession,
    file: UploadFile = File(...),
    parser: str | None = Query(
        default=None,
        description="Optional parser override: vision|vision_pdf|mineru",
    ),
) -> DocumentOut:
    """Upload a PDF/MD/DOCX/image into the knowledge base (admin only)."""
    safe_name = file.filename or "upload.bin"
    ext = Path(safe_name).suffix.lower()
    if ext not in {".pdf", ".md", ".markdown", ".txt", ".docx", ".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    upload_root = Path(settings.upload_dir) / "knowledge"
    upload_root.mkdir(parents=True, exist_ok=True)
    target = upload_root / safe_name
    with target.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    try:
        doc = await ingest_upload_file(
            session, target, original_filename=safe_name, parser=parser
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Ingestion failed: {e}") from e

    await write_audit(
        session,
        user_id=admin.id,
        action="knowledge.upload",
        target_type="document",
        target_id=doc.id,
        details={"filename": safe_name, "relative_path": doc.relative_path, "parser": parser},
    )
    await session.commit()
    await session.refresh(doc)
    return _doc_out(doc)


@router.delete(
    "/documents/{document_id}",
    status_code=204,
    response_class=Response,
    response_model=None,
)
async def delete_document(document_id: str, admin: AdminUser, session: DbSession) -> Response:
    """Remove an uploaded knowledge document and its Milvus vectors."""
    doc = (await session.execute(select(Document).where(Document.id == document_id))).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.source not in {"upload"}:
        raise HTTPException(status_code=400, detail="Only user-uploaded documents can be deleted")

    await session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id == doc.id))
    drop_doc(settings.milvus_kb_collection, doc.id)
    try:
        from app.knowledge.kg_extract import clear_document_graph

        await clear_document_graph(session, doc.id)
    except Exception:
        pass
    if doc.file_path:
        try:
            Path(doc.file_path).unlink(missing_ok=True)
        except OSError:
            pass

    await write_audit(
        session,
        user_id=admin.id,
        action="knowledge.delete",
        target_type="document",
        target_id=doc.id,
        details={"title": doc.title},
    )
    await session.delete(doc)
    await session.commit()
    return Response(status_code=204)


@router.get("/documents/{document_id}/media")
async def get_document_media(
    document_id: str, user: CurrentUser, session: DbSession
) -> FileResponse:
    """返回知识库图片原文（需登录）；仅 media_type=image 的上传文档。"""
    doc = (
        await session.execute(select(Document).where(Document.id == document_id))
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    meta = doc.extra_metadata if isinstance(doc.extra_metadata, dict) else {}
    if meta.get("media_type") != "image":
        raise HTTPException(status_code=404, detail="Document has no media preview")
    path_str = meta.get("image_path") or doc.file_path
    if not path_str:
        raise HTTPException(status_code=404, detail="Media file missing")
    path = Path(path_str)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Media file missing")
    mime, _ = mimetypes.guess_type(str(path))
    return FileResponse(
        path,
        media_type=mime or "application/octet-stream",
        filename=path.name,
    )


class DocumentSourceOut(BaseModel):
    """Probe payload for MD → original PDF mapping (reserved, forward-compatible)."""

    available: bool
    document_id: str
    mime_type: str | None = None
    filename: str | None = None
    relative_path: str | None = None
    resolution: str | None = Field(
        default=None, description="How the PDF was resolved: metadata | sibling | self"
    )
    download_path: str | None = None


def _source_download_path(document_id: str) -> str:
    return f"/api/knowledge/documents/{document_id}/source/file"


def _wants_pdf_stream(request: Request) -> bool:
    """True when client asks for PDF bytes on the probe path via Accept."""
    accept = (request.headers.get("accept") or "").lower()
    if "application/json" in accept:
        return False
    return "application/pdf" in accept


async def _load_document(session: AsyncSession, document_id: str) -> Document:
    doc = (
        await session.execute(select(Document).where(Document.id == document_id))
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def _probe_source(doc: Document, document_id: str) -> DocumentSourceOut:
    ref = resolve_source_pdf(doc)
    if not ref:
        return DocumentSourceOut(available=False, document_id=document_id)
    return DocumentSourceOut(
        available=True,
        document_id=document_id,
        mime_type=ref.mime_type,
        filename=ref.filename,
        relative_path=ref.relative_path,
        resolution=ref.resolution,
        download_path=_source_download_path(document_id),
    )


async def _stream_document_source_pdf(
    session: AsyncSession, document_id: str
) -> FileResponse | JSONResponse:
    doc = await _load_document(session, document_id)
    ref = resolve_source_pdf(doc)
    if not ref:
        return JSONResponse(
            status_code=404,
            content={
                "available": False,
                "document_id": document_id,
                "detail": "Source PDF not available",
            },
        )
    return FileResponse(
        ref.path,
        media_type=ref.mime_type,
        filename=ref.filename,
    )


async def _get_document_source_or_stream(
    request: Request, document_id: str, session: AsyncSession
) -> DocumentSourceOut | FileResponse | JSONResponse:
    if _wants_pdf_stream(request):
        return await _stream_document_source_pdf(session, document_id)
    doc = await _load_document(session, document_id)
    return _probe_source(doc, document_id)


@router.get("/documents/{document_id}/source")
async def get_document_source(
    document_id: str, request: Request, user: CurrentUser, session: DbSession
) -> DocumentSourceOut | FileResponse | JSONResponse:
    """Probe MD→PDF pairing, or stream PDF when ``Accept: application/pdf``.

    Default (JSON): ``{ available, mime_type, relative_path?, filename? }``.
    When no PDF is paired, returns ``available: false`` with HTTP 200 so clients
    can probe without treating absence as a hard failure for MD RAG.
    """
    return await _get_document_source_or_stream(request, document_id, session)


@router.get("/documents/{document_id}/original")
async def get_document_original(
    document_id: str, request: Request, user: CurrentUser, session: DbSession
) -> DocumentSourceOut | FileResponse | JSONResponse:
    """Alias of ``/source`` — reserved alternate probe/stream path."""
    return await _get_document_source_or_stream(request, document_id, session)


@router.get("/documents/{document_id}/source/file")
async def get_document_source_file(
    document_id: str, user: CurrentUser, session: DbSession
) -> FileResponse | JSONResponse:
    """Stream the paired source PDF, or 404 JSON ``{ available: false }``."""
    return await _stream_document_source_pdf(session, document_id)


@router.get("/documents/{document_id}/original/file")
async def get_document_original_file(
    document_id: str, user: CurrentUser, session: DbSession
) -> FileResponse | JSONResponse:
    """Alias of ``/source/file``."""
    return await _stream_document_source_pdf(session, document_id)


@router.get("/documents/{document_id}/pdf")
async def get_document_pdf(
    document_id: str, user: CurrentUser, session: DbSession
) -> FileResponse | JSONResponse:
    """Alias of ``/source/file`` — reserved short path for PDF download."""
    return await _stream_document_source_pdf(session, document_id)


class GraphNode(BaseModel):
    id: str
    label: str
    type: str
    size: int = 1
    canonical_key: str | None = None
    metadata: dict[str, Any] | None = None
    seed: bool | None = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    relation: str
    document_id: str | None = None
    weight: float = 1.0
    evidence: str | None = None


class GraphPayload(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


@router.get("/graph", response_model=GraphPayload)
async def get_knowledge_graph(
    user: CurrentUser,
    session: DbSession,
    era: str | None = None,
    series: str | None = None,
    types: str | None = Query(default=None, description="comma-separated entity types"),
    q: str | None = None,
    limit_nodes: int = Query(default=200, ge=20, le=500),
) -> GraphPayload:
    type_list = [t.strip() for t in (types or "").split(",") if t.strip()] or None
    data = await query_graph(
        session,
        era=era,
        series=series,
        types=type_list,
        q=q,
        limit_nodes=limit_nodes,
    )
    return GraphPayload(**data)


@router.get("/graph/ego", response_model=GraphPayload)
async def get_ego_graph(
    user: CurrentUser,
    session: DbSession,
    names: str | None = Query(default=None, description="comma-separated entity names"),
    doc_ids: str | None = Query(default=None, description="comma-separated document ids"),
    depth: int = Query(default=1, ge=1, le=2),
    limit: int = Query(default=80, ge=10, le=200),
) -> GraphPayload:
    name_list = [n.strip() for n in (names or "").split(",") if n.strip()]
    doc_list = [d.strip() for d in (doc_ids or "").split(",") if d.strip()]
    data = await query_ego_graph(
        session,
        names=name_list,
        doc_ids=doc_list,
        depth=depth,
        limit=limit,
    )
    return GraphPayload(**data)
