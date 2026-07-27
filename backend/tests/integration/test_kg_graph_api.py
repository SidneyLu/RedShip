"""Integration: knowledge list/stats and graph queries."""
from __future__ import annotations

import pytest

from app.knowledge.kg_extract import canonical_key
from tests.factories import make_document, make_kg_edge, make_kg_entity

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_knowledge_stats_and_documents(client, auth_header, db_session, user):
    await make_document(db_session, title="文献甲", era="抗日战争")
    await db_session.commit()

    stats = await client.get("/api/knowledge/stats", headers=auth_header)
    assert stats.status_code == 200
    body = stats.json()
    assert body["indexed_documents"] >= 1

    docs = await client.get(
        "/api/knowledge/documents",
        headers=auth_header,
        params={"era": "抗日战争"},
    )
    assert docs.status_code == 200
    assert any(d["title"] == "文献甲" for d in docs.json())


@pytest.mark.asyncio
async def test_graph_and_ego(client, auth_header, db_session, user):
    doc = await make_document(db_session, title="图谱文献", era="土地革命战争")
    doc_ent = await make_kg_entity(
        db_session,
        name=doc.title,
        entity_type="document",
        canonical=canonical_key("document", doc.id),
        extra={"document_id": doc.id},
    )
    era = await make_kg_entity(db_session, name="土地革命战争", entity_type="era")
    person = await make_kg_entity(db_session, name="周恩来", entity_type="person")
    await make_kg_edge(db_session, doc_ent, era, relation="in_era", document_id=doc.id)
    await make_kg_edge(
        db_session, person, doc_ent, relation="mentions", document_id=doc.id, evidence="文中提及"
    )
    await db_session.commit()

    graph = await client.get("/api/knowledge/graph", headers=auth_header)
    assert graph.status_code == 200
    payload = graph.json()
    assert "nodes" in payload and "edges" in payload
    assert len(payload["nodes"]) >= 1

    ego = await client.get(
        "/api/knowledge/graph/ego",
        headers=auth_header,
        params={"names": "周恩来"},
    )
    assert ego.status_code == 200
    ego_body = ego.json()
    assert any(n["label"] == "周恩来" for n in ego_body["nodes"])
