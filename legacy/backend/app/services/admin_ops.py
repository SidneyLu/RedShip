from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db.models import DocumentChangeRequest, Role, UploadDocument, UploadStatus, User
from app.services.audit import log_action
from app.services.uploads import get_upload_by_id
from app.services.vector_index import safe_index_upload_text, safe_promote_upload_to_base


def list_users(db: Session) -> list[User]:
    return db.query(User).order_by(User.created_at.desc()).all()


def _get_user_or_404(db: Session, user_id: str) -> User:
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')
    return target


def update_user_role(db: Session, actor: User, user_id: str, role: str) -> User:
    target = _get_user_or_404(db, user_id)
    if target.is_super_admin and role != 'admin':
        if not actor.is_super_admin or actor.id != target.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail='Super admin role downgrade must be performed by self',
            )

    target.role = Role(role)
    if role != 'admin':
        target.is_super_admin = False
    db.commit()
    db.refresh(target)
    log_action(
        db,
        action='admin.user.update_role',
        target_type='user',
        target_id=target.id,
        actor=actor,
        details={'role': role},
    )
    return target


def update_user_status(db: Session, actor: User, user_id: str, is_active: bool) -> User:
    target = _get_user_or_404(db, user_id)
    if target.is_super_admin and not is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Super admin cannot be disabled',
        )

    target.is_active = is_active
    db.commit()
    db.refresh(target)
    log_action(
        db,
        action='admin.user.update_status',
        target_type='user',
        target_id=target.id,
        actor=actor,
        details={'is_active': is_active},
    )
    return target


def list_documents(
    db: Session,
    status_filter: str | None = None,
    owner_id: str | None = None,
    include_deleted: bool = False,
) -> list[UploadDocument]:
    query = db.query(UploadDocument)
    if not include_deleted:
        query = query.filter(UploadDocument.is_deleted.is_(False))
    if status_filter:
        try:
            mapped = UploadStatus(status_filter)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid status filter') from exc
        query = query.filter(UploadDocument.status == mapped)
    if owner_id:
        query = query.filter(UploadDocument.owner_id == owner_id)
    return query.order_by(UploadDocument.created_at.desc()).all()


def get_document_detail(db: Session, document_id: str) -> UploadDocument:
    return get_upload_by_id(db, document_id, include_deleted=True)


def list_change_requests(db: Session, status_filter: str | None = None) -> list[DocumentChangeRequest]:
    query = db.query(DocumentChangeRequest)
    if status_filter:
        query = query.filter(DocumentChangeRequest.status == status_filter)
    return query.order_by(DocumentChangeRequest.created_at.desc()).all()


def _get_change_request_or_404(db: Session, change_id: int) -> DocumentChangeRequest:
    request = db.query(DocumentChangeRequest).filter(DocumentChangeRequest.id == change_id).first()
    if not request:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Document change request not found')
    return request


def approve_change_request(db: Session, actor: User, change_id: int, review_note: str | None) -> DocumentChangeRequest:
    request = _get_change_request_or_404(db, change_id)
    if request.status != 'pending':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Change request is not pending')

    document = get_upload_by_id(db, request.document_id, include_deleted=False)
    if request.proposed_filename:
        document.original_filename = request.proposed_filename
    if request.proposed_extracted_text:
        document.extracted_text = request.proposed_extracted_text

    request.status = 'approved'
    request.reviewed_by = actor.id
    request.review_note = review_note
    request.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(request)

    safe_index_upload_text(
        session_id=document.session_id,
        upload_id=document.id,
        text=document.extracted_text or document.original_filename,
        payload={'owner_id': document.owner_id, 'status': document.status.value, 'source_domain': 'upload'},
    )
    if document.status == UploadStatus.approved:
        safe_promote_upload_to_base(
            upload_id=document.id,
            text=document.extracted_text or document.original_filename,
            payload={
                'source_domain': 'base',
                'owner_id': document.owner_id,
                'filename': document.original_filename,
                'approved_by': actor.id,
            },
        )

    log_action(
        db,
        action='admin.document_change.approve',
        target_type='document_change_request',
        target_id=str(request.id),
        actor=actor,
    )
    return request


def reject_change_request(db: Session, actor: User, change_id: int, review_note: str | None) -> DocumentChangeRequest:
    request = _get_change_request_or_404(db, change_id)
    if request.status != 'pending':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Change request is not pending')

    request.status = 'rejected'
    request.reviewed_by = actor.id
    request.review_note = review_note
    request.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(request)
    log_action(
        db,
        action='admin.document_change.reject',
        target_type='document_change_request',
        target_id=str(request.id),
        actor=actor,
    )
    return request
