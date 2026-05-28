from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_optional
from app.db.models import User
from app.db.schemas import ResearchCreateRequest, ResearchSessionOut
from app.db.session import get_db
from app.services.research import create_research_session, get_research_session


router = APIRouter(prefix='/research/sessions', tags=['research'])


@router.post('', response_model=ResearchSessionOut)
def create_session(
    payload: ResearchCreateRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    if payload.retrieval_enabled and payload.retrieval_scope in {'upload', 'hybrid'} and user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Login required for upload retrieval scope',
        )

    history = [
        {'role': item.role, 'content': item.content}
        for item in payload.history
        if item.role in {'user', 'assistant'} and item.content.strip()
    ]

    session = create_research_session(
        db,
        user=user,
        question=payload.question,
        session_id=payload.session_id,
        retrieval_enabled=payload.retrieval_enabled,
        deep_research_enabled=payload.deep_research_enabled,
        retrieval_scope=payload.retrieval_scope,
        history=history,
        attachments=[item.model_dump() for item in payload.attachments],
    )
    return ResearchSessionOut(
        id=session.id,
        question=session.question,
        retrieval_enabled=session.retrieval_enabled,
        deep_research_enabled=session.deep_research_enabled,
        retrieval_scope=session.retrieval_scope,
        status=session.status,
        plan=session.plan,
        result=session.result,
        visualization=session.visualization,
        meta=session.meta
        or {
            'model': None,
            'modalities_used': ['text'],
            'history_turns_used': len(history),
            'retrieval_scope': payload.retrieval_scope,
        },
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.get('/{research_id}', response_model=ResearchSessionOut)
def get_session(
    research_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    row = get_research_session(db, user=user, research_id=research_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Research session not found')

    return ResearchSessionOut(
        id=row.id,
        question=row.question,
        retrieval_enabled=row.retrieval_enabled,
        deep_research_enabled=row.deep_research_enabled,
        retrieval_scope=row.retrieval_scope,
        status=row.status,
        plan=row.plan,
        result=row.result,
        visualization=row.visualization,
        meta=row.meta
        or {
            'model': None,
            'modalities_used': ['text'],
            'history_turns_used': 0,
            'retrieval_scope': row.retrieval_scope,
        },
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
