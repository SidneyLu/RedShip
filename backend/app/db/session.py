"""异步 SQLAlchemy 引擎与会话工厂。

FastAPI 通过 `api.deps.DbSession` 注入 `get_session`；LangGraph 节点从 config 取独立 session。
"""
from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """懒创建 asyncpg 引擎；pool_pre_ping 避免陈旧连接。"""
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            settings.async_database_url,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
            echo=False,
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """会话工厂单例；expire_on_commit=False 便于流式响应中继续读 ORM 对象。"""
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
            class_=AsyncSession,
        )
    return _session_factory


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI Depends 用的异步生成器：请求结束自动关闭会话。"""
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def dispose_engine() -> None:
    """应用关闭时释放连接池。"""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
