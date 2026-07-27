"""Pytest fixtures: env bootstrap, Postgres test DB, ASGI client, mocks."""
from __future__ import annotations

import os
import socket
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

# Stub optional heavy native deps so unit collection works without full pip install.
for _mod in ("pymilvus", "dashscope"):
    sys.modules.setdefault(_mod, MagicMock())

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# --- env before app imports ---
_TEST_DB = os.environ.get("TEST_POSTGRES_DB", "redship_test")
_PG_USER = os.environ.get("POSTGRES_USER", "redship")
_PG_PASS = os.environ.get("POSTGRES_PASSWORD", "redship")
_IN_DOCKER = Path("/.dockerenv").exists()
if os.environ.get("TEST_POSTGRES_HOST"):
    _PG_HOST = os.environ["TEST_POSTGRES_HOST"]
elif _IN_DOCKER:
    _PG_HOST = os.environ.get("POSTGRES_HOST", "postgres")
else:
    # Host machine talking to published compose port
    _raw_host = os.environ.get("POSTGRES_HOST", "localhost")
    _PG_HOST = "localhost" if _raw_host == "postgres" else _raw_host
_PG_PORT = os.environ.get("TEST_POSTGRES_PORT", os.environ.get("POSTGRES_PORT", "5432"))

os.environ["ALLOW_INSECURE_DEFAULTS"] = "true"
os.environ["BIBLIOGRAPHY_AUTO_SYNC"] = "false"
os.environ["POSTGRES_HOST"] = _PG_HOST
os.environ["POSTGRES_PORT"] = str(_PG_PORT)
os.environ["POSTGRES_USER"] = _PG_USER
os.environ["POSTGRES_PASSWORD"] = _PG_PASS
os.environ["POSTGRES_DB"] = _TEST_DB
os.environ["DATABASE_URL"] = (
    f"postgresql+asyncpg://{_PG_USER}:{_PG_PASS}@{_PG_HOST}:{_PG_PORT}/{_TEST_DB}"
)
os.environ["DATABASE_URL_SYNC"] = (
    f"postgresql+psycopg://{_PG_USER}:{_PG_PASS}@{_PG_HOST}:{_PG_PORT}/{_TEST_DB}"
)
os.environ.setdefault("REDIS_HOST", "localhost")
os.environ.setdefault("MILVUS_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-key-at-least-32-chars-long")
os.environ.setdefault("DASHSCOPE_API_KEY", "sk-test-key-not-real")
os.environ.setdefault("ADMIN_BOOTSTRAP_EMAIL", "admin@test.local")
os.environ.setdefault("ADMIN_BOOTSTRAP_PASSWORD", "TestAdminPass!2026")

from app.core.config import get_settings  # noqa: E402
import app.core.config as config_mod  # noqa: E402

get_settings.cache_clear()
config_mod.settings = get_settings()

from app.core.security import create_access_token  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.models import User  # noqa: E402
import app.db.session as session_mod  # noqa: E402
from tests.factories import make_user  # noqa: E402


def _postgres_reachable() -> bool:
    try:
        with socket.create_connection((_PG_HOST, int(_PG_PORT)), timeout=1.5):
            return True
    except OSError:
        return False


def _ensure_test_database() -> None:
    """Create redship_test if missing (connect to maintenance DB)."""
    import psycopg

    admin_url = f"postgresql://{_PG_USER}:{_PG_PASS}@{_PG_HOST}:{_PG_PORT}/postgres"
    with psycopg.connect(admin_url, autocommit=True) as conn:
        row = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (_TEST_DB,)
        ).fetchone()
        if not row:
            conn.execute(f'CREATE DATABASE "{_TEST_DB}"')


@pytest.fixture(scope="session")
def postgres_available() -> bool:
    return _postgres_reachable()


