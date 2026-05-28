from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def run_schema_migrations(engine: Engine) -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        table_names = set(inspector.get_table_names())

        if 'users' in table_names:
            user_cols = {col['name'] for col in inspector.get_columns('users')}
            if 'is_super_admin' not in user_cols:
                conn.execute(text('ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN DEFAULT 0'))
            if 'is_active' not in user_cols:
                conn.execute(text('ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1'))

        if 'upload_documents' in table_names:
            upload_cols = {col['name'] for col in inspector.get_columns('upload_documents')}
            if 'is_deleted' not in upload_cols:
                conn.execute(text('ALTER TABLE upload_documents ADD COLUMN is_deleted BOOLEAN DEFAULT 0'))
            if 'deleted_at' not in upload_cols:
                conn.execute(text('ALTER TABLE upload_documents ADD COLUMN deleted_at DATETIME'))
            if 'deleted_by' not in upload_cols:
                conn.execute(text('ALTER TABLE upload_documents ADD COLUMN deleted_by VARCHAR(36)'))

        if 'research_sessions' in table_names:
            research_cols = {col['name'] for col in inspector.get_columns('research_sessions')}
            if 'visualization' not in research_cols:
                conn.execute(text('ALTER TABLE research_sessions ADD COLUMN visualization JSON'))
            if 'meta' not in research_cols:
                conn.execute(text('ALTER TABLE research_sessions ADD COLUMN meta JSON'))
