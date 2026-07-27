"""Integration: threads CRUD."""
from __future__ import annotations

import pytest

from tests.factories import make_user
from app.core.security import create_access_token

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_thread_crud(client, auth_header, db_session, user):
    create = await client.post(
        "/api/threads",
        headers=auth_header,
        json={"title": "我的对话", "mode": "chat"},
    )
    assert create.status_code == 200, create.text
    tid = create.json()["id"]

    listed = await client.get("/api/threads", headers=auth_header)
    assert listed.status_code == 200
    assert any(t["id"] == tid for t in listed.json())

    patched = await client.patch(
        f"/api/threads/{tid}",
        headers=auth_header,
        json={"pinned": True, "title": "置顶对话"},
    )
    assert patched.status_code == 200
    assert patched.json()["pinned"] is True

    deleted = await client.delete(f"/api/threads/{tid}", headers=auth_header)
    assert deleted.status_code in {200, 204}


@pytest.mark.asyncio
async def test_thread_other_user_forbidden(client, auth_header, db_session, user):
    other = await make_user(db_session, email="other@test.local")
    await db_session.commit()
    other_header = {
        "Authorization": f"Bearer {create_access_token(other.id, extra_claims={'email': other.email})}"
    }
    create = await client.post(
        "/api/threads",
        headers=auth_header,
        json={"title": "私有", "mode": "chat"},
    )
    tid = create.json()["id"]
    got = await client.get(f"/api/threads/{tid}", headers=other_header)
    assert got.status_code in {403, 404}
