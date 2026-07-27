"""知识图谱：结构边构建 + LLM 实体关系抽取 + 查询辅助。"""
from __future__ import annotations

import json
import re
from typing import Any

from loguru import logger
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document, KgEdge, KgEntity, KnowledgeChunk
from app.knowledge.ingestion.chunker import ParentChunk
from app.llm.dashscope import dashscope_client

ENTITY_TYPES = {"person", "organization", "event", "era", "series", "document", "section"}
RELATION_TYPES = {
    "in_era",
    "in_series",
    "has_section",
    "section_of",
    "participated_in",
    "affiliated_with",
    "related_to",
    "mentions",
}

_EXTRACT_SYSTEM = """你是党史文献知识图谱抽取器。从给定中文文献片段中抽取实体与关系。
仅输出 JSON：
{
  "entities":[{"name":"...","type":"person|organization|event"}],
  "relations":[{"src":"...","dst":"...","relation":"participated_in|affiliated_with|related_to|mentions","evidence":"..."}]
}
要求：
- 只抽取与中国共产党历史、南开相关的真实实体；不要虚构；
- name 用规范中文简称；type 只能是 person / organization / event；
- relation 只能用上述枚举；evidence 摘录原文短句（≤80字）；
- 实体不超过 20 个，关系不超过 25 条；无内容则返回空数组。"""

_BATCH_PARENTS = 4
_PARENT_CHAR_CAP = 1800


def canonical_key(entity_type: str, name: str) -> str:
    norm = re.sub(r"\s+", "", (name or "").strip().lower())
    return f"{entity_type}:{norm}"


async def upsert_entity(
    session: AsyncSession,
    *,
    name: str,
    entity_type: str,
    extra: dict[str, Any] | None = None,
    bump_doc: bool = False,
) -> KgEntity:
    key = canonical_key(entity_type, name)
    row = (
        await session.execute(select(KgEntity).where(KgEntity.canonical_key == key))
    ).scalar_one_or_none()
    if row:
        if bump_doc:
            row.doc_count = int(row.doc_count or 0) + 1
        if extra:
            meta = dict(row.extra_metadata or {})
            meta.update(extra)
            row.extra_metadata = meta
        return row
    row = KgEntity(
        name=(name or "").strip()[:512] or key,
        type=entity_type,
        canonical_key=key,
        doc_count=1 if bump_doc else 0,
        extra_metadata=extra,
    )
    session.add(row)
    await session.flush()
    return row


