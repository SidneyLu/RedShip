"""Pipeline RAG LangGraph（PLAN.md「快速问答」）。

图：query_analyzer → [kb_retriever | web_searcher] → evidence_merger → END；
生成答案在图外由 generator_stream 流式输出 SSE（token/citation 等）。
"""
from __future__ import annotations

import uuid
from functools import lru_cache
from typing import Any, AsyncIterator

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.rag.nodes import (
    evidence_merger,
    generator_stream,
    kb_retriever,
    query_analyzer,
    route_decision,
    web_searcher,
)
from app.agents.rag.state import RagState
from app.core.checkpoint import get_checkpointer


async def _kb_retriever_node(state: RagState, config: dict[str, Any]) -> dict[str, Any]:
    session: AsyncSession = config["configurable"]["session"]
    return await kb_retriever(state, session=session)


def _fan_out_retrieval(state: RagState) -> list[Send]:
    return [Send(node, state) for node in route_decision(state)]


@lru_cache(maxsize=1)
def get_rag_graph():
    graph = StateGraph(RagState)
    graph.add_node("query_analyzer", query_analyzer)
    graph.add_node("kb_retriever", _kb_retriever_node)
    graph.add_node("web_searcher", web_searcher)
    graph.add_node("evidence_merger", evidence_merger)

    graph.add_edge(START, "query_analyzer")
    graph.add_conditional_edges("query_analyzer", _fan_out_retrieval)
    graph.add_edge("kb_retriever", "evidence_merger")
    graph.add_edge("web_searcher", "evidence_merger")
    graph.add_edge("evidence_merger", END)

    return graph.compile(checkpointer=get_checkpointer())


async def run_rag_stream(
    session: AsyncSession,
    *,
    user_id: str,
    thread_id: str,
    message_id: str | None,
    query: str,
    history: list[dict[str, Any]] | None = None,
    system_messages: list[dict[str, Any]] | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """执行 RAG 图并产出 chat 路由消费的 SSE 事件 dict。

    事件：stage、analysis、token、reasoning、citations_ready、done、final_state。
    """
    if not message_id:
        message_id = str(uuid.uuid4())

    state: RagState = {
        "user_id": user_id,
        "thread_id": thread_id,
        "query": query,
        "history": history or [],
        "system_messages": system_messages or [],
        "attachments": attachments or [],
    }

    graph = get_rag_graph()
    config = {
        "configurable": {
            "thread_id": thread_id,
            "session": session,
        }
    }

    yield {"type": "stage", "name": "analyzing", "label": "正在分析问题..."}

    async for update in graph.astream(state, config=config, stream_mode="updates"):
        for node_name, patch in update.items():
            state.update(patch)  # type: ignore[arg-type]
            if node_name == "query_analyzer":
                yield {
                    "type": "analysis",
                    "rewritten_query": state.get("rewritten_query"),
                    "entities": state.get("entities"),
                    "route": state.get("route"),
                }
            elif node_name in {"kb_retriever", "web_searcher"}:
                yield {
                    "type": "stage",
                    "name": "retrieving",
                    "node": node_name,
                    "route": state.get("route"),
                }
            elif node_name == "evidence_merger":
                yield {
                    "type": "stage",
                    "name": "generating",
                    "label": "正在生成回答...",
                    "citations_count": len(state.get("citations") or []),
                }

    yield {
        "type": "stage",
        "name": "generating",
        "label": "正在生成回答...",
        "citations_count": len(state.get("citations") or []),
    }

    async for event in generator_stream(state, thread_id=thread_id, message_id=message_id):
        yield event

    yield {
        "type": "final_state",
        "citations": state.get("citations") or [],
        "rewritten_query": state.get("rewritten_query"),
        "route": state.get("route"),
    }
