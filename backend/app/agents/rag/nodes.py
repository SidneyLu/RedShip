"""Pipeline RAG 图节点：分析、本地检索、门控联网、抽取、合并证据、流式生成。

流程（本地优先）：
  query_analyzer → kb_retriever（route≠web）→ maybe_web
    → [web_searcher → web_extractor] 或跳过 → evidence_merger → generator_stream
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, AsyncIterator

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.rag.prompts import (
    ANSWER_SYSTEM_TEMPLATE,
    QUERY_ANALYZER_SYSTEM,
    SYSTEM_PERSONA,
)
from app.agents.rag.state import RagState, WebHit
from app.core.config import settings
from app.core.redis import cache_get_json, cache_set_json
from app.db.models import SessionFile
from app.knowledge.contracts import IMAGE_EXTENSIONS
from app.knowledge.retriever import RetrievedPassage, retrieve
from app.knowledge.web_extract import extract_urls
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


async def _image_query_hint(session: AsyncSession, thread_id: str | None) -> str:
    """取会话最新图片，用 VL 描述增强检索 query。"""
    if not thread_id:
        return ""
    rows = (
        await session.execute(
            select(SessionFile)
            .where(SessionFile.thread_id == thread_id)
            .order_by(SessionFile.created_at.desc())
        )
    ).scalars().all()
    for f in rows:
        name = (f.filename or "").lower()
        ext = Path(name).suffix.lower()
        if ext not in IMAGE_EXTENSIONS:
            continue
        path = f.storage_path
        if not path or not Path(path).is_file():
            continue
        try:
            desc = (await dashscope_client.describe_image(path)).strip()
            if desc:
                return f"【会话附图《{f.filename}》视觉描述】\n{desc[:1200]}"
        except Exception as e:
            logger.warning("image query rewrite failed for {}: {}", path, e)
        break
    return ""


async def query_analyzer(state: RagState, *, session: AsyncSession) -> dict[str, Any]:
    """分析用户问题并决定检索路由；会话附图时注入 VL 描述增强 rewritten。"""
    query = state["query"]
    history = state.get("history") or []
    system_messages = state.get("system_messages") or []
    messages: list[dict[str, Any]] = [{"role": "system", "content": QUERY_ANALYZER_SYSTEM}]
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
        rewritten = query
        route = "kb"
        entities = {
            "persons": [],
            "organizations": [],
            "events": [],
            "timeframe": "",
            "era": "",
        }
    else:
        route = (data.get("route") or "kb").lower()
        if route not in {"kb", "web", "hybrid"}:
            route = "kb"
        rewritten = data.get("rewritten") or query
        entities = {
            "persons": data.get("persons") or [],
            "organizations": data.get("organizations") or [],
            "events": data.get("events") or [],
            "timeframe": data.get("timeframe") or "",
            "era": data.get("era") or "",
        }

    image_hint = await _image_query_hint(session, state.get("thread_id"))
    if image_hint:
        rewritten = f"{rewritten}\n\n{image_hint}"

    return {
        "rewritten_query": rewritten,
        "entities": entities,
        "route": route,
    }


def entry_after_analyzer(state: RagState) -> str:
    """analyzer 之后：纯 web 走联网分支，其余先本地检索。"""
    if (state.get("route") or "kb").lower() == "web":
        return "web_searcher"
    return "kb_retriever"


def kb_evidence_sufficient(state: RagState) -> bool:
    """本地命中是否足以跳过联网。"""
    passages = state.get("kb_passages") or []
    if len(passages) < settings.rag_kb_min_hits:
        return False
    scores = [float(p.get("score") or 0) for p in passages]
    if not scores:
        return False
    return max(scores) >= settings.rag_kb_score_floor


def after_kb_gate(state: RagState) -> str:
    """本地检索后：hybrid 且不足 → 联网；否则直接合并。"""
    route = (state.get("route") or "kb").lower()
    if route == "hybrid" and not kb_evidence_sufficient(state):
        return "web_searcher"
    return "evidence_merger"


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


async def web_extractor_node(state: RagState) -> dict[str, Any]:
    """对联网搜索 Top-K URL 抽取正文，写回 web_results.content。"""
    results = list(state.get("web_results") or [])
    if not results:
        return {"web_results": []}

    urls = [str(h.get("url") or "") for h in results if h.get("url")]
    goal = state.get("rewritten_query") or state.get("query")
    extracts = await extract_urls(urls, goal=goal, top_k=settings.rag_web_extract_top_k)
    by_url = {e["url"]: e for e in extracts}

    enriched: list[WebHit] = []
    for hit in results:
        item = dict(hit)
        url = str(item.get("url") or "")
        # 宽松匹配：抽取结果 url 可能带规范化
        matched = by_url.get(url)
        if not matched:
            for k, v in by_url.items():
                if url and (url in k or k in url):
                    matched = v
                    break
        if matched:
            item["content"] = matched.get("content") or ""
            if matched.get("title") and not item.get("title"):
                item["title"] = matched["title"]
            if matched.get("site_name") and not item.get("site_name"):
                item["site_name"] = matched["site_name"]
        enriched.append(item)  # type: ignore[arg-type]
    return {"web_results": enriched}


def evidence_merger(state: RagState) -> dict[str, Any]:
    """合并 kb_passages 与 web_results；本地证据序号在前。"""
    citations: list[dict[str, Any]] = []
    ordinal = 1

    for raw in state.get("kb_passages") or []:
        p = RetrievedPassage(**{k: v for k, v in raw.items() if k in RetrievedPassage.__dataclass_fields__})
        src = p.source if p.source in {"session", "bibliography", "upload"} else "kb"
        cite = p.to_citation(ordinal)
        cite["source_type"] = src if src != "upload" else "kb"
        citations.append(cite)
        ordinal += 1

    for hit in state.get("web_results") or []:
        content = str(hit.get("content") or "").strip()
        snippet = str(hit.get("snippet") or "")
        citations.append(
            {
                "ordinal": ordinal,
                "id": f"w-{ordinal}",
                "title": hit.get("title", ""),
                "snippet": snippet,
                "highlight_text": snippet or content[:280],
                "content": content or None,
                "source_type": "web",
                "url": hit.get("url", ""),
                "icon": hit.get("icon", ""),
                "site_name": hit.get("site_name", ""),
                "previewable": bool(content),
                "preview_mode": "web",
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
        body = (
            c.get("content")
            or c.get("parent_text")
            or c.get("highlight_text")
            or c.get("snippet", "")
        )
        if c.get("url"):
            body += f"\n来源链接: {c['url']}"
        # Make the ordinal vs id distinction explicit for the model.
        blocks.append(
            f"{head}\n引用标签用 ({c['ordinal']})，链接 id 用 {c['id']}\n{body}"
        )
    return "\n\n".join(blocks)


async def generator_stream(
    state: RagState,
    *,
    thread_id: str,
    message_id: str,
) -> AsyncIterator[dict[str, Any]]:
    """流式生成最终答案，产出 SSE 事件。"""
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
