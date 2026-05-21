"""轻量审计日志：管理员操作、文献同步等写入 audit_logs 表。"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLog


async def write_audit(
    session: AsyncSession,
    *,
    user_id: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """追加一条审计记录（调用方负责 commit）。

    参数:
        session: 当前数据库会话。
        user_id: 操作者 UUID，系统任务可为 None。
        action: 动作标识，如 bibliography_sync、document_upload。
        target_type: 目标类型，如 document、user。
        target_id: 目标主键。
        details: 任意 JSON 详情（扫描统计、错误信息等）。
    """
    session.add(
        AuditLog(
            user_id=user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details,
        )
    )
