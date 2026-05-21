"""Deep Research LangGraph (PLAN.md).

Graph:
  planner → search_iteration ⇄ reflect → build_citations → (SSE writer)
"""
from __future__ import annotations

import asyncio
import uuid
from functools import lru_cache
from typing import Any, AsyncIterator

from langgraph.graph import END, START, StateGraph
from loguru import logger

from app.agents.research.nodes import (
    build_citations,
    parallel_searcher,
    planner,
    reflector,
    writer_stream,
)
from app.agents.research.state import ResearchState
from app.core.checkpoint import get_checkpointer
from app.core.config import settings


async def _planner_node(state: ResearchState, config: dict[str, Any]) -> dict[str, Any]:
    queue: asyncio.Queue[dict[str, Any]] = config["configurable"]["events_queue"]
    await queue.put({"type": "research_step", "step": "planning", "label": "规划研究子问题..."})
    plan = await planner(state)
    await queue.put(
        {
            "type": "research_step",
            "step": "plan_ready",
            "plan_summary": plan.get("plan_summary", ""),
            "sub_questions": plan.get("sub_questions", []),
        }
    )
    return {
        **plan,
        "pending_questions": plan.get("sub_questions") or [],
        "iteration": 0,
        "evidence": state.get("evidence") or [],
        "need_more": False,
    }


async def _search_node(state: ResearchState, config: dict[str, Any]) -> dict[str, Any]:
    queue: asyncio.Queue[dict[str, Any]] = config["configurable"]["events_queue"]
    iteration = int(state.get("iteration") or 0) + 1
    pending = state.get("pending_questions") or state.get("sub_questions") or []
    if not pending:
        raise ValueError("search node invoked with no pending questions")

    await queue.put(
        {"type": "research_step", "step": "iteration_begin", "iteration": iteration}
    )

    async def emit(ev: dict[str, Any]) -> None:
        await queue.put(ev)

    res = await parallel_searcher(state, questions=pending, iteration=iteration, emit=emit)
    new_ev = res.get("new_evidence") or []
    merged = (state.get("evidence") or []) + new_ev
    await queue.put(
        {
            "type": "research_step",
            "step": "iteration_summary",
            "iteration": iteration,
            "new_extracts": len(new_ev),
            "total_extracts": len(merged),
        }
    )
    return {"iteration": iteration, "evidence": merged, "pending_questions": []}


async def _reflect_node(state: ResearchState, config: dict[str, Any]) -> dict[str, Any]:
    queue: asyncio.Queue[dict[str, Any]] = config["configurable"]["events_queue"]
    await queue.put(
        {
            "type": "research_step",
            "step": "reflecting",
            "iteration": state.get("iteration", 0),
        }
    )
    reflection = await reflector(state)
    follow_ups = reflection.get("follow_ups") or []
    capped = follow_ups[: settings.research_parallel_subqueries]
    await queue.put(
        {
            "type": "research_step",
            "step": "reflection_done",
            "iteration": state.get("iteration", 0),
            "need_more": bool(reflection.get("need_more")),
            "gaps": reflection.get("gaps", []),
            "follow_ups": follow_ups,
        }
    )
    subs = list(state.get("sub_questions") or [])
    if reflection.get("need_more") and capped:
        subs = subs + capped
    return {
        "need_more": bool(reflection.get("need_more")),
        "gaps": reflection.get("gaps", []),
        "follow_ups": follow_ups,
        "pending_questions": capped if reflection.get("need_more") else [],
        "sub_questions": subs,
    }


async def _citations_node(state: ResearchState, config: dict[str, Any]) -> dict[str, Any]:
    citations = build_citations(state.get("evidence") or [])
    queue: asyncio.Queue[dict[str, Any]] = config["configurable"]["events_queue"]
    await queue.put({"type": "citations_ready", "items": citations})
    return {"citations": citations}


def _route_after_reflect(state: ResearchState) -> str:
    iteration = int(state.get("iteration") or 0)
    max_iter = int(state.get("max_iterations") or settings.research_max_iterations)
    if (
        state.get("need_more")
        and state.get("pending_questions")
        and iteration < max_iter
    ):
        return "search"
    return "citations"


@lru_cache(maxsize=1)
def get_research_graph():
    graph = StateGraph(ResearchState)
    graph.add_node("planner", _planner_node)
    graph.add_node("search", _search_node)
    graph.add_node("reflect", _reflect_node)
    graph.add_node("citations", _citations_node)

    graph.add_edge(START, "planner")
    graph.add_edge("planner", "search")
    graph.add_edge("search", "reflect")
    graph.add_conditional_edges("reflect", _route_after_reflect, {"search": "search", "citations": "citations"})
    graph.add_edge("citations", END)

    return graph.compile(checkpointer=get_checkpointer())


async def run_research_stream(
    *,
    user_id: str,
    thread_id: str,
    message_id: str | None,
    query: str,
    history: list[dict[str, Any]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    if not message_id:
        message_id = str(uuid.uuid4())

    state: ResearchState = {
        "user_id": user_id,
        "thread_id": thread_id,
        "query": query,
        "history": history or [],
        "evidence": [],
        "iteration": 0,
        "max_iterations": settings.research_max_iterations,
    }

    events_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    graph = get_research_graph()
    config = {
        "configurable": {
            "thread_id": thread_id,
            "events_queue": events_queue,
        }
    }

    async for update in graph.astream(state, config=config, stream_mode="updates"):
        while not events_queue.empty():
            yield events_queue.get_nowait()
        for node_name, patch in update.items():
            state.update(patch)  # type: ignore[arg-type]
            logger.debug("research graph node {} done", node_name)

    while not events_queue.empty():
        yield events_queue.get_nowait()

    yield {"type": "research_step", "step": "writing", "label": "正在撰写研究报告..."}

    async for ev in writer_stream(state, thread_id=thread_id, message_id=message_id):
        yield ev

    yield {
        "type": "final_state",
        "citations": state.get("citations") or [],
        "sub_questions": state.get("sub_questions") or [],
        "iterations": state.get("iteration", 0),
    }
