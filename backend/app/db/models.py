"""RedShip 关系库 ORM 模型。

ER 概要：User 1—N Thread 1—N Message；Document 1—N KnowledgeChunk（父块，Milvus 存子块）；
Thread 1—N SessionFile（会话附件）。citations JSON 与前端 Citation 类型、引用 URL 对齐。
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base, TimestampMixin):
    """注册用户；is_admin 可触发文献同步与上传。"""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    threads: Mapped[list["Thread"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Document(Base, TimestampMixin):
    """知识库源文档：bibliography 目录或管理员 upload（不含用户会话附件）。"""

    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="bibliography")  # bibliography | upload | session
    file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    relative_path: Mapped[str | None] = mapped_column(String(1024), nullable=True, index=True)
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    era: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 历史时期 tag
    series: Mapped[str | None] = mapped_column(String(255), nullable=True)  # 丛书 / 系列
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)  # pending|parsing|indexed|failed
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    chunks_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    chunks: Mapped[list["KnowledgeChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_documents_source_status", "source", "status"),)


class KnowledgeChunk(Base, TimestampMixin):
    """父文本块；child_ids 指向 Milvus 子块，检索后用于父块回溯与引用预览。"""

    __tablename__ = "knowledge_chunks"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_index: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_text: Mapped[str] = mapped_column(Text, nullable=False)
    heading_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    era: Mapped[str | None] = mapped_column(String(64), nullable=True)
    child_ids: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    page_range: Mapped[str | None] = mapped_column(String(64), nullable=True)
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    document: Mapped[Document] = relationship(back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("document_id", "parent_index", name="uq_chunk_document_parent"),
    )


class Thread(Base, TimestampMixin):
    """对话线程；mode 为 chat（快速问答）或 research（深度研究）。"""

    __tablename__ = "threads"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="新对话")
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="chat")  # chat | research
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    user: Mapped[User] = relationship(back_populates="threads")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="thread", cascade="all, delete-orphan", order_by="Message.created_at"
    )
    session_files: Mapped[list["SessionFile"]] = relationship(
        back_populates="thread", cascade="all, delete-orphan"
    )


class Message(Base, TimestampMixin):
    """单条消息；assistant 的 citations / research_events 由 chat 流结束后持久化。"""

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    thread_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # user | assistant | system
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="chat")  # chat | research
    content_markdown: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    research_events: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    attachments: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    thread: Mapped[Thread] = relationship(back_populates="messages")


class SessionFile(Base, TimestampMixin):
    """会话附件：小文件 files_api（dashscope_file_id），大文件 session_rag（milvus_namespace）。"""

    __tablename__ = "session_files"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    thread_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)  # files_api | session_rag
    dashscope_file_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    milvus_namespace: Mapped[str | None] = mapped_column(String(128), nullable=True)
    chunks_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="ready", nullable=False)
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    thread: Mapped[Thread] = relationship(back_populates="session_files")


class UserMemory(Base, TimestampMixin):
    """用户跨会话长期记忆；向量存于 Milvus user_memory collection。"""

    __tablename__ = "user_memories"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="fact")
    source_thread_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    __table_args__ = (Index("ix_user_memories_user_created", "user_id", "created_at"),)


class AuditLog(Base):
    """只追加审计日志，无 updated_at。"""

    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
