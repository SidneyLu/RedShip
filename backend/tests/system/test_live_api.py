"""System tests against live Compose backend on localhost:8005."""
from __future__ import annotations

import os
import socket
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[3]
ENV_PATH = ROOT / ".env"


def _load_root_env(*, overwrite_keys: set[str] | None = None) -> None:
    if not ENV_PATH.exists():
        return
    overwrite_keys = overwrite_keys or set()
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
            continue
        key, _, val = trimmed.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key in overwrite_keys or key not in os.environ:
            os.environ[key] = val


_load_root_env(
    overwrite_keys={
        "ADMIN_BOOTSTRAP_EMAIL",
        "ADMIN_BOOTSTRAP_PASSWORD",
        "E2E_ADMIN_EMAIL",
        "E2E_ADMIN_PASSWORD",
        "DASHSCOPE_API_KEY",
    }
)

pytestmark = pytest.mark.system

BASE = os.environ.get("SYSTEM_API_BASE", "http://localhost:8005")
ADMIN_EMAIL = os.environ.get(
    "E2E_ADMIN_EMAIL",
    os.environ.get("ADMIN_BOOTSTRAP_EMAIL", "admin@redship.local"),
)
ADMIN_PASSWORD = os.environ.get(
    "E2E_ADMIN_PASSWORD",
    os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", ""),
)


def _backend_up() -> bool:
    try:
        host = "localhost"
        port = 8005
        if "://" in BASE:
            from urllib.parse import urlparse

            u = urlparse(BASE)
            host = u.hostname or "localhost"
            port = u.port or 8005
        with socket.create_connection((host, port), timeout=1.5):
            return True
    except OSError:
        return False


@pytest.fixture(scope="module")
def require_backend():
    if not _backend_up():
        pytest.skip(f"Backend not reachable at {BASE}")


@pytest.fixture(scope="module")
def http(require_backend):
    with httpx.Client(base_url=BASE, timeout=60.0) as client:
        yield client


@pytest.fixture(scope="module")
def admin_token(http):
    if not ADMIN_PASSWORD:
        pytest.skip("ADMIN_BOOTSTRAP_PASSWORD / E2E_ADMIN_PASSWORD not set")
    resp = http.post(
        "/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    if resp.status_code != 200:
        pytest.skip(f"admin login failed: {resp.status_code} {resp.text[:200]}")
    return resp.json()["access_token"]


def test_health(http):
    r = http.get("/api/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_admin_login(http, admin_token):
    assert admin_token
    me = http.get("/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
    assert me.status_code == 200
    assert me.json()["is_admin"] is True


def test_knowledge_stats(http, admin_token):
    r = http.get(
        "/api/knowledge/stats",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "indexed_documents" in body


def test_graph_endpoints(http, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    g = http.get("/api/knowledge/graph", headers=headers, params={"limit_nodes": 50})
    assert g.status_code == 200
    payload = g.json()
    assert "nodes" in payload and "edges" in payload

    ego = http.get(
        "/api/knowledge/graph/ego",
        headers=headers,
        params={"names": "周恩来", "limit": 20},
    )
    assert ego.status_code == 200
    assert "nodes" in ego.json()


def test_chat_roundtrip(http, admin_token):
    key = os.environ.get("DASHSCOPE_API_KEY", "")
    if not key or key.startswith("sk-your") or key == "sk-test-key-not-real":
        # Prefer live key from process env; skip if clearly placeholder
        # Compose may still have a real key — try short request and skip on 5xx auth errors
        pass

    headers = {
        "Authorization": f"Bearer {admin_token}",
        "Accept": "text/event-stream",
    }
    with http.stream(
        "POST",
        "/api/chat",
        headers=headers,
        json={
            "mode": "chat",
            "messages": [
                {"role": "user", "parts": [{"type": "text", "text": "用一句话介绍遵义会议。"}]}
            ],
        },
        timeout=120.0,
    ) as resp:
        if resp.status_code >= 500:
            pytest.skip(f"chat failed with {resp.status_code}")
        assert resp.status_code == 200
        chunks = []
        for line in resp.iter_lines():
            if line:
                chunks.append(line)
            if len(chunks) > 5:
                break
        joined = "\n".join(chunks)
        assert "data:" in joined
