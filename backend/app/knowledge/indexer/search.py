"""Milvus hybrid search (dense ANN + BM25 sparse, RRF fusion)."""
from __future__ import annotations

from pymilvus import AnnSearchRequest, RRFRanker

from app.knowledge.contracts import HybridSearchHit
from app.knowledge.indexer.client import get_milvus


def hybrid_search(
    *,
    collection_name: str,
    query_text: str,
    query_dense: list[float],
    top_k: int = 20,
    extra_filter: str | None = None,
    rrf_k: int = 60,
) -> list[HybridSearchHit]:
    """稠密 ANN + BM25 稀疏检索，RRFRanker 融合后取 top_k。

    参数:
        extra_filter: Milvus 表达式，如 source、namespace 过滤。
    """
    client = get_milvus()

    dense_req = AnnSearchRequest(
        data=[query_dense],
        anns_field="dense",
        param={"metric_type": "COSINE", "params": {"ef": 128}},
        limit=top_k,
        expr=extra_filter,
    )
    sparse_req = AnnSearchRequest(
        data=[query_text],
        anns_field="sparse",
        param={"metric_type": "BM25", "params": {"drop_ratio_build": 0.0}},
        limit=top_k,
        expr=extra_filter,
    )

    results = client.hybrid_search(
        collection_name=collection_name,
        reqs=[dense_req, sparse_req],
        ranker=RRFRanker(k=rrf_k),
        limit=top_k,
        output_fields=[
            "text",
            "doc_id",
            "source",
            "parent_index",
            "heading_path",
            "era",
            "chunk_type",
            "namespace",
        ],
    )

    out: list[HybridSearchHit] = []
    if not results:
        return out
    for hit in results[0]:
        entity = getattr(hit, "entity", None)
        if entity is None and isinstance(hit, dict):
            entity = hit.get("entity") or hit
            score = float(hit.get("distance") or hit.get("score") or 0.0)
            hit_id = hit.get("id")
        else:
            score = float(getattr(hit, "distance", 0.0))
            hit_id = getattr(hit, "id", None)
        if entity is None:
            continue
        get = entity.get if isinstance(entity, dict) else lambda k, default=None: getattr(entity, k, default)
        out.append(
            HybridSearchHit(
                id=str(hit_id),
                score=score,
                text=str(get("text", "")),
                doc_id=str(get("doc_id", "")),
                source=str(get("source", "")),
                parent_index=int(get("parent_index", 0) or 0),
                heading_path=str(get("heading_path", "")),
                era=str(get("era", "")),
                chunk_type=str(get("chunk_type", "child")),
                namespace=str(get("namespace", "")),
            )
        )
    return out
