from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import DocumentChangeRequest, UploadDocument, User


def list_my_documents(db: Session, user: User) -> list[UploadDocument]:
    return (
        db.query(UploadDocument)
        .filter(
            UploadDocument.owner_id == user.id,
            UploadDocument.is_deleted.is_(False),
        )
        .order_by(UploadDocument.created_at.desc())
        .all()
    )


def list_my_change_requests(db: Session, user: User) -> list[DocumentChangeRequest]:
    return (
        db.query(DocumentChangeRequest)
        .filter(DocumentChangeRequest.requester_id == user.id)
        .order_by(DocumentChangeRequest.created_at.desc())
        .all()
    )
