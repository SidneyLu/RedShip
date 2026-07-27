"""Integration: knowledge upload/delete with mocked ingest."""
from __future__ import annotations

from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest

from tests.factories import make_document

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_upload_and_delete_document(client, admin_header, db_session, admin_user):
    fake_doc = await make_document(db_session, title="上传占位", source="upload")
    await db_session.commit()
    doc_id = fake_doc.id

    async def fake_ingest(session, path, **kwargs):
        # Re-load in the request session to avoid detached instance errors
        from sqlalchemy import select
        from app.db.models import Document

        return (
            await session.execute(select(Document).where(Document.id == doc_id))
        ).scalar_one()

    with patch(
        "app.api.routes.knowledge.ingest_upload_file",
        new=AsyncMock(side_effect=fake_ingest),
    ):
        resp = await client.post(
            "/api/knowledge/documents/upload",
            headers=admin_header,
            files={"file": ("note.md", BytesIO(b"# hello\n"), "text/markdown")},
        )
    assert resp.status_code == 200, resp.text

    with (
        patch("app.api.routes.knowledge.drop_doc", return_value=None),
        patch(
            "app.knowledge.kg_extract.clear_document_graph",
            new=AsyncMock(return_value=None),
        ),
    ):
        deleted = await client.delete(
            f"/api/knowledge/documents/{doc_id}",
            headers=admin_header,
        )
    assert deleted.status_code in {200, 204}
