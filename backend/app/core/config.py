"""应用配置：从环境变量 / .env 加载，供全栈服务共享。

对应 PLAN.md「核心基础层」。下游：DashScope 客户端、Postgres、Redis、Milvus、鉴权、文献路径。
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """全局配置项；字段通过 Field alias 映射 .env 中的大写变量名。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- DashScope：全部 AI 能力统一入口 ---
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

    # --- 检索与深度研究：控制召回量与反思轮次 ---
    retrieval_top_k: int = Field(default=20, alias="RETRIEVAL_TOP_K")
    rerank_top_k: int = Field(default=5, alias="RERANK_TOP_K")
    research_max_iterations: int = Field(default=6, alias="RESEARCH_MAX_ITERATIONS")
    research_parallel_subqueries: int = Field(default=4, alias="RESEARCH_PARALLEL_SUBQUERIES")
    research_per_subquery_extracts: int = Field(default=3, alias="RESEARCH_PER_SUBQUERY_EXTRACTS")

    # --- 文档智能：小文件走 Files API，大文件走会话 Milvus ---
    files_api_inline_max_tokens: int = Field(default=100_000, alias="FILES_API_INLINE_MAX_TOKENS")
    files_api_inline_max_bytes: int = Field(default=8_000_000, alias="FILES_API_INLINE_MAX_BYTES")
    session_doc_chunk_prefix: str = Field(default="session_", alias="SESSION_DOC_CHUNK_PREFIX")

    # --- MinerU：PDF/DOCX 解析，CPU pipeline 后端 ---
    mineru_backend: str = Field(default="pipeline", alias="MINERU_BACKEND")
    mineru_timeout_seconds: int = Field(default=600, alias="MINERU_TIMEOUT_SECONDS")

    # --- Postgres：元数据、对话、文献状态 ---
    postgres_user: str = Field(default="redship", alias="POSTGRES_USER")
    postgres_password: str = Field(default="redship", alias="POSTGRES_PASSWORD")
    postgres_db: str = Field(default="redship", alias="POSTGRES_DB")
    postgres_host: str = Field(default="postgres", alias="POSTGRES_HOST")
    postgres_port: int = Field(default=5432, alias="POSTGRES_PORT")
    database_url: str | None = Field(default=None, alias="DATABASE_URL")
    database_url_sync_env: str | None = Field(default=None, alias="DATABASE_URL_SYNC")

    # --- Redis：embedding 缓存、联网搜索缓存、LangGraph checkpoint ---
    redis_host: str = Field(default="redis", alias="REDIS_HOST")
    redis_port: int = Field(default=6379, alias="REDIS_PORT")
    redis_url: str | None = Field(default=None, alias="REDIS_URL")

    # --- Milvus：知识库与会话级向量集合名 ---
    milvus_host: str = Field(default="milvus", alias="MILVUS_HOST")
    milvus_port: int = Field(default=19530, alias="MILVUS_PORT")
    milvus_kb_collection: str = Field(default="knowledge_base", alias="MILVUS_KB_COLLECTION")
    milvus_session_collection: str = Field(
        default="session_chunks", alias="MILVUS_SESSION_COLLECTION"
    )

    # --- 鉴权：JWT 与首次启动的管理员账号 ---
    jwt_secret: str = Field(default="please-change-me", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_expire_minutes: int = Field(default=1440, alias="JWT_EXPIRE_MINUTES")
    admin_bootstrap_email: str = Field(default="admin@redship.local", alias="ADMIN_BOOTSTRAP_EMAIL")
    admin_bootstrap_password: str = Field(default="ChangeMe!2026", alias="ADMIN_BOOTSTRAP_PASSWORD")

    # --- 路径：容器内挂载的文献库与上传目录 ---
    bibliography_dir: str = Field(default="/bibliography", alias="BIBLIOGRAPHY_DIR")
    upload_dir: str = Field(default="/app/data/uploads", alias="UPLOAD_DIR")

    # --- 杂项 ---
    cors_origins: str = Field(default="*", alias="CORS_ORIGINS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    @property
    def async_database_url(self) -> str:
        """FastAPI / asyncpg 使用的异步连接串。"""
        if self.database_url:
            return self.database_url
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def database_url_sync(self) -> str:
        """Alembic 迁移使用的同步连接串。"""
        if self.database_url_sync_env:
            return self.database_url_sync_env
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def resolved_redis_url(self) -> str:
        """解析后的 Redis URL，未设置 REDIS_URL 时由 host:port 拼装。"""
        if self.redis_url:
            return self.redis_url
        return f"redis://{self.redis_host}:{self.redis_port}/0"

    @property
    def bibliography_path(self) -> Path:
        """文献库根目录（Docker 挂载 bibliography/）。"""
        return Path(self.bibliography_dir)

    @property
    def upload_path(self) -> Path:
        """管理员上传与会话附件的本地存储目录（自动创建）。"""
        p = Path(self.upload_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """进程内单例配置，避免重复解析 .env。"""
    return Settings()


settings = get_settings()
