from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import get_settings
from app.db.models import BaseCorpusChunk, DocumentChangeRequest, UploadDocument, User
from app.db.schemas import (
    DocumentChangeRequestOut,
    DocumentChangeReviewRequest,
    Message,
    ReviewDecisionRequest,
    ReviewSubmissionOut,
    UploadDetailOut,
    UploadOut,
    UploadSummaryOut,
    UserOut,
    UserRoleUpdateRequest,
    UserStatusUpdateRequest,
)
from app.db.session import get_db
from app.services.admin_ops import (
    approve_change_request,
    get_document_detail,
    list_change_requests,
    list_documents,
    list_users,
    reject_change_request,
    update_user_role,
    update_user_status,
)
from app.services.auth import to_user_out
from app.services.base_corpus import ingest_downloads_zip
from app.services.uploads import (
    approve_submission,
    get_submission,
    list_pending_submissions,
    reject_submission,
    soft_delete_upload,
)


router = APIRouter(prefix='/admin', tags=['admin'])


def to_upload_summary(row: UploadDocument, owner_email: str | None = None) -> UploadSummaryOut:
    return UploadSummaryOut(
        id=row.id,
        owner_id=row.owner_id,
        owner_email=owner_email,
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


def to_upload_detail(row: UploadDocument, owner_email: str | None = None) -> UploadDetailOut:
    return UploadDetailOut(
        **to_upload_summary(row, owner_email=owner_email).model_dump(),
        extracted_text=row.extracted_text,
        deleted_by=row.deleted_by,
    )


def to_change_out(row: DocumentChangeRequest, requester_email: str | None) -> DocumentChangeRequestOut:
    return DocumentChangeRequestOut(
        id=row.id,
        document_id=row.document_id,
        requester_id=row.requester_id,
        requester_email=requester_email,
        proposed_filename=row.proposed_filename,
        proposed_extracted_text=row.proposed_extracted_text,
        reason=row.reason,
        status=row.status,
        reviewed_by=row.reviewed_by,
        review_note=row.review_note,
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
    )


@router.get('/users', response_model=list[UserOut])
def get_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return [to_user_out(user) for user in list_users(db)]


@router.patch('/users/{user_id}/role', response_model=UserOut)
def patch_user_role(
    user_id: str,
    payload: UserRoleUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    target = update_user_role(db, actor=admin, user_id=user_id, role=payload.role)
    return to_user_out(target)


@router.patch('/users/{user_id}/status', response_model=UserOut)
def patch_user_status(
    user_id: str,
    payload: UserStatusUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    target = update_user_status(db, actor=admin, user_id=user_id, is_active=payload.is_active)
    return to_user_out(target)


@router.get('/documents', response_model=list[UploadSummaryOut])
def get_documents(
    status: str | None = None,
    owner_id: str | None = None,
    include_deleted: bool = False,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    rows = list_documents(
        db,
        status_filter=status,
        owner_id=owner_id,
        include_deleted=include_deleted,
    )
    owner_ids = list({row.owner_id for row in rows})
    owner_map = {u.id: u.email for u in db.query(User).filter(User.id.in_(owner_ids)).all()} if owner_ids else {}
    return [to_upload_summary(row, owner_email=owner_map.get(row.owner_id)) for row in rows]


@router.get('/documents/{document_id}', response_model=UploadDetailOut)
def get_document(
    document_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = get_document_detail(db, document_id=document_id)
    owner = db.query(User).filter(User.id == row.owner_id).first()
    return to_upload_detail(row, owner_email=owner.email if owner else None)


@router.delete('/documents/{document_id}', response_model=Message)
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    soft_delete_upload(db, admin=admin, upload_id=document_id)
    return Message(message='Document soft deleted')


@router.get('/document-change-requests', response_model=list[DocumentChangeRequestOut])
def get_document_change_requests(
    status: str | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    rows = list_change_requests(db, status_filter=status)
    requester_ids = list({row.requester_id for row in rows if row.requester_id})
    requester_map = {u.id: u.email for u in db.query(User).filter(User.id.in_(requester_ids)).all()} if requester_ids else {}
    return [to_change_out(row, requester_email=requester_map.get(row.requester_id)) for row in rows]


@router.post('/document-change-requests/{change_id}/approve', response_model=DocumentChangeRequestOut)
def approve_document_change(
    change_id: int,
    payload: DocumentChangeReviewRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = approve_change_request(db, actor=admin, change_id=change_id, review_note=payload.review_note)
    requester = db.query(User).filter(User.id == row.requester_id).first() if row.requester_id else None
    return to_change_out(row, requester_email=requester.email if requester else None)


@router.post('/document-change-requests/{change_id}/reject', response_model=DocumentChangeRequestOut)
def reject_document_change(
    change_id: int,
    payload: DocumentChangeReviewRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = reject_change_request(db, actor=admin, change_id=change_id, review_note=payload.review_note)
    requester = db.query(User).filter(User.id == row.requester_id).first() if row.requester_id else None
    return to_change_out(row, requester_email=requester.email if requester else None)


# Backward compatible endpoints under /api/admin/review/*
def to_submission_out(row: UploadDocument, owner_email: str) -> ReviewSubmissionOut:
    return ReviewSubmissionOut(
        id=row.id,
        owner_email=owner_email,
        session_id=row.session_id,
        original_filename=row.original_filename,
        status=row.status,
        submitted_at=row.submitted_at,
        created_at=row.created_at,
        review_reason=row.review_reason,
    )


@router.get('/review/submissions', response_model=list[ReviewSubmissionOut])
def get_submissions(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    rows = list_pending_submissions(db)
    owner_map = {u.id: u.email for u in db.query(User).filter(User.id.in_([r.owner_id for r in rows])).all()} if rows else {}
    return [to_submission_out(r, owner_map.get(r.owner_id, 'unknown@example.com')) for r in rows]


@router.get('/review/submissions/{submission_id}', response_model=ReviewSubmissionOut)
def get_submission_detail(
    submission_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = get_submission(db, admin=admin, upload_id=submission_id)
    owner = db.query(User).filter(User.id == row.owner_id).first()
    return to_submission_out(row, owner.email if owner else 'unknown@example.com')


def to_upload_out(row: UploadDocument) -> UploadOut:
    return UploadOut(
        id=row.id,
        owner_id=row.owner_id,
        session_id=row.session_id,
        original_filename=row.original_filename,
        mime_type=row.mime_type,
        size_bytes=row.size_bytes,
        status=row.status,
        review_reason=row.review_reason,
        created_at=row.created_at,
        submitted_at=row.submitted_at,
        reviewed_at=row.reviewed_at,
        is_deleted=row.is_deleted,
        deleted_at=row.deleted_at,
    )


@router.post('/review/submissions/{submission_id}/approve', response_model=UploadOut)
def approve(
    submission_id: str,
    payload: ReviewDecisionRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = approve_submission(db, admin=admin, upload_id=submission_id, reason=payload.reason)
    return to_upload_out(row)


@router.post('/review/submissions/{submission_id}/reject', response_model=UploadOut)
def reject(
    submission_id: str,
    payload: ReviewDecisionRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = reject_submission(db, admin=admin, upload_id=submission_id, reason=payload.reason)
    return to_upload_out(row)


@router.post('/review/base-corpus/reindex', response_model=Message)
def reindex_base_corpus(
    max_files: int | None = None,
    max_chunks: int | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    settings = get_settings()
    stats = ingest_downloads_zip(db, zip_path=settings.downloads_zip_path, max_files=max_files, max_chunks=max_chunks)
    count = db.query(BaseCorpusChunk).count()
    return Message(message=f"Base corpus rebuilt: {stats}. total_chunks={count}")
