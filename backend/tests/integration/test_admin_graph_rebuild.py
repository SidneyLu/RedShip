"""Integration: admin graph rebuild."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_rebuild_requires_admin(client, auth_header):
    resp = await client.post("/api/admin/knowledge/graph/rebuild", headers=auth_header)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_rebuild_as_admin(client, admin_header):
    with patch(
        "app.api.routes.admin.rebuild_knowledge_graph",
        new=AsyncMock(return_value={"documents": 2, "ok": 2, "failed": 0}),
    ):
        resp = await client.post(
            "/api/admin/knowledge/graph/rebuild",
            headers=admin_header,
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] == 2
