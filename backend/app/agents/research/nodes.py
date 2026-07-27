"""深度研究节点：基于 DashScope Responses API（web_search + web_extractor）。"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any, AsyncIterator

from loguru import logger

from app.agents.research.prompts import (
    INTERIM_SUMMARY_SYSTEM,
    PLANNER_SYSTEM,
    REFLECTOR_SYSTEM,
    WRITER_SYSTEM,
)
from app.agents.research.state import ResearchEvidence, ResearchState
from app.agents.research.artifact_parser import ArtifactFenceParser
from app.core.config import settings
from app.llm.dashscope import dashscope_client


_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json(text: str) -> dict[str, Any]:
    if not text:
        return {}
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).rstrip("`").strip()
    try:
        return json.loads(text)
    except Exception:
        m = _JSON_RE.search(text)
        if not m:
            return {}
        try:
            return json.loads(m.group(0))
        except Exception:
            return {}


async def planner(state: ResearchState) -> dict[str, Any]:
    """将用户问题分解为 sub_questions 与 plan_summary（JSON）。"""
    messages: list[dict[str, Any]] = [{"role": "system", "content": PLANNER_SYSTEM}]
    for sm in state.get("system_messages") or []:
        if isinstance(sm, dict) and sm.get("content"):
            messages.append({"role": "system", "content": sm["content"]})
    for h in (state.get("history") or [])[-6:]:
        if h.get("role") in {"user", "assistant"} and h.get("content"):
            messages.append({"role": h["role"], "content": str(h["content"])[:1200]})
    # 会话/知识库预检索摘要，帮助规划围绕已有材料
    local_bits: list[str] = []
    for p in (state.get("session_passages") or [])[:5]:
        local_bits.append(f"[会话附件] {p.get('document_title') or ''}: {(p.get('snippet') or '')[:200]}")
    for p in (state.get("kb_passages") or [])[:5]:
        local_bits.append(f"[知识库] {p.get('document_title') or ''}: {(p.get('snippet') or '')[:200]}")
    user_content = state["query"]
    if local_bits:
        user_content += "\n\n已召回的本地材料摘要：\n" + "\n".join(local_bits)
    messages.append({"role": "user", "content": user_content})
    resp = await dashscope_client.chat(
        messages=messages,
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    content = resp["choices"][0]["message"].get("content", "{}")
    data = _parse_json(content)
    plan_summary = data.get("plan_summary") or "已分解为多个子问题"
    subs = [s.strip() for s in (data.get("sub_questions") or []) if isinstance(s, str) and s.strip()]
    if not subs:
        raise ValueError("planner returned no sub_questions")
    cap = settings.research_parallel_subqueries * 2
    subs = subs[:cap]
    return {"sub_questions": subs, "plan_summary": plan_summary}


async def _run_subquery(sub_question: str, iteration: int) -> tuple[list[ResearchEvidence], list[dict[str, Any]]]:
    """对单个子问题调用 Responses API 搜索并抽取网页正文。

    返回:
        (evidence_list, raw_search_hits)
    """
    evidence: list[ResearchEvidence] = []
    search_hits: list[dict[str, Any]] = []
    extracted_count = 0

    try:
        async for event in dashscope_client.responses_stream(
            input_text=sub_question,
            tools=[{"type": "web_search"}, {"type": "web_extractor"}],
            enable_thinking=True,
            extra_body={"top_p": 0.9},
        ):
            etype = event.get("type", "")
            if etype == "error":
                raise RuntimeError(str(event.get("message") or event.get("code") or "Responses API error"))
            if etype.endswith("web_search_call.completed") or "search" in etype.lower():
                # DashScope returns the search results in event["results"] or event["output"]
                results = event.get("results") or event.get("output") or []
                if isinstance(results, dict):
                    results = results.get("results") or results.get("items") or []
                for r in results or []:
                    if isinstance(r, dict):
                        search_hits.append(
                            {
                                "title": r.get("title", ""),
                                "url": r.get("url", ""),
                                "snippet": r.get("snippet", ""),
                                "site_name": r.get("site_name", ""),
                            }
                        )
            elif etype.endswith("web_extractor_call.completed") or "extractor" in etype.lower():
                output = event.get("output") or event.get("content") or ""
                if isinstance(output, list):
                    output = "\n".join(
                        str(o.get("text") if isinstance(o, dict) else o) for o in output
                    )
                url = event.get("url") or (event.get("goal") or {}).get("url") if isinstance(event.get("goal"), dict) else event.get("url")
                title = event.get("title") or ""
                if output:
                    evidence.append(
                        ResearchEvidence(
                            sub_question=sub_question,
                            iteration=iteration,
                            url=str(url or ""),
                            title=str(title or ""),
                            snippet=str(output)[:600],
                            content=str(output),
                            site_name=str(event.get("site_name", "")),
                        )
                    )
                    extracted_count += 1
                    if extracted_count >= settings.research_per_subquery_extracts:
                        # Soft cap; allow remaining events but stop accepting extra extracts
                        pass
            elif etype.endswith("response.completed") or etype == "response.completed":
                break
    except Exception:
        logger.warning("Responses API sub-query failed; falling back to chat search (q={!r})", sub_question)
        return await _run_subquery_with_chat_search(sub_question, iteration)

    return evidence, search_hits


async def _run_subquery_with_chat_search(
    sub_question: str, iteration: int
) -> tuple[list[ResearchEvidence], list[dict[str, Any]]]:
    """Fallback research search via DashScope Chat Completions enable_search."""
    messages = [
        {
            "role": "system",
            "content": (
                "你是党史深度研究检索助手。请联网搜索权威中文来源，"
                "提炼与问题直接相关的材料，并保留来源元数据。"
            ),
        },
        {"role": "user", "content": sub_question},
    ]
    summary_parts: list[str] = []
    search_hits: list[dict[str, Any]] = []

    async for chunk in dashscope_client.chat_stream(
        messages=messages,
        enable_search=True,
        search_strategy="agent_max",
        forced_search=True,
        extra_body={"enable_source": True},
        temperature=0.2,
    ):
        ctype = chunk.get("type")
        if ctype == "delta":
            summary_parts.append(chunk.get("content", ""))
        elif ctype == "search_info":
            data = chunk.get("data") or {}
            for raw in data.get("search_results") or []:
                if isinstance(raw, dict):
                    search_hits.append(
                        {
                            "title": raw.get("title", ""),
                            "url": raw.get("url", ""),
                            "snippet": raw.get("snippet", ""),
                            "site_name": raw.get("site_name", ""),
                        }
                    )
        elif ctype == "done":
            break

    summary = "".join(summary_parts).strip()
    evidence: list[ResearchEvidence] = []
    for hit in search_hits[: settings.research_per_subquery_extracts]:
        snippet = str(hit.get("snippet") or summary)[:600]
        content = "\n\n".join(part for part in [snippet, summary] if part)
        evidence.append(
            ResearchEvidence(
                sub_question=sub_question,
                iteration=iteration,
                url=str(hit.get("url") or ""),
                title=str(hit.get("title") or hit.get("site_name") or "联网搜索结果"),
                snippet=snippet,
                content=content,
                site_name=str(hit.get("site_name") or ""),
            )
        )

    if not evidence and summary:
        evidence.append(
            ResearchEvidence(
                sub_question=sub_question,
                iteration=iteration,
                url="",
                title="联网搜索摘要",
                snippet=summary[:600],
                content=summary,
                site_name="DashScope",
            )
        )

    return evidence, search_hits


async def parallel_searcher(
    state: ResearchState,
    *,
    questions: list[str],
    iteration: int,
    emit: callable,  # type: ignore
) -> dict[str, Any]:
    """并发执行多个子问题检索，受 research_parallel_subqueries 信号量限制。"""
    sem = asyncio.Semaphore(max(1, settings.research_parallel_subqueries))

    async def _one(q: str):
        async with sem:
            await emit({"type": "research_step", "step": "searching", "iteration": iteration, "query": q})
            ev, hits = await _run_subquery(q, iteration)
            await emit(
                {
                    "type": "research_step",
                    "step": "search_completed",
                    "iteration": iteration,
                    "query": q,
                    "sources": len(hits),
                    "extracts": len(ev),
                }
            )
            for e in ev:
                await emit(
                    {
                        "type": "research_step",
                        "step": "extracted",
                        "iteration": iteration,
                        "url": e.get("url", ""),
                        "title": e.get("title", ""),
                        "snippet": e.get("snippet", "")[:200],
                    }
                )
            return ev

    results = await asyncio.gather(*[_one(q) for q in questions])
    merged: list[ResearchEvidence] = []
    for r in results:
        merged.extend(r)
    return {"new_evidence": merged}


async def reflector(state: ResearchState) -> dict[str, Any]:
    """根据已收集证据判断 need_more 与 follow_ups，驱动下一轮 search。"""
    evidence_summary = "\n".join(
        f"- ({e.get('iteration')}) [{e.get('title') or e.get('url','')}] {e.get('snippet','')[:160]}"
        for e in (state.get("evidence") or [])[:40]
    )
    local_items = list(state.get("session_passages") or []) + list(state.get("kb_passages") or [])
    local_summary = "\n".join(
        f"- [{p.get('source')}] {p.get('document_title')}: {(p.get('snippet') or '')[:120]}"
        for p in local_items[:12]
    )
    user_payload = (
        f"原始问题：{state['query']}\n\n"
        f"已研究的子问题：\n- " + "\n- ".join(state.get("sub_questions") or []) + "\n\n"
        f"本地材料（会话附件/知识库）：\n{local_summary or '（无）'}\n\n"
        f"已收集联网证据（截断）：\n{evidence_summary}\n"
    )
    history_bits = []
    for h in (state.get("history") or [])[-4:]:
        if h.get("content"):
            history_bits.append(f"{h.get('role')}: {str(h['content'])[:400]}")
    if history_bits:
        user_payload += "\n近期对话：\n" + "\n".join(history_bits)

    messages: list[dict[str, Any]] = [{"role": "system", "content": REFLECTOR_SYSTEM}]
    for sm in state.get("system_messages") or []:
        if isinstance(sm, dict) and sm.get("content"):
            messages.append({"role": "system", "content": str(sm["content"])[:2000]})
    messages.append({"role": "user", "content": user_payload})
    resp = await dashscope_client.chat(
        messages=messages,
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    content = resp["choices"][0]["message"].get("content", "{}")
    data = _parse_json(content)
    if not data:
        raise ValueError("reflector returned empty or invalid JSON")
    return {
        "need_more": bool(data.get("need_more")),
        "gaps": list(data.get("gaps") or []),
        "follow_ups": [s for s in (data.get("follow_ups") or []) if isinstance(s, str) and s.strip()],
    }


def build_citations(
    evidence: list[ResearchEvidence],
    *,
    session_passages: list[dict[str, Any]] | None = None,
    kb_passages: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """合并本地段落与联网 evidence 为前端 citation 结构。"""
    citations: list[dict[str, Any]] = []
    ordinal = 1

    for raw in session_passages or []:
        citations.append(
            {
                "ordinal": ordinal,
                "id": f"s-{ordinal}",
                "title": raw.get("document_title") or "会话附件",
                "snippet": raw.get("snippet") or "",
                "highlight_text": raw.get("snippet") or "",
                "content": raw.get("parent_text") or raw.get("snippet") or "",
                "heading_path": raw.get("heading_path") or "",
                "source_type": "session",
                "doc_id": raw.get("doc_id") or "",
            }
        )
        ordinal += 1

    for raw in kb_passages or []:
        citations.append(
            {
                "ordinal": ordinal,
                "id": f"k-{ordinal}",
                "title": raw.get("document_title") or "知识库",
                "snippet": raw.get("snippet") or "",
                "highlight_text": raw.get("snippet") or "",
                "content": raw.get("parent_text") or raw.get("snippet") or "",
                "heading_path": raw.get("heading_path") or "",
                "source_type": "kb",
                "doc_id": raw.get("doc_id") or "",
                "relative_path": raw.get("relative_path") or "",
            }
        )
        ordinal += 1

    seen_urls: dict[str, int] = {}
    for e in evidence:
        url = e.get("url", "") or ""
        if not url and not e.get("title"):
            continue
        if url and url in seen_urls:
            continue
        citations.append(
            {
                "ordinal": ordinal,
                "id": f"r-{ordinal}",
                "title": e.get("title", "") or e.get("site_name", "网络来源"),
                "snippet": e.get("snippet", ""),
                "highlight_text": e.get("snippet", ""),
                "content": e.get("content", ""),
                "url": url,
                "site_name": e.get("site_name", ""),
                "source_type": "web",
                "iteration": e.get("iteration", 0),
                "sub_question": e.get("sub_question", ""),
            }
        )
        if url:
            seen_urls[url] = ordinal
        ordinal += 1
    return citations


async def writer_stream(
    state: ResearchState,
    *,
    thread_id: str,
    message_id: str,
) -> AsyncIterator[dict[str, Any]]:
    """流式撰写研究报告；SSE 事件：token、reasoning、done。"""
    citations = state.get("citations") or []
    system_prompt = WRITER_SYSTEM.format(thread_id=thread_id, message_id=message_id)

    evidence_block_parts: list[str] = []
    for c in citations:
        header = f"[{c['ordinal']}] id={c['id']} type={c.get('source_type')} title=《{c.get('title','')}》"
        if c.get("url"):
            header += f" url={c['url']}"
        body = c.get("content") or c.get("snippet") or ""
        # Cap per-source body so writer latency stays bounded.
        if len(body) > 2500:
            body = body[:2500] + "…"
        evidence_block_parts.append(
            f"{header}\n引用标签用 ({c['ordinal']})，链接 id 用 {c['id']}\n{body}"
        )
    evidence_block = "\n\n".join(evidence_block_parts) or "（无可用证据）"

    user_payload = (
        f"# 用户研究问题\n{state['query']}\n\n"
        f"# 已研究子问题\n- " + "\n- ".join(state.get("sub_questions") or []) + "\n\n"
        f"# 证据列表\n{evidence_block}\n\n"
        "请基于以上证据撰写最终研究报告。"
    )
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for sm in state.get("system_messages") or []:
        if isinstance(sm, dict) and sm.get("content"):
            messages.append({"role": "system", "content": str(sm["content"])[:3000]})
    for h in (state.get("history") or [])[-4:]:
        if h.get("role") in {"user", "assistant"} and h.get("content"):
            messages.append({"role": h["role"], "content": str(h["content"])[:1500]})
    messages.append({"role": "user", "content": user_payload})
    parser = ArtifactFenceParser()
    async for chunk in dashscope_client.chat_stream(
        messages=messages,
        model=settings.research_model,
        temperature=0.45,
        extra_body={"enable_thinking": True},
    ):
        ctype = chunk.get("type")
        if ctype == "delta":
            content = chunk["content"]
            yield {"type": "token", "content": content}
            for ev in parser.feed(content):
                yield ev
        elif ctype == "reasoning":
            yield {"type": "reasoning", "content": chunk["content"]}
        elif ctype == "done":
            for ev in parser.flush():
                yield ev
            yield {"type": "done", "finish_reason": chunk.get("finish_reason", "stop")}
            break


def format_plan_outline(state: ResearchState) -> str:
    """规划完成后立即输出提纲（无 LLM），让用户立刻看到正文。"""
    query = (state.get("query") or "").strip()
    summary = (state.get("plan_summary") or "").strip()
    subs = [str(s).strip() for s in (state.get("sub_questions") or []) if str(s).strip()]
    lines = [
        "## 研究提纲",
        "",
        f"**研究问题**：{query}" if query else "**研究问题**：",
        "",
    ]
    if summary:
        lines.extend([summary, ""])
    if subs:
        lines.append("### 拟调研子问题")
        for i, q in enumerate(subs, start=1):
            lines.append(f"{i}. {q}")
        lines.append("")
    lines.append("> 正在检索与核实证据，稍后给出阶段性摘要与完整报告…")
    lines.append("")
    return "\n".join(lines)


def _evidence_brief_for_interim(state: ResearchState, *, limit: int = 12) -> str:
    evidence = state.get("evidence") or []
    session_passages = state.get("session_passages") or []
    kb_passages = state.get("kb_passages") or []
    parts: list[str] = []
    for i, p in enumerate(session_passages[:4], start=1):
        title = p.get("title") or p.get("filename") or "会话附件"
        snip = (p.get("text") or p.get("content") or "")[:220]
        parts.append(f"[会话{i}] 《{title}》 {snip}")
    for i, p in enumerate(kb_passages[:4], start=1):
        title = p.get("title") or "知识库"
        snip = (p.get("text") or p.get("content") or "")[:220]
        parts.append(f"[库{i}] 《{title}》 {snip}")
    for i, ev in enumerate(evidence[:limit], start=1):
        title = ev.get("title") or ev.get("url") or f"证据{i}"
        snip = (ev.get("snippet") or ev.get("content") or "")[:280]
        parts.append(f"[网{i}] 《{title}》 {snip}")
    return "\n".join(parts) or "（暂无证据摘要）"


async def interim_summary_stream(state: ResearchState) -> AsyncIterator[dict[str, Any]]:
    """首轮检索后用 flash 快速写阶段性摘要（无 thinking），改善出字体感。"""
    brief = _evidence_brief_for_interim(state)
    messages = [
        {"role": "system", "content": INTERIM_SUMMARY_SYSTEM},
        {
            "role": "user",
            "content": (
                f"# 研究问题\n{state.get('query') or ''}\n\n"
                f"# 当前证据摘要\n{brief}\n\n"
                "请输出阶段性摘要。"
            ),
        },
    ]
    try:
        async for chunk in dashscope_client.chat_stream(
            messages=messages,
            model=settings.chat_model,
            temperature=0.3,
            extra_body={"enable_thinking": False},
        ):
            ctype = chunk.get("type")
            if ctype == "delta":
                yield {"type": "token", "content": chunk["content"]}
            elif ctype == "done":
                break
    except Exception as e:
        logger.warning("interim_summary_stream failed: {}", e)
        yield {
            "type": "token",
            "content": (
                "\n## 阶段性摘要\n\n"
                "首轮检索已完成，正在继续核实与补充证据；完整报告将在检索结束后给出。\n"
            ),
        }
    yield {"type": "token", "content": "\n\n"}
