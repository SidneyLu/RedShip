from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.schemas import Message, SubmitUploadRequest, UploadOut
from app.db.session import get_db
from app.services.uploads import create_upload, delete_draft_upload, list_uploads_for_session, submit_upload_for_review


router = APIRouter(prefix='/uploads', tags=['uploads'])


def to_upload_out(row) -> UploadOut:
    return UploadOut(
        id=row.id,
        owner_id=row.owner_id,
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


@router.post('', response_model=UploadOut)
def upload_document(
    session_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = create_upload(db, user=user, session_id=session_id, file=file)
    return to_upload_out(row)


@router.get('/{session_id}', response_model=list[UploadOut])
def list_uploads(session_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = list_uploads_for_session(db, user=user, session_id=session_id)
    return [to_upload_out(row) for row in rows]


@router.post('/{upload_id}/submit', response_model=UploadOut)
def submit_upload(
    upload_id: str,
    payload: SubmitUploadRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = submit_upload_for_review(db, user=user, upload_id=upload_id, note=payload.note)
    return to_upload_out(row)


@router.delete('/{upload_id}', response_model=Message)
def delete_upload(upload_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    delete_draft_upload(db, user=user, upload_id=upload_id)
    return Message(message='Upload deleted')
