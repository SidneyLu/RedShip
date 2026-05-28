from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_optional
from app.db.models import User
from app.db.schemas import ChatRequest, ChatResponse
from app.db.session import get_db
from app.services.retrieval import (
    build_mode_name,
    materialize_attachments,
    search_local_documents,
    synthesize_answer,
)


router = APIRouter(prefix='/chat', tags=['chat'])


@router.post('', response_model=ChatResponse)
def chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    if payload.retrieval_enabled and payload.retrieval_scope in {'upload', 'hybrid'} and user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Login required for upload retrieval scope',
        )

    mode = build_mode_name(payload.retrieval_enabled, payload.deep_research_enabled)
    citations = []

    if payload.retrieval_enabled:
        citations = search_local_documents(
            db,
            question=payload.message,
            user=user,
            session_id=payload.session_id,
            retrieval_scope=payload.retrieval_scope,
        )

    history = [
        {'role': item.role, 'content': item.content}
        for item in payload.history
        if item.role in {'user', 'assistant'} and item.content.strip()
    ]

    attachments = materialize_attachments(
        db,
        user=user,
        attachments=[item.model_dump() for item in payload.attachments],
    )
    synthesis = synthesize_answer(
        payload.message,
        mode,
        citations,
        retrieval_scope=payload.retrieval_scope,
        history=history,
        attachments=attachments,
    )
    return ChatResponse(
        mode=mode,
        answer=synthesis.answer,
        citations=citations,
        visualization=synthesis.visualization,
        meta={
            'model': synthesis.model,
            'modalities_used': synthesis.modalities_used,
            'history_turns_used': len(history),
            'retrieval_scope': payload.retrieval_scope,
        },
    )