@pytest_asyncio.fixture
async def engine(postgres_available: bool):
    if not postgres_available:
        pytest.skip("Postgres not reachable on {}:{}".format(_PG_HOST, _PG_PORT))
    _ensure_test_database()
    # reset module singletons (per-test engine avoids asyncio loop mismatch)
    session_mod._engine = None
    session_mod._session_factory = None
    eng = create_async_engine(
        config_mod.settings.async_database_url,
        pool_pre_ping=True,
        poolclass=NullPool,
    )
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_mod._engine = eng
    session_mod._session_factory = async_sessionmaker(
        bind=eng, expire_on_commit=False, class_=AsyncSession
    )
    yield eng
    await eng.dispose()
    session_mod._engine = None
    session_mod._session_factory = None


@pytest_asyncio.fixture
async def db_session(engine) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def clean_db(engine) -> AsyncIterator[None]:
    """Truncate all tables before each integration test."""
    async with engine.begin() as conn:
        tables = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
        if tables:
            await conn.execute(text(f"TRUNCATE {tables} CASCADE"))
    yield


@pytest_asyncio.fixture
async def user(db_session: AsyncSession, clean_db) -> User:
    u = await make_user(db_session, email="user@test.local", password="userpass123")
    await db_session.commit()
    return u


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession, clean_db) -> User:
    u = await make_user(
        db_session, email="admin@test.local", password="adminpass123", is_admin=True
    )
    await db_session.commit()
    return u


@pytest.fixture
def auth_header(user: User) -> dict[str, str]:
    token = create_access_token(user.id, extra_claims={"email": user.email, "is_admin": False})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_header(admin_user: User) -> dict[str, str]:
    token = create_access_token(
        admin_user.id, extra_claims={"email": admin_user.email, "is_admin": True}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def mock_externals() -> Iterator[dict[str, Any]]:
    """Patch Milvus / Redis / DashScope for ASGI tests."""
    redis_mock = AsyncMock()
    redis_mock.get = AsyncMock(return_value=None)
    redis_mock.set = AsyncMock(return_value=True)
    redis_mock.delete = AsyncMock(return_value=1)
    redis_mock.aclose = AsyncMock()

    dash = MagicMock()
    dash.embed = AsyncMock(return_value=[[0.0] * 8])
    dash.rerank = AsyncMock(return_value=[])
    dash.chat = AsyncMock(
        return_value={"choices": [{"message": {"content": '{"entities":[],"relations":[]}'}}]}
    )
    dash.chat_stream = AsyncMock()
    dash.aclose = AsyncMock()
    dash.upload_file = AsyncMock(return_value="file-test")
    dash.delete_file = AsyncMock()
    dash.describe_image = AsyncMock(return_value="image text")

    with (
        patch("app.main.ensure_collection", return_value=None),
        patch("app.knowledge.indexer.ensure_collection", return_value=None),
        patch("app.knowledge.indexer.get_milvus", return_value=MagicMock()),
        patch("app.knowledge.indexer.hybrid_search", return_value=[]),
        patch("app.knowledge.indexer.upsert_chunks", return_value=None),
        patch("app.knowledge.indexer.drop_doc", return_value=None),
        patch("app.knowledge.indexer.drop_namespace", return_value=None),
        patch("app.knowledge.indexer.purge_legacy_session_from_kb", return_value=None),
        patch("app.main.get_redis", AsyncMock(return_value=redis_mock)),
        patch("app.core.redis.get_redis", AsyncMock(return_value=redis_mock)),
        patch("app.core.redis.close_redis", AsyncMock()),
        patch("app.main.get_dashscope_client", return_value=dash),
        patch("app.llm.dashscope.get_dashscope_client", return_value=dash),
        patch("app.llm.dashscope.dashscope_client", dash),
        patch("app.knowledge.kg_extract.dashscope_client", dash),
    ):
        yield {"redis": redis_mock, "dashscope": dash}


@pytest_asyncio.fixture
async def client(engine, mock_externals, clean_db) -> AsyncIterator[AsyncClient]:
    from app.main import create_app

    application = create_app()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "unit: pure unit tests")
    config.addinivalue_line("markers", "integration: ASGI + Postgres")
    config.addinivalue_line("markers", "system: live compose smoke")
