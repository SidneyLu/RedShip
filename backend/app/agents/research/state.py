"""Typed state for the Deep Research graph."""
from __future__ import annotations

from typing import Any, TypedDict


class ResearchEvidence(TypedDict, total=False):
    sub_question: str
    iteration: int
    url: str
    title: str
    snippet: str
    content: str
    site_name: str


class ResearchState(TypedDict, total=False):
    thread_id: str
    user_id: str
    query: str
    history: list[dict[str, Any]]

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
