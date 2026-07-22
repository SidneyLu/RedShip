"""用户级长期记忆：Postgres 元数据 + Milvus 向量召回。"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import UserMemory
from app.knowledge.indexer import (
    IndexableChunk,
    drop_doc,
    ensure_collection,
    hybrid_search,
    upsert_chunks,
)
from app.llm.dashscope import dashscope_client

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json(text: str) -> dict[str, Any]:
    if not text:
        return {}
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).rstrip("`").strip()
    try:
        return json.loads(text)
    except Exception:
        m = _JSON_RE.search(text)
        if not m:
            return {}
        try:
            return json.loads(m.group(0))
        except Exception:
            return {}


def format_memory_system_message(memories: list[UserMemory] | list[dict[str, Any]]) -> dict[str, str] | None:
    if not memories:
        return None
    lines: list[str] = []
    for m in memories:
        if isinstance(m, dict):
            cat = m.get("category") or "fact"
            content = m.get("content") or ""
        else:
            cat = m.category or "fact"
            content = m.content
        if content:
            lines.append(f"- [{cat}] {content}")
    if not lines:
        return None
    return {
        "role": "system",
        "content": "用户长期记忆（跨会话，请在相关时尊重这些事实/偏好）：\n" + "\n".join(lines),
    }


async def retrieve_user_memories(
    session: AsyncSession,
    *,
    user_id: str,
    query: str,
    top_k: int | None = None,
) -> list[UserMemory]:
    if not settings.user_memory_enabled or not query.strip():
        return []
    k = top_k or settings.user_memory_top_k
    collection = ensure_collection(settings.milvus_user_memory_collection)
    [dense] = await dashscope_client.embed(query)
    # namespace 存 user_id
    filt = f'namespace == "{user_id}" and source == "user_memory"'
    hits = hybrid_search(
        collection_name=collection,
        query_text=query,
        query_dense=dense,
        top_k=k,
        extra_filter=filt,
    )
    if not hits:
        return []
    ids = [h.doc_id for h in hits if h.doc_id]
    rows = (
        await session.execute(select(UserMemory).where(UserMemory.id.in_(ids)))
    ).scalars().all()
    by_id = {r.id: r for r in rows}
    ordered = [by_id[i] for i in ids if i in by_id]
    now = datetime.now(timezone.utc)
    for r in ordered:
        r.last_used_at = now
    if ordered:
        await session.commit()
    return ordered


async def extract_and_store(
    session: AsyncSession,
    *,
    user_id: str,
    thread_id: str | None,
    user_query: str,
    assistant_answer: str,
) -> list[UserMemory]:
    """从本轮问答抽取 0–3 条稳定事实并入库。"""
    if not settings.user_memory_enabled:
        return []
    if not user_query.strip() or not assistant_answer.strip():
        return []

    prompt = (
        "从下列用户与助手对话中抽取值得跨会话长期记住的稳定事实或偏好（0–3 条）。\n"
        "不要记录临时闲聊、一次性问题、敏感隐私（密码/证件号）。\n"
        "仅输出 JSON：{\"memories\":[{\"content\":\"...\",\"category\":\"fact|preference|entity\"}]}\n\n"
        f"用户：{user_query[:1500]}\n\n助手：{assistant_answer[:2000]}"
    )
    try:
        resp = await dashscope_client.chat(
            messages=[
                {"role": "system", "content": "你是用户画像记忆抽取器。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        data = _parse_json(resp["choices"][0]["message"].get("content", "{}"))
    except Exception as e:
        logger.warning("user memory extract failed: {}", e)
        return []

    items = data.get("memories") if isinstance(data, dict) else None
    if not isinstance(items, list) or not items:
        return []

    stored: list[UserMemory] = []
    texts: list[str] = []
    for raw in items[:3]:
        if not isinstance(raw, dict):
            continue
        content = str(raw.get("content") or "").strip()
        if len(content) < 4:
            continue
        category = str(raw.get("category") or "fact").lower()
        if category not in {"fact", "preference", "entity"}:
            category = "fact"
        row = UserMemory(
            id=str(uuid.uuid4()),
            user_id=user_id,
            content=content,
            category=category,
            source_thread_id=thread_id,
        )
        session.add(row)
        stored.append(row)
        texts.append(content)

    if not stored:
        return []

    await session.commit()
    for row in stored:
        await session.refresh(row)

    try:
        embeddings = await dashscope_client.embed(texts)
        collection = ensure_collection(settings.milvus_user_memory_collection)
        chunks = [
            IndexableChunk(
                id=f"umem_{row.id}",
                text=row.content,
                dense=vec,
                source="user_memory",
                doc_id=row.id,
                chunk_type="child",
                parent_index=0,
                heading_path=row.category,
                era="",
                namespace=user_id,
            )
            for row, vec in zip(stored, embeddings)
        ]
        upsert_chunks(collection, chunks)
    except Exception as e:
        logger.warning("user memory vector upsert failed: {}", e)

    return stored


async def list_user_memories(
    session: AsyncSession, *, user_id: str, limit: int = 50
) -> list[UserMemory]:
    rows = await session.execute(
        select(UserMemory)
        .where(UserMemory.user_id == user_id)
        .order_by(UserMemory.created_at.desc())
        .limit(limit)
    )
    return list(rows.scalars().all())


async def delete_user_memory(
    session: AsyncSession, *, user_id: str, memory_id: str
) -> bool:
    row = (
        await session.execute(
            select(UserMemory).where(UserMemory.id == memory_id, UserMemory.user_id == user_id)
        )
    ).scalar_one_or_none()
    if not row:
        return False
    await session.delete(row)
    await session.commit()
    try:
        drop_doc(settings.milvus_user_memory_collection, memory_id)
        # also delete by milvus primary id pattern
        from app.knowledge.indexer import get_milvus

        client = get_milvus()
        name = settings.milvus_user_memory_collection
        if client.has_collection(name):
            client.delete(collection_name=name, filter=f'id == "umem_{memory_id}"')
    except Exception as e:
        logger.warning("delete user memory vectors failed: {}", e)
    return True
