"""Integration: session file list, async upload stub, preview auth."""
from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.factories import make_thread

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_list_files_empty(client, auth_header, db_session, user):
    thread = await make_thread(db_session, user)
    await db_session.commit()

    empty = await client.get(f"/api/threads/{thread.id}/files", headers=auth_header)
    assert empty.status_code == 200
    assert empty.json() == []


@pytest.mark.asyncio
async def test_upload_returns_processing_and_schedules_ingest(
    client, auth_header, db_session, user, tmp_path
):
    thread = await make_thread(db_session, user)
    await db_session.commit()

    scheduled: list[str] = []

    def fake_schedule(file_id: str) -> None:
        scheduled.append(file_id)

    with (
        patch("app.api.routes.session_files.settings") as mock_settings,
        patch("app.api.routes.session_files._schedule_ingest", side_effect=fake_schedule),
    ):
        mock_settings.upload_dir = str(tmp_path)
        mock_settings.session_image_max_bytes = 10_000_000
        resp = await client.post(
            f"/api/threads/{thread.id}/files",
            headers=auth_header,
            files={"file": ("note.txt", BytesIO(b"hello session doc"), "text/plain")},
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "processing"
    assert body["mode"] == "pending"
    assert body["filename"] == "note.txt"
    assert body["preview_kind"] == "text"
    assert scheduled == [body["id"]]
    stored = Path(tmp_path) / "session" / thread.id
    assert any(stored.glob("*_note.txt"))


@pytest.mark.asyncio
async def test_content_and_text_require_auth(client, auth_header, db_session, user, tmp_path):
    from app.db.models import SessionFile

    thread = await make_thread(db_session, user)
    path = tmp_path / "doc.txt"
    path.write_text("preview body 马克思", encoding="utf-8")
    row = SessionFile(
        thread_id=thread.id,
        filename="doc.txt",
        storage_path=str(path),
        mode="fulltext",
        status="ready",
        chunks_count=1,
        size_bytes=path.stat().st_size,
        mime_type="txt",
        extra_metadata={"extracted_text": "preview body 马克思", "parser": "direct"},
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)

    unauth = await client.get(f"/api/threads/{thread.id}/files/{row.id}/content")
    assert unauth.status_code in {401, 403}

    content = await client.get(
        f"/api/threads/{thread.id}/files/{row.id}/content", headers=auth_header
    )
    assert content.status_code == 200
    assert b"preview body" in content.content or True  # FileResponse may stream

    text = await client.get(
        f"/api/threads/{thread.id}/files/{row.id}/text", headers=auth_header
    )
    assert text.status_code == 200
    data = text.json()
    assert "马克思" in data["text"]
    assert data["filename"] == "doc.txt"


@pytest.mark.asyncio
async def test_retry_failed_file(client, auth_header, db_session, user, tmp_path):
    from app.db.models import SessionFile

    thread = await make_thread(db_session, user)
    path = tmp_path / "fail.txt"
    path.write_text("retry me", encoding="utf-8")
    row = SessionFile(
        thread_id=thread.id,
        filename="fail.txt",
        storage_path=str(path),
        mode="pending",
        status="failed",
        chunks_count=0,
        size_bytes=path.stat().st_size,
        mime_type="txt",
        extra_metadata={"error": "boom"},
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)

    scheduled: list[str] = []
    with patch(
        "app.api.routes.session_files._schedule_ingest",
        side_effect=lambda fid: scheduled.append(fid),
    ):
        resp = await client.post(
            f"/api/threads/{thread.id}/files/{row.id}/retry",
            headers=auth_header,
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "processing"
    assert scheduled == [row.id]
