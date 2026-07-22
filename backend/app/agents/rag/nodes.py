"""Pipeline RAG 图节点：分析、检索、合并证据、流式生成。

query_analyzer 输出 route（kb|web|hybrid）；generator_stream 产出 token/reasoning SSE。
"""
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
    """容错解析 LLM 返回的 JSON（含 markdown 代码块包裹）。"""
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
    """分析用户问题并决定检索路由。

    调用 CHAT_MODEL（默认 qwen3.5-flash），要求 JSON：rewritten、route(kb|web|hybrid)、实体字段。
    写入 rewritten_query、entities、route。
    """
    query = state["query"]
    history = state.get("history") or []
    system_messages = state.get("system_messages") or []
    messages: list[dict[str, Any]] = [{"role": "system", "content": QUERY_ANALYZER_SYSTEM}]
    # 受保护 system（摘要 / fileid / 长期记忆）单独前置，不进窗口截断
    for sm in system_messages:
        if isinstance(sm, dict) and sm.get("content"):
            messages.append({"role": "system", "content": sm["content"]})
    for h in history:
        if h.get("role") in {"user", "assistant"} and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": query})

    resp = await dashscope_client.chat(
        messages=messages,
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    content = resp["choices"][0]["message"].get("content", "{}")
    data = _safe_json_loads(content)
    if not isinstance(data, dict) or not data:
        logger.warning("query_analyzer returned invalid JSON; using default kb route")
        return {
            "rewritten_query": query,
            "entities": {
                "persons": [],
                "organizations": [],
                "events": [],
                "timeframe": "",
                "era": "",
            },
            "route": "kb",
        }
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
    """根据 route 返回要并行执行的节点名列表（供 LangGraph Send）。"""
    route = (state.get("route") or "kb").lower()
    if route == "kb":
        return ["kb_retriever"]
    if route == "web":
        return ["web_searcher"]
    if route == "hybrid":
        return ["kb_retriever", "web_searcher"]
    return ["kb_retriever"]


async def kb_retriever(state: RagState, *, session: AsyncSession) -> dict[str, Any]:
    """混合检索知识库 + 会话附件，结果写入 kb_passages。"""
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
    """Chat Completions enable_search 联网检索；结果缓存 24h。"""
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
    """合并 kb_passages 与 web_results 为统一 citations 列表（带 ordinal）。"""
    citations: list[dict[str, Any]] = []
    ordinal = 1

    for raw in state.get("kb_passages") or []:
        p = RetrievedPassage(**raw)
        # 保留 retriever 给出的 source（session vs bibliography），便于前端区分
        src = p.source if p.source in {"session", "bibliography", "upload"} else "kb"
        citations.append({**p.to_citation(ordinal), "source_type": src if src != "upload" else "kb"})
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
    """流式生成最终答案，产出 SSE 事件。

    类型：citations_ready、token、reasoning、done、error。
    引用链接格式见 prompts ANSWER_SYSTEM_TEMPLATE。
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
        *[
            {"role": "system", "content": sm["content"]}
            for sm in (state.get("system_messages") or [])
            if isinstance(sm, dict) and sm.get("content")
        ],
        *[
            {"role": h["role"], "content": h["content"]}
            for h in (state.get("history") or [])
            if h.get("role") in {"user", "assistant"} and h.get("content")
        ],
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
