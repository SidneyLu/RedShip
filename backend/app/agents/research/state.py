"""Deep Research LangGraph 状态 TypedDict。

planner → search ⇄ reflect 循环 → build_citations → writer_stream。
"""
from __future__ import annotations

from typing import Any, TypedDict


class ResearchEvidence(TypedDict, total=False):
    """单次子查询从 web_extractor 得到的网页摘录。"""
    sub_question: str
    iteration: int
    url: str
    title: str
    snippet: str
    content: str
    site_name: str


class ResearchState(TypedDict, total=False):
    """深度研究图状态；iteration / need_more 控制反思循环。"""

    thread_id: str
    user_id: str
    query: str
    history: list[dict[str, Any]]
    system_messages: list[dict[str, Any]]

    sub_questions: list[str]
    follow_ups: list[str]
    pending_questions: list[str]
    plan_summary: str
    need_more: bool
    iteration: int
    max_iterations: int

    evidence: list[ResearchEvidence]
    gaps: list[str]
    citations: list[dict[str, Any]]
    report_markdown: str
    session_passages: list[dict[str, Any]]
    kb_passages: list[dict[str, Any]]
