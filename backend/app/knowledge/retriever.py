"""Retrieve passages from the knowledge base.

Pipeline: hybrid_search (Milvus ANN+BM25 + RRF) → qwen3-rerank → parent recall.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, asdict
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Document, KnowledgeChunk
from app.knowledge.indexer import HybridSearchHit, hybrid_search, ensure_collection
from app.knowledge.session_docs import session_namespace_filter
from app.llm.dashscope import dashscope_client


def _merge_hits(*groups: list[HybridSearchHit]) -> list[HybridSearchHit]:
    """Dedupe hybrid hits by Milvus id, keeping the best score."""
    by_id: dict[str, HybridSearchHit] = {}
    for hits in groups:
        for h in hits:
            prev = by_id.get(h.id)
            if prev is None or h.score > prev.score:
                by_id[h.id] = h
    return sorted(by_id.values(), key=lambda h: h.score, reverse=True)


@dataclass
class RetrievedPassage:
    id: str  # citation id, stable per query
    doc_id: str
    document_title: str
    heading_path: str
    parent_index: int
    parent_text: str
    snippet: str  # the original child chunk text (highlight target)
    source: str  # bibliography | upload | session
    score: float
    era: str = ""
    series: str = ""
    relative_path: str = ""
    namespace: str = ""

    def to_citation(self, ordinal: int) -> dict:
        return {
            "ordinal": ordinal,
            "id": self.id,
            "doc_id": self.doc_id,
            "title": self.document_title,
            "heading_path": self.heading_path,
            "source_type": self.source,
            "snippet": self.snippet[:280],
            "highlight_text": self.snippet,
            "parent_text": self.parent_text,
            "relative_path": self.relative_path,
            "era": self.era,
            "series": self.series,
            "score": round(self.score, 4),
        }


async def _hits_to_passages(
    session: AsyncSession,
    query: str,
    ordered_hits: list[tuple[HybridSearchHit, float]],
    *,
    session_titles: dict[str, str] | None = None,
) -> list[RetrievedPassage]:
    if not ordered_hits:
        return []

    doc_ids = list({h.doc_id for h, _ in ordered_hits if h.source != "session"})
    parent_keys = [(h.doc_id, h.parent_index) for h, _ in ordered_hits]
    docs_by_id: dict[str, Document] = {}
    if doc_ids:
        rows = await session.execute(select(Document).where(Document.id.in_(doc_ids)))
        for d in rows.scalars():
            docs_by_id[d.id] = d

    parents_by_key: dict[tuple[str, int], KnowledgeChunk] = {}
    if parent_keys:
        from sqlalchemy import and_, or_

        conditions = [
            and_(KnowledgeChunk.document_id == d, KnowledgeChunk.parent_index == p)
            for d, p in parent_keys
            if not str(d).startswith("sess_")
        ]
        if conditions:
            rows = await session.execute(select(KnowledgeChunk).where(or_(*conditions)))
            for kc in rows.scalars():
                parents_by_key[(kc.document_id, kc.parent_index)] = kc

    session_titles = session_titles or {}
    passages: list[RetrievedPassage] = []
    for i, (h, score) in enumerate(ordered_hits, start=1):
        doc = docs_by_id.get(h.doc_id)
        parent = parents_by_key.get((h.doc_id, h.parent_index))
        parent_text = parent.parent_text if parent else h.text
        title = doc.title if doc else session_titles.get(h.doc_id, h.doc_id)
        passages.append(
            RetrievedPassage(
                id=f"c-{i}",
                doc_id=h.doc_id,
                document_title=title,
                heading_path=parent.heading_path if parent and parent.heading_path else h.heading_path,
                parent_index=h.parent_index,
                parent_text=parent_text,
                snippet=h.text,
                source=h.source or "bibliography",
                score=score,
                era=(parent.era if parent and parent.era else h.era) or (doc.era if doc else ""),
                series=doc.series if doc and doc.series else "",
                relative_path=doc.relative_path if doc and doc.relative_path else "",
                namespace=h.namespace,
            )
        )
    return passages


async def retrieve(
    session: AsyncSession,
    query: str,
    *,
    top_k: int | None = None,
    rerank_top_k: int | None = None,
    collection_name: str | None = None,
    extra_filter: str | None = None,
    thread_id: str | None = None,
) -> list[RetrievedPassage]:
    """Run the full hybrid + rerank + parent recall pipeline."""
    if not query.strip():
        return []

    collection = await asyncio.to_thread(
        ensure_collection, collection_name or settings.milvus_kb_collection
    )

    [dense] = await dashscope_client.embed(query)
    recall_k = top_k or settings.retrieval_top_k

    kb_filter = 'source == "bibliography"'
    if extra_filter:
        kb_filter = f"({kb_filter}) and ({extra_filter})"

    kb_hits: list[HybridSearchHit] = await asyncio.to_thread(
        hybrid_search,
        collection_name=collection,
        query_text=query,
        query_dense=dense,
        top_k=recall_k,
        extra_filter=kb_filter,
    )

    session_hits: list[HybridSearchHit] = []
    session_titles: dict[str, str] = {}
    if thread_id:
        session_filter = await session_namespace_filter(session, thread_id)
        if session_filter:
            session_hits = await asyncio.to_thread(
                hybrid_search,
                collection_name=collection,
                query_text=query,
                query_dense=dense,
                top_k=recall_k,
                extra_filter=session_filter,
            )
            from app.db.models import SessionFile

            rows = await session.execute(
                select(SessionFile).where(
                    SessionFile.thread_id == thread_id,
                    SessionFile.mode == "session_rag",
                    SessionFile.status == "ready",
                )
            )
            for sf in rows.scalars():
                meta = sf.extra_metadata or {}
                doc_id = meta.get("doc_id")
                if doc_id:
                    session_titles[str(doc_id)] = str(meta.get("title") or sf.filename)

    hits = _merge_hits(kb_hits, session_hits)
    if not hits:
        return []

    rerank_n = min(rerank_top_k or settings.rerank_top_k, len(hits))
    rerank_results = await dashscope_client.rerank(
        query=query,
        documents=[h.text for h in hits],
        top_n=rerank_n,
    )
    ordered_hits: list[tuple[HybridSearchHit, float]] = []
    seen = set()
    for r in rerank_results:
        if r.index < 0 or r.index >= len(hits):
            continue
        h = hits[r.index]
        if h.id in seen:
            continue
        seen.add(h.id)
        ordered_hits.append((h, r.score))
    if not ordered_hits:
        ordered_hits = [(h, h.score) for h in hits[:rerank_n]]

    return await _hits_to_passages(
        session, query, ordered_hits, session_titles=session_titles
    )


def render_evidence_block(passages: Iterable[RetrievedPassage]) -> str:
    """Compact evidence list for LLM consumption."""
    lines: list[str] = []
    for i, p in enumerate(passages, start=1):
        meta_bits = []
        if p.document_title:
            meta_bits.append(p.document_title)
        if p.heading_path:
            meta_bits.append(p.heading_path)
        if p.era:
            meta_bits.append(p.era)
        header = " | ".join(meta_bits)
        lines.append(f"[{i}] {header}\n{p.parent_text.strip()}")
    return "\n\n".join(lines)
