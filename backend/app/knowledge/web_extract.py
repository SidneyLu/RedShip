"""网页正文抽取：供 RAG / 深度研究复用（DashScope Responses web_extractor）。"""
from __future__ import annotations

import hashlib
from typing import Any

from loguru import logger

from app.core.config import settings
from app.core.redis import cache_get_json, cache_set_json
from app.llm.dashscope import dashscope_client

_EXTRACT_CACHE_TTL = 24 * 3600


def _cache_key(url: str) -> str:
    return f"webext:{hashlib.sha256(url.encode()).hexdigest()}"


async def extract_url_content(url: str, *, goal: str | None = None) -> dict[str, Any] | None:
    """抽取单个 URL 正文；命中 Redis 缓存则直接返回。

    返回: {url, title, content, site_name} 或 None。
    """
    url = (url or "").strip()
    if not url.startswith("http"):
        return None

    cached = await cache_get_json(_cache_key(url))
    if isinstance(cached, dict) and cached.get("content"):
        return cached

    prompt = (
        f"请使用 web_extractor 抽取以下网页的正文内容，保留与党史/历史研究相关的关键段落，"
        f"去掉导航与广告。目标 URL：{url}"
    )
    if goal:
        prompt += f"\n研究问题：{goal}"

    content = ""
    title = ""
    site_name = ""
    try:
        async for event in dashscope_client.responses_stream(
            input_text=prompt,
            tools=[{"type": "web_extractor"}],
            enable_thinking=False,
            extra_body={"top_p": 0.9},
        ):
            etype = str(event.get("type") or "")
            if etype == "error":
                logger.warning("web_extractor error for {}: {}", url, event.get("message"))
                break
            if etype.endswith("web_extractor_call.completed") or "extractor" in etype.lower():
                output = event.get("output") or event.get("content") or ""
                if isinstance(output, list):
                    output = "\n".join(
                        str(o.get("text") if isinstance(o, dict) else o) for o in output
                    )
                if output:
                    content = str(output).strip()
                    title = str(event.get("title") or title)
                    site_name = str(event.get("site_name") or site_name)
                    got_url = event.get("url")
                    if got_url:
                        url = str(got_url)
            elif etype.endswith("response.completed") or etype == "response.completed":
                break
    except Exception as e:
        logger.warning("extract_url_content failed for {}: {}", url, e)
        return None

    if not content:
        return None

    payload = {
        "url": url,
        "title": title,
        "content": content[:12000],
        "site_name": site_name,
    }
    await cache_set_json(_cache_key(url), payload, ttl_seconds=_EXTRACT_CACHE_TTL)
    return payload


async def extract_urls(
    urls: list[str],
    *,
    goal: str | None = None,
    top_k: int | None = None,
) -> list[dict[str, Any]]:
    """按顺序抽取最多 top_k 个 URL 的正文。"""
    limit = top_k if top_k is not None else settings.rag_web_extract_top_k
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for url in urls:
        if len(out) >= limit:
            break
        u = (url or "").strip()
        if not u or u in seen:
            continue
        seen.add(u)
        item = await extract_url_content(u, goal=goal)
        if item:
            out.append(item)
    return out
