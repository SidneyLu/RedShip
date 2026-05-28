from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import BaseCorpusChunk, Role, UploadDocument, UploadStatus, User
from app.db.schemas import Citation
from app.services.base_corpus import ensure_base_corpus_seeded
from app.services.qwen import ask_qwen
from app.services.uploads import get_upload_by_id


@dataclass
class SynthesisResult:
    answer: str
    visualization: dict[str, Any] | None
    model: str | None
    modalities_used: list[str]


def _upload_visibility_filter(user: User | None):
    if user is None:
        return UploadDocument.status == UploadStatus.approved

    if user.role == Role.admin:
        return True

    return or_(UploadDocument.status == UploadStatus.approved, UploadDocument.owner_id == user.id)


def search_local_documents(
    db: Session,
    question: str,
    user: User | None,
    session_id: str | None,
    retrieval_scope: str,
    limit: int = 5,
) -> list[Citation]:
    citations: list[Citation] = []

    if retrieval_scope in {'base', 'hybrid'}:
        settings = get_settings()
        ensure_base_corpus_seeded(db, zip_path=settings.downloads_zip_path)

        needle = question.strip().lower()
        base_query = db.query(BaseCorpusChunk)
        if needle:
            base_query = base_query.filter(BaseCorpusChunk.content.ilike(f'%{needle}%'))
        base_rows = base_query.order_by(BaseCorpusChunk.id.desc()).limit(limit).all()
        for row in base_rows:
            citations.append(
                Citation(
                    source_domain='base',
                    title=row.source_path,
                    location=f'chunk:{row.chunk_index}',
                )
            )

        query = db.query(UploadDocument).filter(
            UploadDocument.status == UploadStatus.approved,
            UploadDocument.is_deleted.is_(False),
        )
        approved_rows = query.order_by(UploadDocument.reviewed_at.desc()).limit(limit).all()
        for row in approved_rows:
            citations.append(
                Citation(
                    source_domain='base',
                    title=row.original_filename,
                    location=f'upload:{row.id}',
                )
            )

    if retrieval_scope in {'upload', 'hybrid'}:
        query = db.query(UploadDocument).filter(UploadDocument.is_deleted.is_(False))
        visibility = _upload_visibility_filter(user)
        if visibility is not True:
            query = query.filter(visibility)
        if session_id:
            query = query.filter(UploadDocument.session_id == session_id)

        needle = question.strip().lower()
        if needle:
            query = query.filter(
                or_(
                    UploadDocument.original_filename.ilike(f'%{needle}%'),
                    UploadDocument.extracted_text.ilike(f'%{needle}%'),
                )
            )

        upload_rows = query.order_by(UploadDocument.created_at.desc()).limit(limit).all()
        for row in upload_rows:
            citations.append(
                Citation(
                    source_domain='upload',
                    title=row.original_filename,
                    location=f'session:{row.session_id} status:{row.status.value}',
                )
            )

    return citations[:limit]


def build_mode_name(retrieval_enabled: bool, deep_research_enabled: bool) -> str:
    if retrieval_enabled and deep_research_enabled:
        return 'retrieval+deep_research'
    if retrieval_enabled:
        return 'retrieval'
    if deep_research_enabled:
        return 'deep_research'
    return 'chat'


def materialize_attachments(
    db: Session,
    user: User | None,
    attachments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    materialized: list[dict[str, Any]] = []
    for item in attachments:
        upload_id = str(item.get('upload_id') or '').strip()
        media_type = str(item.get('media_type') or '').strip()
        page = item.get('page')
        if not upload_id or media_type not in {'image', 'pdf_page'}:
            continue

        upload = get_upload_by_id(db, upload_id, include_deleted=False)
        if user is None and upload.status != UploadStatus.approved:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Attachment requires login')
        if user and user.role != Role.admin and upload.owner_id != user.id and upload.status != UploadStatus.approved:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='No permission for attachment')

        materialized.append(
            {
                'upload_id': upload_id,
                'media_type': media_type,
                'page': page,
                'storage_path': upload.storage_path,
                'mime_type': upload.mime_type,
            }
        )
    return materialized


def synthesize_answer(
    question: str,
    mode: str,
    citations: list[Citation],
    retrieval_scope: str,
    history: list[dict[str, str]] | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> SynthesisResult:
    qwen_result = ask_qwen(
        question,
        citations,
        deep_research=(mode in {'deep_research', 'retrieval+deep_research'}),
        history=history,
        attachments=attachments,
    )
    if qwen_result:
        return SynthesisResult(
            answer=qwen_result.answer,
            visualization=qwen_result.visualization,
            model=qwen_result.model,
            modalities_used=qwen_result.modalities_used,
        )

    if mode == 'chat':
        answer = f'已按普通聊天模式回答：{question}'
    elif mode == 'retrieval':
        answer = f'已基于本地检索返回答案。命中证据数：{len(citations)}。问题：{question}'
    elif mode == 'deep_research':
        answer = (
            '已进入深度研究模式（不启用本地检索）。'
            f'将围绕问题分解论点、收集外部证据并综合：{question}'
        )
    else:
        answer = (
            '已进入完整深度研究模式（本地检索+研究推理）。'
            f'已生成初步证据链，问题：{question}。当前证据数：{len(citations)}'
        )
    return SynthesisResult(
        answer=answer,
        visualization=None,
        model=None,
        modalities_used=['text'],
    )
