"""Deep Research nodes built on top of the DashScope Responses API."""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any, AsyncIterator

from loguru import logger

from app.agents.research.prompts import PLANNER_SYSTEM, REFLECTOR_SYSTEM, WRITER_SYSTEM
from app.agents.research.state import ResearchEvidence, ResearchState
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
    messages = [
        {"role": "system", "content": PLANNER_SYSTEM},
        {"role": "user", "content": state["query"]},
    ]
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
    """Run a Responses-API web search + extractor for a single sub-question.

    Returns (evidence_list, raw_search_results).
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
        logger.exception("Responses API sub-query failed (q={!r})", sub_question)
        raise

    return evidence, search_hits


async def parallel_searcher(
    state: ResearchState,
    *,
    questions: list[str],
    iteration: int,
    emit: callable,  # type: ignore
) -> dict[str, Any]:
    """Fan out the supplied questions and gather evidence."""
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
    evidence_summary = "\n".join(
        f"- ({e.get('iteration')}) [{e.get('title') or e.get('url','')}] {e.get('snippet','')[:160]}"
        for e in (state.get("evidence") or [])[:40]
    )
    user_payload = (
        f"原始问题：{state['query']}\n\n"
        f"已研究的子问题：\n- " + "\n- ".join(state.get("sub_questions") or []) + "\n\n"
        f"已收集证据（截断）：\n{evidence_summary}\n"
    )
    resp = await dashscope_client.chat(
        messages=[
            {"role": "system", "content": REFLECTOR_SYSTEM},
            {"role": "user", "content": user_payload},
        ],
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


def build_citations(evidence: list[ResearchEvidence]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    seen_urls: dict[str, int] = {}
    ordinal = 1
    for e in evidence:
        url = e.get("url", "") or ""
        if not url and not e.get("title"):
            continue
        if url and url in seen_urls:
            continue
        cid = f"r-{ordinal}"
        citations.append(
            {
                "ordinal": ordinal,
                "id": cid,
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
    citations = state.get("citations") or []
    system_prompt = WRITER_SYSTEM.format(thread_id=thread_id, message_id=message_id)

    evidence_block_parts: list[str] = []
    for c in citations:
        header = f"[{c['ordinal']}] id={c['id']} title=《{c.get('title','')}》"
        if c.get("url"):
            header += f" url={c['url']}"
        body = c.get("content") or c.get("snippet") or ""
        evidence_block_parts.append(f"{header}\n{body}")
    evidence_block = "\n\n".join(evidence_block_parts) or "（无可用证据）"

    user_payload = (
        f"# 用户研究问题\n{state['query']}\n\n"
        f"# 已研究子问题\n- " + "\n- ".join(state.get("sub_questions") or []) + "\n\n"
        f"# 证据列表\n{evidence_block}\n\n"
        "请基于以上证据撰写最终研究报告。"
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_payload},
    ]
    async for chunk in dashscope_client.chat_stream(
        messages=messages,
        model=settings.research_model,
        temperature=0.45,
        extra_body={"enable_thinking": True},
    ):
        ctype = chunk.get("type")
        if ctype == "delta":
            yield {"type": "token", "content": chunk["content"]}
        elif ctype == "reasoning":
            yield {"type": "reasoning", "content": chunk["content"]}
        elif ctype == "done":
            yield {"type": "done", "finish_reason": chunk.get("finish_reason", "stop")}
            break
