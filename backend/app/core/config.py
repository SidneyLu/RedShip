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
    # HTTP_API_URL 对应官方 SDK 的 dashscope.base_http_api_url（原生 /api/v1）。
    # OpenAI 兼容调用用 BASE_URL（/compatible-mode/v1）；未显式设置时可从 HTTP_API_URL 推导。
    dashscope_api_key: str = Field(default="sk-your-dashscope-key", alias="DASHSCOPE_API_KEY")
    dashscope_http_api_url: str = Field(
        default="https://dashscope.aliyuncs.com/api/v1",
        alias="DASHSCOPE_HTTP_API_URL",
    )
    dashscope_base_url: str | None = Field(default=None, alias="DASHSCOPE_BASE_URL")
    dashscope_responses_base_url: str | None = Field(
        default=None, alias="DASHSCOPE_RESPONSES_BASE_URL"
    )
    dashscope_files_base_url: str | None = Field(default=None, alias="DASHSCOPE_FILES_BASE_URL")
    dashscope_rerank_url: str | None = Field(default=None, alias="DASHSCOPE_RERANK_URL")

    # --- Build：embedding（摄入写入）；Query：rerank / chat / research ---
    embedding_model: str = Field(default="text-embedding-v4", alias="EMBEDDING_MODEL")
    embedding_dim: int = Field(default=1024, alias="EMBEDDING_DIM")
    rerank_model: str = Field(default="qwen3-rerank", alias="RERANK_MODEL")
    chat_model: str = Field(default="qwen3.5-flash", alias="CHAT_MODEL")
    research_model: str = Field(default="qwen3.5-plus", alias="RESEARCH_MODEL")

    # --- Query：检索与深度研究（读路径） ---
    retrieval_top_k: int = Field(default=20, alias="RETRIEVAL_TOP_K")
    rerank_top_k: int = Field(default=5, alias="RERANK_TOP_K")
    research_max_iterations: int = Field(default=3, alias="RESEARCH_MAX_ITERATIONS")
    research_parallel_subqueries: int = Field(default=4, alias="RESEARCH_PARALLEL_SUBQUERIES")
    research_per_subquery_extracts: int = Field(default=3, alias="RESEARCH_PER_SUBQUERY_EXTRACTS")

    # --- RAG 本地优先门控 + 网页抽取（Query） ---
    rag_kb_min_hits: int = Field(default=3, alias="RAG_KB_MIN_HITS")
    rag_kb_score_floor: float = Field(default=0.35, alias="RAG_KB_SCORE_FLOOR")
    rag_web_extract_top_k: int = Field(default=3, alias="RAG_WEB_EXTRACT_TOP_K")

    # --- 文档智能：小文件走 Files API，大文件走会话 Milvus（Build+Query 会话路径） ---
    files_api_inline_max_tokens: int = Field(default=100_000, alias="FILES_API_INLINE_MAX_TOKENS")
    files_api_inline_max_bytes: int = Field(default=8_000_000, alias="FILES_API_INLINE_MAX_BYTES")
    session_doc_chunk_prefix: str = Field(default="session_", alias="SESSION_DOC_CHUNK_PREFIX")
    session_image_max_bytes: int = Field(default=10_000_000, alias="SESSION_IMAGE_MAX_BYTES")
    session_min_extract_chars: int = Field(default=200, alias="SESSION_MIN_EXTRACT_CHARS")
    bibliography_markdown_only: bool = Field(default=False, alias="BIBLIOGRAPHY_MARKDOWN_ONLY")
    bibliography_auto_sync: bool = Field(default=False, alias="BIBLIOGRAPHY_AUTO_SYNC")

    # --- Build：MinerU / VL 扫描 PDF 解析 ---
    mineru_backend: str = Field(default="pipeline", alias="MINERU_BACKEND")
    mineru_timeout_seconds: int = Field(default=600, alias="MINERU_TIMEOUT_SECONDS")
    mineru_ocr: bool = Field(default=True, alias="MINERU_OCR")
    vision_model: str = Field(default="qwen3.5-flash", alias="VISION_MODEL")  # Build
    vision_pdf_enabled: bool = Field(default=False, alias="VISION_PDF_ENABLED")
    vision_pdf_dpi: int = Field(default=144, alias="VISION_PDF_DPI")
    vision_pdf_max_pages: int = Field(default=50, alias="VISION_PDF_MAX_PAGES")
    vision_review_threshold: float = Field(default=0.6, alias="VISION_REVIEW_THRESHOLD")

    # --- 会话记忆：滑动窗口 + 滚动摘要 ---
    session_history_window: int = Field(default=8, alias="SESSION_HISTORY_WINDOW")
    session_summary_trigger: int = Field(default=12, alias="SESSION_SUMMARY_TRIGGER")
    session_summary_model: str | None = Field(default=None, alias="SESSION_SUMMARY_MODEL")

    # --- 用户长期记忆 ---
    user_memory_top_k: int = Field(default=5, alias="USER_MEMORY_TOP_K")
    user_memory_enabled: bool = Field(default=True, alias="USER_MEMORY_ENABLED")

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
    milvus_user_memory_collection: str = Field(
        default="user_memory", alias="MILVUS_USER_MEMORY_COLLECTION"
    )

    # --- 鉴权：JWT 与首次启动的管理员账号 ---
    jwt_secret: str = Field(default="please-change-me", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_expire_minutes: int = Field(default=1440, alias="JWT_EXPIRE_MINUTES")
    admin_bootstrap_email: str = Field(default="admin@redship.local", alias="ADMIN_BOOTSTRAP_EMAIL")
    admin_bootstrap_password: str = Field(default="ChangeMe!2026", alias="ADMIN_BOOTSTRAP_PASSWORD")
    # 已存在的 bootstrap 管理员是否在启动时用 .env 密码覆盖哈希（本地轮换后生效）
    admin_bootstrap_sync_password: bool = Field(default=True, alias="ADMIN_BOOTSTRAP_SYNC_PASSWORD")
    # 仅本地排障：允许占位密钥 / 默认管理员密码启动（切勿用于可访问环境）
    allow_insecure_defaults: bool = Field(default=False, alias="ALLOW_INSECURE_DEFAULTS")

    # --- 路径：容器内挂载的文献库与上传目录 ---
    bibliography_dir: str = Field(default="/bibliography", alias="BIBLIOGRAPHY_DIR")
    upload_dir: str = Field(default="/app/data/uploads", alias="UPLOAD_DIR")

    # --- 杂项 ---
    cors_origins: str = Field(default="*", alias="CORS_ORIGINS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    @staticmethod
    def _dashscope_origin(http_api_url: str) -> str:
        """从原生 /api/v1 URL 取出 origin（工作空间专用域或公网域）。"""
        raw = (http_api_url or "").strip().rstrip("/")
        if raw.endswith("/api/v1"):
            return raw[: -len("/api/v1")]
        return raw

    @property
    def resolved_dashscope_base_url(self) -> str:
        """OpenAI 兼容 chat/embeddings/files 的 base_url。"""
        if self.dashscope_base_url:
            return self.dashscope_base_url.rstrip("/")
        origin = self._dashscope_origin(self.dashscope_http_api_url)
        return f"{origin}/compatible-mode/v1"

    @property
    def resolved_dashscope_responses_base_url(self) -> str:
        if self.dashscope_responses_base_url:
            return self.dashscope_responses_base_url.rstrip("/")
        return self.resolved_dashscope_base_url

    @property
    def resolved_dashscope_files_base_url(self) -> str:
        if self.dashscope_files_base_url:
            return self.dashscope_files_base_url.rstrip("/")
        return self.resolved_dashscope_base_url

    @property
    def resolved_dashscope_rerank_url(self) -> str:
        """qwen3-rerank 的 compatible-api 端点。"""
        if self.dashscope_rerank_url:
            return self.dashscope_rerank_url.rstrip("/")
        origin = self._dashscope_origin(self.dashscope_http_api_url)
        return f"{origin}/compatible-api/v1/reranks"

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

    def insecure_default_problems(self) -> list[str]:
        """返回仍使用占位/默认凭据的配置项说明（空列表表示通过）。"""
        problems: list[str] = []
        key = (self.dashscope_api_key or "").strip()
        if not key or key in {"sk-your-dashscope-key", "changeme", "your-api-key"}:
            problems.append("DASHSCOPE_API_KEY 未设置或仍为占位值")
        secret = (self.jwt_secret or "").strip()
        weak_jwt = {
            "please-change-me",
            "please-change-me-to-a-long-random-string",
            "secret",
            "changeme",
        }
        if secret in weak_jwt or len(secret) < 32:
            problems.append("JWT_SECRET 过弱或仍为示例值（至少 32 字符随机串）")
        if (self.admin_bootstrap_password or "").strip() in {
            "ChangeMe!2026",
            "changeme",
            "password",
            "admin",
        }:
            problems.append("ADMIN_BOOTSTRAP_PASSWORD 仍为默认/弱口令")
        return problems

    def validate_security_or_raise(self) -> None:
        """生产默认：拒绝占位密钥；本地可用 ALLOW_INSECURE_DEFAULTS=true 跳过。"""
        problems = self.insecure_default_problems()
        if not problems:
            return
        if self.allow_insecure_defaults:
            return
        joined = "; ".join(problems)
        raise RuntimeError(
            f"拒绝使用不安全默认凭据启动：{joined}。"
            "请更新 .env（可参考 .local/secrets-backup/ 中的备份），"
            "或仅在本地排障时设置 ALLOW_INSECURE_DEFAULTS=true。"
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """进程内单例配置，避免重复解析 .env。"""
    return Settings()


settings = get_settings()
