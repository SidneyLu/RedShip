"""Test factories for ORM models."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models import Document, KgEdge, KgEntity, Message, Thread, User, UserMemory
from app.knowledge.kg_extract import canonical_key


def _id() -> str:
    return str(uuid.uuid4())


async def make_user(
    session: AsyncSession,
    *,
    email: str | None = None,
    password: str = "testpass123",
    is_admin: bool = False,
    display_name: str | None = "Tester",
) -> User:
    user = User(
        id=_id(),
        email=email or f"user-{uuid.uuid4().hex[:8]}@test.local",
        password_hash=hash_password(password),
        display_name=display_name,
        is_admin=is_admin,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user


async def make_thread(
    session: AsyncSession,
    user: User,
    *,
    title: str = "测试对话",
    mode: str = "chat",
) -> Thread:
    thread = Thread(id=_id(), user_id=user.id, title=title, mode=mode)
    session.add(thread)
    await session.flush()
    return thread


async def make_message(
    session: AsyncSession,
    thread: Thread,
    *,
    role: str = "assistant",
    content: str = "hello",
    citations: list[dict[str, Any]] | None = None,
) -> Message:
    msg = Message(
        id=_id(),
        thread_id=thread.id,
        role=role,
        mode=thread.mode,
        content_markdown=content,
        citations=citations,
    )
    session.add(msg)
    await session.flush()
    return msg


async def make_document(
    session: AsyncSession,
    *,
    title: str = "测试文献",
    era: str | None = "土地革命战争时期",
    series: str | None = "南开人物志",
    status: str = "indexed",
    source: str = "upload",
) -> Document:
    doc = Document(
        id=_id(),
        title=title,
        source=source,
        status=status,
        era=era,
        series=series,
        file_sha256=uuid.uuid4().hex,
        chunks_count=1,
        relative_path=f"upload/{title}.md",
    )
    session.add(doc)
    await session.flush()
    return doc


async def make_kg_entity(
    session: AsyncSession,
    *,
    name: str,
    entity_type: str,
    canonical: str | None = None,
    extra: dict[str, Any] | None = None,
) -> KgEntity:
    ent = KgEntity(
        id=_id(),
        name=name,
        type=entity_type,
        canonical_key=canonical or canonical_key(entity_type, name),
        doc_count=1,
        extra_metadata=extra,
    )
    session.add(ent)
    await session.flush()
    return ent


async def make_kg_edge(
    session: AsyncSession,
    src: KgEntity,
    dst: KgEntity,
    *,
    relation: str,
    document_id: str | None = None,
    evidence: str | None = None,
) -> KgEdge:
    edge = KgEdge(
        id=_id(),
        src_entity_id=src.id,
        dst_entity_id=dst.id,
        relation=relation,
        document_id=document_id,
        evidence=evidence,
        weight=1.0,
    )
    session.add(edge)
    await session.flush()
    return edge


async def make_memory(
    session: AsyncSession,
    user: User,
    *,
    content: str = "用户关注长征史",
    category: str = "interest",
) -> UserMemory:
    mem = UserMemory(
        id=_id(),
        user_id=user.id,
        content=content,
        category=category,
    )
    session.add(mem)
    await session.flush()
    return mem
