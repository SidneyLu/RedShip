"""Nodes of the Pipeline RAG LangGraph."""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, AsyncIterator

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.rag.prompts import (
    ANSWER_SYSTEM_TEMPLATE,
    QUERY_ANALYZER_SYSTEM,
    SYSTEM_PERSONA,
)
from app.agents.rag.state import RagState, WebHit
from app.core.config import settings
from app.core.redis import cache_get_json, cache_set_json
from app.knowledge.retriever import RetrievedPassage, retrieve
from app.llm.dashscope import dashscope_client


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _safe_json_loads(text: str) -> dict[str, Any]:
    if not text:
        return {}
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).rstrip("`").strip()
    try:
        return json.loads(text)
    except Exception:
        m = _JSON_BLOCK_RE.search(text)
        if not m:
            return {}
        try:
            return json.loads(m.group(0))
        except Exception:
            return {}


async def query_analyzer(state: RagState) -> dict[str, Any]:
    query = state["query"]
    history = state.get("history") or []
    messages = [{"role": "system", "content": QUERY_ANALYZER_SYSTEM}]
    if history:
        for h in history[-4:]:
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": query})

    resp = await dashscope_client.chat(
        messages=messages,
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    content = resp["choices"][0]["message"].get("content", "{}")
    data = _safe_json_loads(content)
    if not data:
        raise ValueError("query_analyzer returned empty or invalid JSON")
    route = (data.get("route") or "kb").lower()
    if route not in {"kb", "web", "hybrid"}:
        route = "kb"
    return {
        "rewritten_query": data.get("rewritten") or query,
        "entities": {
            "persons": data.get("persons") or [],
            "organizations": data.get("organizations") or [],
            "events": data.get("events") or [],
            "timeframe": data.get("timeframe") or "",
            "era": data.get("era") or "",
        },
        "route": route,
    }


def route_decision(state: RagState) -> list[str]:
    route = (state.get("route") or "kb").lower()
    if route == "kb":
        return ["kb_retriever"]
    if route == "web":
        return ["web_searcher"]
    if route == "hybrid":
        return ["kb_retriever", "web_searcher"]
    return ["kb_retriever"]


async def kb_retriever(state: RagState, *, session: AsyncSession) -> dict[str, Any]:
    rewritten = state.get("rewritten_query") or state["query"]
    entities = state.get("entities") or {}
    era = entities.get("era")
    extra_filter: str | None = None
    if era:
        extra_filter = f'era == "{era}"'
    thread_id = state.get("thread_id")
    passages = await retrieve(
        session,
        rewritten,
        extra_filter=extra_filter,
        thread_id=thread_id,
    )
    return {"kb_passages": [p.__dict__ for p in passages]}


async def web_searcher(state: RagState) -> dict[str, Any]:
    """Run a web search via Chat Completions with enable_search=True."""
    query = state.get("rewritten_query") or state["query"]
    cache_key = f"search:{hashlib.sha256(query.encode()).hexdigest()}"
    cached = await cache_get_json(cache_key)
    if isinstance(cached, dict) and cached.get("web_summary") is not None:
        return {
            "web_summary": cached.get("web_summary", ""),
            "web_results": cached.get("web_results") or [],
        }

    messages = [
        {
            "role": "system",
            "content": (
                "你是党史问答系统的联网搜索助手。请检索最相关的中文权威来源，"
                "整理为简明摘要，并保留来源列表。回答简短即可，重点是返回搜索结果元数据。"
            ),
        },
        {"role": "user", "content": query},
    ]
    summary_parts: list[str] = []
    web_results: list[WebHit] = []

    async for chunk in dashscope_client.chat_stream(
        messages=messages,
        enable_search=True,
        search_strategy="agent_max",
        forced_search=True,
        extra_body={"enable_source": True},
        temperature=0.3,
    ):
        ctype = chunk.get("type")
        if ctype == "delta":
            summary_parts.append(chunk.get("content", ""))
        elif ctype == "search_info":
            data = chunk.get("data") or {}
            for r in data.get("search_results") or []:
                web_results.append(
                    WebHit(
                        title=str(r.get("title", "")),
                        url=str(r.get("url", "")),
                        snippet=str(r.get("snippet", "")),
                        icon=str(r.get("icon", "")),
                        site_name=str(r.get("site_name", "")),
                    )
                )
        elif ctype == "done":
            break

    payload = {
        "web_summary": "".join(summary_parts).strip(),
        "web_results": [dict(h) for h in web_results],
    }
    await cache_set_json(cache_key, payload, ttl_seconds=24 * 3600)
    return {"web_summary": payload["web_summary"], "web_results": web_results}


def evidence_merger(state: RagState) -> dict[str, Any]:
    """Build the unified citation list combining KB passages and web hits."""
    citations: list[dict[str, Any]] = []
    ordinal = 1

    for raw in state.get("kb_passages") or []:
        p = RetrievedPassage(**raw)
        citations.append({**p.to_citation(ordinal), "source_type": "kb"})
        ordinal += 1

    for hit in state.get("web_results") or []:
        citations.append(
            {
                "ordinal": ordinal,
                "id": f"w-{ordinal}",
                "title": hit.get("title", ""),
                "snippet": hit.get("snippet", ""),
                "highlight_text": hit.get("snippet", ""),
                "source_type": "web",
                "url": hit.get("url", ""),
                "icon": hit.get("icon", ""),
                "site_name": hit.get("site_name", ""),
            }
        )
        ordinal += 1
    return {"citations": citations}


def _build_evidence_prompt(citations: list[dict[str, Any]]) -> str:
    if not citations:
        return "（无可用证据，请如实告知用户）"
    blocks = []
    for c in citations:
        head = f"[{c['ordinal']}] id={c['id']} ({c['source_type']})"
        if c.get("title"):
            head += f" title=《{c['title']}》"
        if c.get("heading_path"):
            head += f" path={c['heading_path']}"
        if c.get("era"):
            head += f" era={c['era']}"
        body = c.get("parent_text") or c.get("highlight_text") or c.get("snippet", "")
        if c.get("url"):
            body += f"\n来源链接: {c['url']}"
        blocks.append(f"{head}\n{body}")
    return "\n\n".join(blocks)


async def generator_stream(
    state: RagState,
    *,
    thread_id: str,
    message_id: str,
) -> AsyncIterator[dict[str, Any]]:
    """Stream the final answer; yields control events suitable for SSE.

    Events:
        {"type": "citations_ready", "items": [...]}
        {"type": "token", "content": "..."}
        {"type": "reasoning", "content": "..."}
        {"type": "done"}
    """
    citations = state.get("citations") or []
    yield {"type": "citations_ready", "items": citations}

    system_prompt = ANSWER_SYSTEM_TEMPLATE.format(
        persona=SYSTEM_PERSONA, thread_id=thread_id, message_id=message_id
    )
    evidence = _build_evidence_prompt(citations)

    user_payload = (
        f"# 用户问题\n{state['query']}\n\n"
        f"# 改写后的检索 query\n{state.get('rewritten_query') or state['query']}\n\n"
        f"# 证据列表\n{evidence}\n\n"
        "请基于以上证据，使用中文撰写答案，并按规则插入引用链接。"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        *(state.get("history") or [])[-4:],
        {"role": "user", "content": user_payload},
    ]

    try:
        async for chunk in dashscope_client.chat_stream(messages=messages, temperature=0.4):
            ctype = chunk.get("type")
            if ctype == "delta":
                yield {"type": "token", "content": chunk["content"]}
            elif ctype == "reasoning":
                yield {"type": "reasoning", "content": chunk["content"]}
            elif ctype == "done":
                yield {"type": "done", "finish_reason": chunk.get("finish_reason", "stop")}
                break
    except Exception as e:
        logger.exception("generator_stream failed: {}", e)
        yield {"type": "error", "message": str(e)}
