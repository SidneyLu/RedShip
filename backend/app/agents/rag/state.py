"""Pipeline RAG（快速问答）LangGraph 状态 TypedDict。"""
from __future__ import annotations

from typing import Any, TypedDict


class WebHit(TypedDict, total=False):
    """联网搜索单条结果元数据（可含抽取正文 content）。"""

    title: str
    url: str
    snippet: str
    icon: str
    site_name: str
    content: str


class RagState(TypedDict, total=False):
    """图状态；本地检索优先，不足时再联网抽取。"""

    thread_id: str
    user_id: str
    query: str
    history: list[dict[str, Any]]
    system_messages: list[dict[str, Any]]
    attachments: list[dict[str, Any]]

    rewritten_query: str
    entities: dict[str, Any]
    route: str  # kb | web | hybrid

    kb_passages: list[dict[str, Any]]
    web_results: list[WebHit]
    web_summary: str

    citations: list[dict[str, Any]]
    answer_markdown: str
    reasoning: str
    error: str | None
