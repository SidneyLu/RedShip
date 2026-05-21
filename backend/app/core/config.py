"""Application settings driven by environment variables (.env)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- DashScope ---
    dashscope_api_key: str = Field(default="sk-your-dashscope-key", alias="DASHSCOPE_API_KEY")
    dashscope_base_url: str = Field(
        default="https://dashscope.aliyuncs.com/compatible-mode/v1",
        alias="DASHSCOPE_BASE_URL",
    )
    dashscope_responses_base_url: str = Field(
        default="https://dashscope.aliyuncs.com/compatible-mode/v1",
        alias="DASHSCOPE_RESPONSES_BASE_URL",
    )
    dashscope_files_base_url: str = Field(
        default="https://dashscope.aliyuncs.com/compatible-mode/v1",
        alias="DASHSCOPE_FILES_BASE_URL",
    )

    embedding_model: str = Field(default="text-embedding-v4", alias="EMBEDDING_MODEL")
    embedding_dim: int = Field(default=1024, alias="EMBEDDING_DIM")
    rerank_model: str = Field(default="qwen3-rerank", alias="RERANK_MODEL")
    chat_model: str = Field(default="qwen3.6-plus", alias="CHAT_MODEL")
    research_model: str = Field(default="qwen3.6-plus", alias="RESEARCH_MODEL")

    # --- Retrieval & research ---
    retrieval_top_k: int = Field(default=20, alias="RETRIEVAL_TOP_K")
    rerank_top_k: int = Field(default=5, alias="RERANK_TOP_K")
    research_max_iterations: int = Field(default=6, alias="RESEARCH_MAX_ITERATIONS")
    research_parallel_subqueries: int = Field(default=4, alias="RESEARCH_PARALLEL_SUBQUERIES")
    research_per_subquery_extracts: int = Field(default=3, alias="RESEARCH_PER_SUBQUERY_EXTRACTS")

    # --- Document intelligence ---
    files_api_inline_max_tokens: int = Field(default=100_000, alias="FILES_API_INLINE_MAX_TOKENS")
    files_api_inline_max_bytes: int = Field(default=8_000_000, alias="FILES_API_INLINE_MAX_BYTES")
    session_doc_chunk_prefix: str = Field(default="session_", alias="SESSION_DOC_CHUNK_PREFIX")

    # --- MinerU ---
    mineru_backend: str = Field(default="pipeline", alias="MINERU_BACKEND")
    mineru_timeout_seconds: int = Field(default=600, alias="MINERU_TIMEOUT_SECONDS")

    # --- Postgres ---
    postgres_user: str = Field(default="redship", alias="POSTGRES_USER")
    postgres_password: str = Field(default="redship", alias="POSTGRES_PASSWORD")
    postgres_db: str = Field(default="redship", alias="POSTGRES_DB")
    postgres_host: str = Field(default="postgres", alias="POSTGRES_HOST")
    postgres_port: int = Field(default=5432, alias="POSTGRES_PORT")
    database_url: str | None = Field(default=None, alias="DATABASE_URL")
    database_url_sync_env: str | None = Field(default=None, alias="DATABASE_URL_SYNC")

    # --- Redis ---
    redis_host: str = Field(default="redis", alias="REDIS_HOST")
    redis_port: int = Field(default=6379, alias="REDIS_PORT")
    redis_url: str | None = Field(default=None, alias="REDIS_URL")

    # --- Milvus ---
    milvus_host: str = Field(default="milvus", alias="MILVUS_HOST")
    milvus_port: int = Field(default=19530, alias="MILVUS_PORT")
    milvus_kb_collection: str = Field(default="knowledge_base", alias="MILVUS_KB_COLLECTION")
    milvus_session_collection: str = Field(
        default="session_chunks", alias="MILVUS_SESSION_COLLECTION"
    )

    # --- Auth ---
    jwt_secret: str = Field(default="please-change-me", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_expire_minutes: int = Field(default=1440, alias="JWT_EXPIRE_MINUTES")
    admin_bootstrap_email: str = Field(default="admin@redship.local", alias="ADMIN_BOOTSTRAP_EMAIL")
    admin_bootstrap_password: str = Field(default="ChangeMe!2026", alias="ADMIN_BOOTSTRAP_PASSWORD")

    # --- Paths ---
    bibliography_dir: str = Field(default="/bibliography", alias="BIBLIOGRAPHY_DIR")
    upload_dir: str = Field(default="/app/data/uploads", alias="UPLOAD_DIR")

    # --- Misc ---
    cors_origins: str = Field(default="*", alias="CORS_ORIGINS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    @property
    def async_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def database_url_sync(self) -> str:
        if self.database_url_sync_env:
            return self.database_url_sync_env
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def resolved_redis_url(self) -> str:
        if self.redis_url:
            return self.redis_url
        return f"redis://{self.redis_host}:{self.redis_port}/0"

    @property
    def bibliography_path(self) -> Path:
        return Path(self.bibliography_dir)

    @property
    def upload_path(self) -> Path:
        p = Path(self.upload_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
