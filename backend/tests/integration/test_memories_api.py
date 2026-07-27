"""Integration: user memories API."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from tests.factories import make_memory

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_list_and_delete_memory(client, auth_header, db_session, user):
    mem = await make_memory(db_session, user, content="关注遵义会议")
    await db_session.commit()
    mem_id = mem.id

    listed = await client.get("/api/me/memories", headers=auth_header)
    assert listed.status_code == 200
    assert any(m["id"] == mem_id for m in listed.json())

    with (
        patch("app.memory.user_memory.drop_doc", return_value=None),
        patch("app.knowledge.indexer.get_milvus", return_value=MagicMock()),
    ):
        deleted = await client.delete(f"/api/me/memories/{mem_id}", headers=auth_header)
    assert deleted.status_code == 204
