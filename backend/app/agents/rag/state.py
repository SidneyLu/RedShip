"""Typed state for the Pipeline RAG graph."""
from __future__ import annotations

from typing import Any, TypedDict


class WebHit(TypedDict, total=False):
    title: str
    url: str
    snippet: str
    icon: str
    site_name: str


class RagState(TypedDict, total=False):
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
