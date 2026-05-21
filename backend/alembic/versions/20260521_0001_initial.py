"""RedShip 初始库表结构。

表业务含义：
- users：账号与管理员标记
- documents / knowledge_chunks：文献元数据与父块（向量在 Milvus）
- threads / messages：对话与 SSE 落库内容
- session_files：会话附件（Files API 或 session Milvus）
- audit_logs：管理操作审计

Revision ID: 0001_initial
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- 用户与鉴权 ---
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("display_name", sa.String(120), nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("is_admin", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # --- 知识库文献 ---
    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("source", sa.String(32), nullable=False, server_default="bibliography"),
        sa.Column("file_path", sa.String(1024), nullable=True),
        sa.Column("relative_path", sa.String(1024), nullable=True),
        sa.Column("file_sha256", sa.String(64), nullable=True, unique=True),
        sa.Column("mime_type", sa.String(120), nullable=True),
        sa.Column("size_bytes", sa.Integer, nullable=True),
        sa.Column("era", sa.String(64), nullable=True),
        sa.Column("series", sa.String(255), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("chunks_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("extra_metadata", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_documents_relative_path", "documents", ["relative_path"])
    op.create_index("ix_documents_file_sha256", "documents", ["file_sha256"])
    op.create_index("ix_documents_source_status", "documents", ["source", "status"])

    # --- 父块（Milvus 存子块 id 列表）---
    op.create_table(
        "knowledge_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("document_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_index", sa.Integer, nullable=False),
        sa.Column("parent_text", sa.Text, nullable=False),
        sa.Column("heading_path", sa.String(512), nullable=True),
        sa.Column("era", sa.String(64), nullable=True),
        sa.Column("child_ids", postgresql.JSONB, nullable=True),
        sa.Column("page_range", sa.String(64), nullable=True),
        sa.Column("extra_metadata", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("document_id", "parent_index", name="uq_chunk_document_parent"),
    )
    op.create_index("ix_knowledge_chunks_document_id", "knowledge_chunks", ["document_id"])

    # --- 对话 ---
    op.create_table(
        "threads",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False, server_default="新对话"),
        sa.Column("mode", sa.String(16), nullable=False, server_default="chat"),
        sa.Column("pinned", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extra_metadata", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_threads_user_id", "threads", ["user_id"])

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("thread_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False, server_default="chat"),
        sa.Column("content_markdown", sa.Text, nullable=False, server_default=""),
        sa.Column("reasoning", sa.Text, nullable=True),
        sa.Column("citations", postgresql.JSONB, nullable=True),
        sa.Column("research_events", postgresql.JSONB, nullable=True),
        sa.Column("attachments", postgresql.JSONB, nullable=True),
        sa.Column("extra_metadata", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_messages_thread_id", "messages", ["thread_id"])

    # --- 会话附件 ---
    op.create_table(
        "session_files",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("thread_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("storage_path", sa.String(1024), nullable=True),
        sa.Column("file_sha256", sa.String(64), nullable=True),
        sa.Column("size_bytes", sa.Integer, nullable=True),
        sa.Column("mime_type", sa.String(120), nullable=True),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("dashscope_file_id", sa.String(128), nullable=True),
        sa.Column("milvus_namespace", sa.String(128), nullable=True),
        sa.Column("chunks_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="ready"),
        sa.Column("extra_metadata", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_session_files_thread_id", "session_files", ["thread_id"])

    # --- 审计 ---
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target_type", sa.String(64), nullable=True),
        sa.Column("target_id", sa.String(128), nullable=True),
        sa.Column("details", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("session_files")
    op.drop_table("messages")
    op.drop_table("threads")
    op.drop_table("knowledge_chunks")
    op.drop_table("documents")
    op.drop_table("users")
