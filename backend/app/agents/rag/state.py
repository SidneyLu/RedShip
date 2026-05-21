"""Pipeline RAG（快速问答）LangGraph 状态 TypedDict。

各字段由 nodes 写入、graph.run_rag_stream 合并后供 generator_stream 使用。
"""
from __future__ import annotations

from typing import Any, TypedDict


class WebHit(TypedDict, total=False):
    """联网搜索单条结果元数据。"""
    title: str
    url: str
    snippet: str
    icon: str
    site_name: str


class RagState(TypedDict, total=False):
    """图状态；route 决定 kb_retriever / web_searcher 并行分支。"""

    thread_id: str
    user_id: str
    query: str
    history: list[dict[str, Any]]
    attachments: list[dict[str, Any]]

    rewritten_query: str
    entities: dict[str, Any]
    route: str  # kb | web | hybrid | files

    kb_passages: list[dict[str, Any]]
    web_results: list[WebHit]
    web_summary: str

    citations: list[dict[str, Any]]
    answer_markdown: str
    reasoning: str
    error: str | None
