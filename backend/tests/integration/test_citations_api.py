"""Integration: citations list/get."""
from __future__ import annotations

import pytest

from tests.factories import make_message, make_thread

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_list_and_get_citation(client, auth_header, db_session, user):
    thread = await make_thread(db_session, user)
    citations = [
        {
            "id": "c-1",
            "ordinal": 1,
            "title": "文献",
            "snippet": "摘要",
            "source_type": "kb",
            "score": 0.88,
            "doc_id": None,
        }
    ]
    msg = await make_message(db_session, thread, citations=citations)
    await db_session.commit()

    listed = await client.get(
        f"/api/threads/{thread.id}/messages/{msg.id}/citations",
        headers=auth_header,
    )
    assert listed.status_code == 200, listed.text
    assert len(listed.json()) >= 1

    one = await client.get(
        f"/api/threads/{thread.id}/messages/{msg.id}/citations/c-1",
        headers=auth_header,
    )
    assert one.status_code == 200
    assert one.json()["id"] == "c-1"
