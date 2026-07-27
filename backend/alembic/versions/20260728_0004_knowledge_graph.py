"""Add kg_entities and kg_edges tables for knowledge graph."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260728_0004_knowledge_graph"
down_revision = "20260727_0003_message_artifacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kg_entities",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("canonical_key", sa.String(length=640), nullable=False),
        sa.Column("doc_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("extra_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_kg_entities_type", "kg_entities", ["type"])
    op.create_index("ix_kg_entities_canonical_key", "kg_entities", ["canonical_key"], unique=True)

    op.create_table(
        "kg_edges",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True, nullable=False),
        sa.Column("src_entity_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("kg_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dst_entity_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("kg_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relation", sa.String(length=64), nullable=False),
        sa.Column("document_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=True),
        sa.Column("chunk_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("weight", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("extra_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint(
            "src_entity_id",
            "dst_entity_id",
            "relation",
            "document_id",
            name="uq_kg_edge_src_dst_rel_doc",
        ),
    )
    op.create_index("ix_kg_edges_src_entity_id", "kg_edges", ["src_entity_id"])
    op.create_index("ix_kg_edges_dst_entity_id", "kg_edges", ["dst_entity_id"])
    op.create_index("ix_kg_edges_relation", "kg_edges", ["relation"])
    op.create_index("ix_kg_edges_document_id", "kg_edges", ["document_id"])
    op.create_index("ix_kg_edges_src_dst", "kg_edges", ["src_entity_id", "dst_entity_id"])


def downgrade() -> None:
    op.drop_index("ix_kg_edges_src_dst", table_name="kg_edges")
    op.drop_index("ix_kg_edges_document_id", table_name="kg_edges")
    op.drop_index("ix_kg_edges_relation", table_name="kg_edges")
    op.drop_index("ix_kg_edges_dst_entity_id", table_name="kg_edges")
    op.drop_index("ix_kg_edges_src_entity_id", table_name="kg_edges")
    op.drop_table("kg_edges")
    op.drop_index("ix_kg_entities_canonical_key", table_name="kg_entities")
    op.drop_index("ix_kg_entities_type", table_name="kg_entities")
    op.drop_table("kg_entities")
