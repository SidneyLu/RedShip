"""Integration: auth API."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_register_login_me(client):
    reg = await client.post(
        "/api/auth/register",
        json={"email": "newbie@test.local", "password": "pass1234", "display_name": "新用户"},
    )
    assert reg.status_code == 200, reg.text
    data = reg.json()
    assert data["access_token"]
    assert data["user"]["email"] == "newbie@test.local"

    bad = await client.post(
        "/api/auth/login",
        json={"email": "newbie@test.local", "password": "wrong"},
    )
    assert bad.status_code == 401

    login = await client.post(
        "/api/auth/login",
        json={"email": "newbie@test.local", "password": "pass1234"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "newbie@test.local"


@pytest.mark.asyncio
async def test_me_requires_auth(client):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401
