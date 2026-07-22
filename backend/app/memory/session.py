"""会话级记忆：滑动窗口 + 滚动摘要；Files API system 消息与窗口分离。"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Message, Thread
from app.knowledge.session_docs import build_session_system_messages
from app.llm.dashscope import dashscope_client


@dataclass
class ConversationContext:
    """供 chat / research 使用的上下文包。"""

    recent_messages: list[dict[str, Any]] = field(default_factory=list)
    doc_system_messages: list[dict[str, str]] = field(default_factory=list)
    summary_system_message: dict[str, str] | None = None
    rolling_summary: str = ""

    def protected_system_messages(self) -> list[dict[str, str]]:
        """永不进入 history[-N:] 截断的 system 段。"""
        out: list[dict[str, str]] = []
        if self.summary_system_message:
            out.append(self.summary_system_message)
        out.extend(self.doc_system_messages)
        return out

    def llm_messages(
        self,
        *,
        extra_system: list[dict[str, str]] | None = None,
        include_recent: bool = True,
    ) -> list[dict[str, Any]]:
        msgs: list[dict[str, Any]] = []
        if extra_system:
            msgs.extend(extra_system)
        msgs.extend(self.protected_system_messages())
        if include_recent:
            msgs.extend(self.recent_messages)
        return msgs


async def build_conversation_context(
    session: AsyncSession,
    thread_id: str,
    *,
    exclude_last_user_query: str | None = None,
) -> ConversationContext:
    """构建会话上下文：摘要 + fileid:// + 最近 N 轮。"""
    window = max(2, settings.session_history_window)
    # 多取一点以便去掉刚写入的用户回声
    fetch_n = window + 2
    rows = await session.execute(
        select(Message)
        .where(Message.thread_id == thread_id)
        .order_by(Message.created_at.desc())
        .limit(fetch_n)
    )
    msgs = list(reversed(rows.scalars().all()))
    recent: list[dict[str, Any]] = [
        {"role": m.role, "content": m.content_markdown}
        for m in msgs
        if m.role in {"user", "assistant"} and m.content_markdown
    ]
    if (
        exclude_last_user_query
        and recent
        and recent[-1]["role"] == "user"
        and recent[-1]["content"] == exclude_last_user_query
    ):
        recent = recent[:-1]
    recent = recent[-window:]

    thread = (
        await session.execute(select(Thread).where(Thread.id == thread_id))
    ).scalar_one_or_none()
    meta = dict(thread.extra_metadata or {}) if thread else {}
    rolling = str(meta.get("rolling_summary") or "").strip()

    summary_msg: dict[str, str] | None = None
    if rolling:
        summary_msg = {
            "role": "system",
            "content": f"本会话此前对话摘要（供连贯作答，勿当作新的用户提问）：\n{rolling}",
        }

    doc_msgs = await build_session_system_messages(session, thread_id)
    return ConversationContext(
        recent_messages=recent,
        doc_system_messages=doc_msgs,
        summary_system_message=summary_msg,
        rolling_summary=rolling,
    )


async def maybe_update_rolling_summary(
    session: AsyncSession,
    thread_id: str,
) -> None:
    """消息数达到阈值时，将窗口外旧消息并入滚动摘要。"""
    trigger = max(settings.session_summary_trigger, settings.session_history_window + 2)
    total = (
        await session.execute(
            select(func.count())
            .select_from(Message)
            .where(
                Message.thread_id == thread_id,
                Message.role.in_(("user", "assistant")),
            )
        )
    ).scalar_one()
    if int(total or 0) < trigger:
        return

    window = max(2, settings.session_history_window)
    # 取窗口外的旧消息（最多 40 条）做摘要增量
    rows = await session.execute(
        select(Message)
        .where(
            Message.thread_id == thread_id,
            Message.role.in_(("user", "assistant")),
        )
        .order_by(Message.created_at.desc())
        .limit(window + 40)
    )
    all_msgs = list(reversed(rows.scalars().all()))
    if len(all_msgs) <= window:
        return
    older = all_msgs[:-window]
    thread = (
        await session.execute(select(Thread).where(Thread.id == thread_id))
    ).scalar_one_or_none()
    if not thread:
        return
    meta = dict(thread.extra_metadata or {})
    prev = str(meta.get("rolling_summary") or "").strip()
    summarized_through = meta.get("summary_through_message_id")
    to_summarize: list[Message] = []
    seen_anchor = summarized_through is None
    for m in older:
        if not seen_anchor:
            if m.id == summarized_through:
                seen_anchor = True
            continue
        to_summarize.append(m)
    if not to_summarize:
        return

    transcript = "\n".join(
        f"{m.role}: {m.content_markdown[:800]}" for m in to_summarize[-30:]
    )
    prompt = (
        "请将下列对话压缩为简洁中文摘要（保留人物、时间、事件、用户偏好与未决问题），"
        "不超过 400 字。只输出摘要正文。\n\n"
        f"已有摘要：\n{prev or '（无）'}\n\n"
        f"新增对话：\n{transcript}"
    )
    try:
        resp = await dashscope_client.chat(
            messages=[
                {"role": "system", "content": "你是会话摘要助手。"},
                {"role": "user", "content": prompt},
            ],
            model=settings.session_summary_model or settings.chat_model,
            temperature=0.2,
        )
        new_summary = (resp["choices"][0]["message"].get("content") or "").strip()
        if not new_summary:
            return
        meta["rolling_summary"] = new_summary
        meta["summary_through_message_id"] = to_summarize[-1].id
        thread.extra_metadata = meta
        await session.commit()
        logger.info("Updated rolling summary for thread {}", thread_id)
    except Exception as e:
        logger.warning("rolling summary failed for {}: {}", thread_id, e)
        await session.rollback()