async def upsert_edge(
    session: AsyncSession,
    *,
    src: KgEntity,
    dst: KgEntity,
    relation: str,
    document_id: str | None = None,
    chunk_id: str | None = None,
    weight: float = 1.0,
    evidence: str | None = None,
) -> KgEdge | None:
    if src.id == dst.id:
        return None
    relation = relation if relation in RELATION_TYPES else "related_to"
    existing = (
        await session.execute(
            select(KgEdge).where(
                KgEdge.src_entity_id == src.id,
                KgEdge.dst_entity_id == dst.id,
                KgEdge.relation == relation,
                KgEdge.document_id == document_id if document_id else KgEdge.document_id.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.weight = float(existing.weight or 1.0) + weight
        if evidence and not existing.evidence:
            existing.evidence = evidence[:500]
        if chunk_id and not existing.chunk_id:
            existing.chunk_id = chunk_id
        return existing
    edge = KgEdge(
        src_entity_id=src.id,
        dst_entity_id=dst.id,
        relation=relation,
        document_id=document_id,
        chunk_id=chunk_id,
        weight=weight,
        evidence=(evidence or "")[:500] or None,
    )
    session.add(edge)
    return edge


async def clear_document_graph(session: AsyncSession, document_id: str) -> None:
    """删除文档专属边与 document/section 结构节点。"""
    await session.execute(delete(KgEdge).where(KgEdge.document_id == document_id))
    # section / document 节点以 metadata.document_id 或 canonical_key 前缀标识
    doc_key = canonical_key("document", document_id)
    section_prefix = f"section:{document_id}:"
    entities = (
        await session.execute(
            select(KgEntity).where(
                or_(
                    KgEntity.canonical_key == doc_key,
                    KgEntity.canonical_key.like(f"{section_prefix}%"),
                )
            )
        )
    ).scalars().all()
    for e in entities:
        await session.delete(e)
    await session.flush()


def _safe_json(text: str) -> dict[str, Any]:
    if not text:
        return {}
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).rstrip("`").strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except Exception:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            return {}
        try:
            data = json.loads(m.group(0))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}


async def _extract_batch(texts: list[str]) -> dict[str, Any]:
    blob = "\n\n---\n\n".join(texts)
    resp = await dashscope_client.chat(
        messages=[
            {"role": "system", "content": _EXTRACT_SYSTEM},
            {"role": "user", "content": blob[:12000]},
        ],
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    content = resp["choices"][0]["message"].get("content", "{}")
    return _safe_json(content)


async def build_document_graph(
    session: AsyncSession,
    doc: Document,
    parents: list[ParentChunk],
    *,
    extract_entities: bool = True,
) -> dict[str, int]:
    """为单篇文档构建结构边 +（可选）实体关系。先清再建。"""
    await clear_document_graph(session, doc.id)

    doc_key = canonical_key("document", doc.id)
    doc_ent = (
        await session.execute(select(KgEntity).where(KgEntity.canonical_key == doc_key))
    ).scalar_one_or_none()
    if not doc_ent:
        doc_ent = KgEntity(
            name=(doc.title or doc.id)[:512],
            type="document",
            canonical_key=doc_key,
            doc_count=1,
            extra_metadata={"document_id": doc.id, "era": doc.era, "series": doc.series},
        )
        session.add(doc_ent)
        await session.flush()
    else:
        doc_ent.name = (doc.title or doc.id)[:512]
        doc_ent.extra_metadata = {"document_id": doc.id, "era": doc.era, "series": doc.series}
        doc_ent.doc_count = 1

    stats = {"structure_edges": 0, "entities": 0, "entity_edges": 0}

    if doc.era:
        era_ent = await upsert_entity(session, name=doc.era, entity_type="era", bump_doc=True)
        await upsert_edge(
            session, src=doc_ent, dst=era_ent, relation="in_era", document_id=doc.id
        )
        stats["structure_edges"] += 1

    if doc.series:
        series_ent = await upsert_entity(
            session, name=doc.series, entity_type="series", bump_doc=True
        )
        await upsert_edge(
            session, src=doc_ent, dst=series_ent, relation="in_series", document_id=doc.id
        )
        stats["structure_edges"] += 1

    section_ents: dict[str, KgEntity] = {}
    for parent in parents:
        path = (parent.heading_path or "").strip() or f"段落{parent.parent_index}"
        parts = [p.strip() for p in re.split(r"\s*>\s*", path) if p.strip()]
        if not parts:
            parts = [path]
        prev: KgEntity | None = None
        cum = ""
        for i, part in enumerate(parts):
            cum = part if not cum else f"{cum} > {part}"
            skey = f"section:{doc.id}:{cum.lower()}"
            if skey in section_ents:
                cur = section_ents[skey]
            else:
                existing = (
                    await session.execute(select(KgEntity).where(KgEntity.canonical_key == skey))
                ).scalar_one_or_none()
                if existing:
                    cur = existing
                    section_ents[skey] = cur
                else:
                    cur = KgEntity(
                        name=part[:200],
                        type="section",
                        canonical_key=skey,
                        doc_count=0,
                        extra_metadata={"document_id": doc.id, "heading_path": cum},
                    )
                    session.add(cur)
                    await session.flush()
                    section_ents[skey] = cur
            if i == 0:
                await upsert_edge(
                    session,
                    src=doc_ent,
                    dst=cur,
                    relation="has_section",
                    document_id=doc.id,
                )
                stats["structure_edges"] += 1
            if prev is not None:
                await upsert_edge(
                    session,
                    src=prev,
                    dst=cur,
                    relation="has_section",
                    document_id=doc.id,
                )
                stats["structure_edges"] += 1
            prev = cur

    if extract_entities and parents:
        batches: list[list[ParentChunk]] = []
        for i in range(0, len(parents), _BATCH_PARENTS):
            batches.append(parents[i : i + _BATCH_PARENTS])
        name_to_ent: dict[str, KgEntity] = {}
        for batch in batches:
            texts = []
            for p in batch:
                heading = p.heading_path or ""
                body = (p.text or "")[:_PARENT_CHAR_CAP]
                texts.append(f"【{heading}】\n{body}")
            try:
                data = await _extract_batch(texts)
            except Exception as e:
                logger.warning("KG extract failed for doc {}: {}", doc.id, e)
                continue
            for ent in data.get("entities") or []:
                if not isinstance(ent, dict):
                    continue
                name = str(ent.get("name") or "").strip()
                et = str(ent.get("type") or "").strip().lower()
                if not name or et not in {"person", "organization", "event"}:
                    continue
                e = await upsert_entity(session, name=name, entity_type=et, bump_doc=True)
                name_to_ent[name] = e
                name_to_ent[canonical_key(et, name)] = e
                await upsert_edge(
                    session,
                    src=doc_ent,
                    dst=e,
                    relation="mentions",
                    document_id=doc.id,
                    evidence=name,
                )
                stats["entities"] += 1
                stats["entity_edges"] += 1
            for rel in data.get("relations") or []:
                if not isinstance(rel, dict):
                    continue
                src_name = str(rel.get("src") or "").strip()
                dst_name = str(rel.get("dst") or "").strip()
                relation = str(rel.get("relation") or "related_to").strip()
                evidence = str(rel.get("evidence") or "")[:200]
                if not src_name or not dst_name:
                    continue
                src = name_to_ent.get(src_name)
                dst = name_to_ent.get(dst_name)
                if not src or not dst:
                    continue
                await upsert_edge(
                    session,
                    src=src,
                    dst=dst,
                    relation=relation,
                    document_id=doc.id,
                    evidence=evidence or None,
                )
                stats["entity_edges"] += 1

    await session.flush()
    return stats


async def rebuild_knowledge_graph(
    session: AsyncSession,
    *,
    extract_entities: bool = True,
    limit: int | None = None,
) -> dict[str, Any]:
    """对已 indexed 文档重建图谱（不重 embed）。"""
    stmt = (
        select(Document)
        .where(Document.status == "indexed")
        .order_by(Document.updated_at.desc())
    )
    if limit:
        stmt = stmt.limit(limit)
    docs = (await session.execute(stmt)).scalars().all()
    summary = {"documents": 0, "ok": 0, "failed": 0, "failures": []}
    for doc in docs:
        summary["documents"] += 1
        chunks = (
            await session.execute(
                select(KnowledgeChunk)
                .where(KnowledgeChunk.document_id == doc.id)
                .order_by(KnowledgeChunk.parent_index)
            )
        ).scalars().all()
        parents = [
            ParentChunk(
                text=c.parent_text or "",
                parent_index=c.parent_index,
                heading_path=c.heading_path or "",
                children=[],
                metadata={},
            )
            for c in chunks
        ]
        try:
            await build_document_graph(
                session, doc, parents, extract_entities=extract_entities
            )
            await session.commit()
            summary["ok"] += 1
        except Exception as e:
            await session.rollback()
            logger.exception("rebuild KG failed for {}: {}", doc.id, e)
            summary["failed"] += 1
            summary["failures"].append({"document_id": doc.id, "title": doc.title, "error": str(e)[:200]})
    return summary


def _node_payload(e: KgEntity, size: int | None = None) -> dict[str, Any]:
    return {
        "id": e.id,
        "label": e.name,
        "type": e.type,
        "size": size if size is not None else max(1, int(e.doc_count or 1)),
        "canonical_key": e.canonical_key,
        "metadata": e.extra_metadata or {},
    }


def _edge_payload(edge: KgEdge) -> dict[str, Any]:
    return {
        "id": edge.id,
        "source": edge.src_entity_id,
        "target": edge.dst_entity_id,
        "relation": edge.relation,
        "document_id": edge.document_id,
        "weight": float(edge.weight or 1.0),
        "evidence": edge.evidence,
    }


async def query_graph(
    session: AsyncSession,
    *,
    era: str | None = None,
    series: str | None = None,
    types: list[str] | None = None,
    q: str | None = None,
    limit_nodes: int = 200,
) -> dict[str, Any]:
    """浏览型图谱：按过滤裁剪节点与边。"""
    limit_nodes = max(20, min(limit_nodes, 500))

    # 起点：document 节点
    doc_stmt = select(Document).where(Document.status == "indexed")
    if era:
        doc_stmt = doc_stmt.where(Document.era == era)
    if series:
        doc_stmt = doc_stmt.where(Document.series == series)
    if q:
        like = f"%{q}%"
        doc_stmt = doc_stmt.where(or_(Document.title.ilike(like), Document.relative_path.ilike(like)))
    docs = (await session.execute(doc_stmt.limit(limit_nodes))).scalars().all()
    doc_ids = [d.id for d in docs]

    if not doc_ids:
        # 仍可返回 era/series 全局节点
        ents = (
            await session.execute(
                select(KgEntity).where(KgEntity.type.in_(["era", "series"])).limit(50)
            )
        ).scalars().all()
        return {
            "nodes": [_node_payload(e) for e in ents],
            "edges": [],
        }

    # 与这些文档相关的边
    edges = (
        await session.execute(select(KgEdge).where(KgEdge.document_id.in_(doc_ids)))
    ).scalars().all()

    entity_ids: set[str] = set()
    for e in edges:
        entity_ids.add(e.src_entity_id)
        entity_ids.add(e.dst_entity_id)

    # 保证 document 实体在内
    for did in doc_ids:
        entity_ids.add("")  # placeholder
    doc_keys = [canonical_key("document", did) for did in doc_ids]
    doc_ents = (
        await session.execute(select(KgEntity).where(KgEntity.canonical_key.in_(doc_keys)))
    ).scalars().all()
    for e in doc_ents:
        entity_ids.add(e.id)
    entity_ids.discard("")

    if types:
        allowed = set(types)
        ents = (
            await session.execute(
                select(KgEntity).where(
                    KgEntity.id.in_(list(entity_ids)),
                    KgEntity.type.in_(list(allowed)),
                )
            )
        ).scalars().all()
        keep = {e.id for e in ents}
        # 始终保留 document
        for e in doc_ents:
            keep.add(e.id)
        entity_ids = keep
        edges = [ed for ed in edges if ed.src_entity_id in entity_ids and ed.dst_entity_id in entity_ids]
    else:
        ents = (
            await session.execute(select(KgEntity).where(KgEntity.id.in_(list(entity_ids))))
        ).scalars().all()

    # 度
    degree: dict[str, int] = {e.id: 0 for e in ents}
    for ed in edges:
        degree[ed.src_entity_id] = degree.get(ed.src_entity_id, 0) + 1
        degree[ed.dst_entity_id] = degree.get(ed.dst_entity_id, 0) + 1

    # 裁剪：优先保留 document / era / series 与高度实体
    if len(ents) > limit_nodes:
        priority = {"document": 0, "era": 1, "series": 2, "person": 3, "organization": 4, "event": 5, "section": 6}
        ents_sorted = sorted(
            ents,
            key=lambda e: (priority.get(e.type, 9), -degree.get(e.id, 0), e.name),
        )
        ents = ents_sorted[:limit_nodes]
        keep = {e.id for e in ents}
        edges = [ed for ed in edges if ed.src_entity_id in keep and ed.dst_entity_id in keep]

    return {
        "nodes": [_node_payload(e, size=max(2, degree.get(e.id, 1))) for e in ents],
        "edges": [_edge_payload(ed) for ed in edges],
    }


async def query_ego_graph(
    session: AsyncSession,
    *,
    names: list[str] | None = None,
    doc_ids: list[str] | None = None,
    depth: int = 1,
    limit: int = 80,
) -> dict[str, Any]:
    """以实体名 / 文档为中心的一跳邻域。"""
    depth = 1  # 首版固定一跳
    limit = max(10, min(limit, 200))
    seed_ids: set[str] = set()

    for name in names or []:
        n = (name or "").strip()
        if not n:
            continue
        for et in ("person", "organization", "event", "era", "series"):
            key = canonical_key(et, n)
            row = (
                await session.execute(select(KgEntity).where(KgEntity.canonical_key == key))
            ).scalar_one_or_none()
            if row:
                seed_ids.add(row.id)
        # 模糊
        like = f"%{n}%"
        rows = (
            await session.execute(
                select(KgEntity).where(KgEntity.name.ilike(like)).limit(5)
            )
        ).scalars().all()
        for r in rows:
            seed_ids.add(r.id)

    for did in doc_ids or []:
        key = canonical_key("document", did)
        row = (
            await session.execute(select(KgEntity).where(KgEntity.canonical_key == key))
        ).scalar_one_or_none()
        if row:
            seed_ids.add(row.id)

    if not seed_ids:
        return {"nodes": [], "edges": []}

    edges = (
        await session.execute(
            select(KgEdge).where(
                or_(
                    KgEdge.src_entity_id.in_(list(seed_ids)),
                    KgEdge.dst_entity_id.in_(list(seed_ids)),
                )
            )
        )
    ).scalars().all()

    entity_ids = set(seed_ids)
    for ed in edges:
        entity_ids.add(ed.src_entity_id)
        entity_ids.add(ed.dst_entity_id)

    ents = (
        await session.execute(select(KgEntity).where(KgEntity.id.in_(list(entity_ids))))
    ).scalars().all()

    if len(ents) > limit:
        # 保留 seed + 按类型优先
        priority = {"document": 0, "person": 1, "organization": 2, "event": 3, "era": 4, "series": 5, "section": 6}
        others = [e for e in ents if e.id not in seed_ids]
        others.sort(key=lambda e: (priority.get(e.type, 9), e.name))
        seeds = [e for e in ents if e.id in seed_ids]
        ents = (seeds + others)[:limit]
        keep = {e.id for e in ents}
        edges = [ed for ed in edges if ed.src_entity_id in keep and ed.dst_entity_id in keep]

    degree: dict[str, int] = {}
    for ed in edges:
        degree[ed.src_entity_id] = degree.get(ed.src_entity_id, 0) + 1
        degree[ed.dst_entity_id] = degree.get(ed.dst_entity_id, 0) + 1

    return {
        "nodes": [
            {
                **_node_payload(e, size=max(3, degree.get(e.id, 1) + (3 if e.id in seed_ids else 0))),
                "seed": e.id in seed_ids,
            }
            for e in ents
        ],
        "edges": [_edge_payload(ed) for ed in edges],
    }
