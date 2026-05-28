from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.schemas import DocumentChangeRequestCreate, DocumentChangeRequestOut, UploadSummaryOut
from app.db.session import get_db
from app.services.documents import list_my_change_requests, list_my_documents
from app.services.uploads import create_change_request


router = APIRouter(prefix='/documents', tags=['documents'])


def to_upload_summary(row) -> UploadSummaryOut:
    return UploadSummaryOut(
        id=row.id,
        owner_id=row.owner_id,
        owner_email=None,
        session_id=row.session_id,
        original_filename=row.original_filename,
        mime_type=row.mime_type,
        size_bytes=row.size_bytes,
        status=row.status,
        review_reason=row.review_reason,
        is_deleted=row.is_deleted,
        created_at=row.created_at,
        submitted_at=row.submitted_at,
        reviewed_at=row.reviewed_at,
        deleted_at=row.deleted_at,
    )


def to_change_out(row) -> DocumentChangeRequestOut:
    return DocumentChangeRequestOut(
        id=row.id,
        document_id=row.document_id,
        requester_id=row.requester_id,
        requester_email=None,
        proposed_filename=row.proposed_filename,
        proposed_extracted_text=row.proposed_extracted_text,
        reason=row.reason,
        status=row.status,
        reviewed_by=row.reviewed_by,
        review_note=row.review_note,
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
    )


@router.get('/me', response_model=list[UploadSummaryOut])
def get_my_docs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = list_my_documents(db, user=user)
    return [to_upload_summary(row) for row in rows]


@router.get('/me/change-requests', response_model=list[DocumentChangeRequestOut])
def get_my_doc_change_requests(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = list_my_change_requests(db, user=user)
    return [to_change_out(row) for row in rows]


@router.post('/{document_id}/change-requests', response_model=DocumentChangeRequestOut)
def post_document_change_request(
    document_id: str,
    payload: DocumentChangeRequestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = create_change_request(
        db,
        user=user,
        upload_id=document_id,
        proposed_filename=payload.proposed_filename,
        proposed_extracted_text=payload.proposed_extracted_text,
        reason=payload.reason,
    )
    return to_change_out(row)
