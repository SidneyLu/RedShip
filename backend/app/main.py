"""FastAPI application entrypoint."""
from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from sqlalchemy import select

from app.api.routes import admin, auth, chat, citations, knowledge, session_files, threads
from app.core.config import settings
from app.core.redis import close_redis, get_redis
from app.core.security import hash_password
from app.db.models import User
from app.db.session import dispose_engine, get_session_factory
from app.knowledge.indexer import ensure_collection
from app.knowledge.ingestion.watcher import sync_bibliography
from app.llm.dashscope import get_dashscope_client


async def _bootstrap_admin() -> None:
    factory = get_session_factory()
    async with factory() as session:
        existing = (
            await session.execute(select(User).where(User.email == settings.admin_bootstrap_email))
        ).scalar_one_or_none()
        if existing:
            if not existing.is_admin:
                existing.is_admin = True
                await session.commit()
            return
        user = User(
            email=settings.admin_bootstrap_email,
            password_hash=hash_password(settings.admin_bootstrap_password),
            display_name="Administrator",
            is_admin=True,
        )
        session.add(user)
        await session.commit()
        logger.info("Bootstrapped admin user {}", settings.admin_bootstrap_email)


async def _initial_sync_task() -> None:
    factory = get_session_factory()
    try:
        async with factory() as session:
            summary = await sync_bibliography(session)
            logger.info(
                "Initial bibliography sync: scanned={} new={} updated={} skipped={} failed={}",
                summary.scanned,
                summary.new,
                summary.updated,
                summary.skipped,
                summary.failed,
            )
    except Exception as e:
        logger.warning("Initial bibliography sync failed: {}", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.remove()
    logger.add(sys.stderr, level=settings.log_level)
    logger.info("RedShip backend starting up...")

    try:
        ensure_collection(settings.milvus_kb_collection)
    except Exception as e:
        logger.warning("Milvus collection ensure failed (will retry lazily): {}", e)

    try:
        await _bootstrap_admin()
    except Exception as e:
        logger.warning("Admin bootstrap failed: {}", e)

    # Run initial bibliography sync in background so HTTP starts up immediately.
    sync_task: asyncio.Task | None = None
    try:
        sync_task = asyncio.create_task(_initial_sync_task())
    except Exception as e:
        logger.warning("Could not schedule initial sync: {}", e)

    yield

    logger.info("RedShip backend shutting down...")
    if sync_task and not sync_task.done():
        sync_task.cancel()
    await get_dashscope_client().aclose()
    await close_redis()
    await dispose_engine()


def create_app() -> FastAPI:
    app = FastAPI(
        title="日新册 · RedShip",
        version="0.1.0",
        description="南开大学党史 RAG 智能体（快速问答 + 深度研究双模式）",
        lifespan=lifespan,
    )

    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()] or ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(threads.router)
    app.include_router(chat.router)
    app.include_router(knowledge.router)
    app.include_router(session_files.router)
    app.include_router(citations.router)
    app.include_router(admin.router)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "app": "redship", "version": app.version}

    return app


app = create_app()
