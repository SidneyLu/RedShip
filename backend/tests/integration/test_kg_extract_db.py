"""Integration: kg structure build / clear without LLM."""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.db.models import KgEdge, KgEntity
from app.knowledge.ingestion.chunker import ParentChunk
from app.knowledge.kg_extract import build_document_graph, clear_document_graph
from tests.factories import make_document

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_build_and_clear_document_graph(db_session, clean_db, engine):
    doc = await make_document(db_session, title="结构测试", era="抗日战争", series="测试丛书")
    await db_session.commit()

    parents = [
        ParentChunk(text="第一节正文。" * 5, parent_index=0, heading_path="第一章 > 第一节"),
        ParentChunk(text="第二节正文。" * 5, parent_index=1, heading_path="第一章 > 第二节"),
    ]
    stats = await build_document_graph(
        db_session, doc, parents, extract_entities=False
    )
    await db_session.commit()
    assert stats["structure_edges"] >= 2

    edge_count = (
        await db_session.execute(
            select(func.count()).select_from(KgEdge).where(KgEdge.document_id == doc.id)
        )
    ).scalar_one()
    assert edge_count >= 2

    await clear_document_graph(db_session, doc.id)
    await db_session.commit()
    edge_count2 = (
        await db_session.execute(
            select(func.count()).select_from(KgEdge).where(KgEdge.document_id == doc.id)
        )
    ).scalar_one()
    assert edge_count2 == 0
