from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import ResearchSession, User
from app.services.retrieval import (
    build_mode_name,
    materialize_attachments,
    search_local_documents,
    synthesize_answer,
)


def build_research_plan(question: str, retrieval_enabled: bool, deep_research_enabled: bool) -> dict:
    return {
        'goal': question,
        'mode': build_mode_name(retrieval_enabled, deep_research_enabled),
        'steps': [
            '澄清研究问题与时间边界',
            '提取基础文献关键证据',
            '交叉验证上传文档与外部资料',
            '形成结论、争议点与后续研究建议',
        ],
    }


def create_research_session(
    db: Session,
    user: User | None,
    question: str,
    session_id: str | None,
    retrieval_enabled: bool,
    deep_research_enabled: bool,
    retrieval_scope: str,
    history: list[dict[str, str]] | None = None,
    attachments: list[dict] | None = None,
) -> ResearchSession:
    citations = (
        search_local_documents(db, question=question, user=user, session_id=session_id, retrieval_scope=retrieval_scope)
        if retrieval_enabled
        else []
    )
    mode = build_mode_name(retrieval_enabled, deep_research_enabled)
    attachment_materials = materialize_attachments(db, user, attachments or [])

    synthesis = synthesize_answer(
        question,
        mode,
        citations,
        retrieval_scope=retrieval_scope,
        history=history,
        attachments=attachment_materials,
    )
    plan = build_research_plan(question, retrieval_enabled, deep_research_enabled)
    plan['citations'] = [c.model_dump() for c in citations]

    meta = {
        'model': synthesis.model,
        'modalities_used': synthesis.modalities_used,
        'history_turns_used': len(history or []),
        'retrieval_scope': retrieval_scope,
    }

    session = ResearchSession(
        user_id=user.id if user else None,
        question=question,
        retrieval_enabled=retrieval_enabled,
        deep_research_enabled=deep_research_enabled,
        retrieval_scope=retrieval_scope,
        plan=plan,
        result=synthesis.answer,
        visualization=synthesis.visualization,
        meta=meta,
        status='completed',
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_research_session(db: Session, user: User | None, research_id: str) -> ResearchSession | None:
    row = db.query(ResearchSession).filter(ResearchSession.id == research_id).first()
    if not row:
        return None

    if row.user_id is None:
        return row

    if not user:
        return None

    if user.role.value == 'admin' or row.user_id == user.id:
        return row

    return None
