from functools import lru_cache
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    app_name: str = '日新册-南开大学中国共产党党史研究智能体'
    api_prefix: str = '/api'
    backend_port: int = 8005

    secret_key: str = Field(default='change-me-in-production', min_length=16)
    access_token_expire_minutes: int = 60 * 24

    database_url: str = f"sqlite:///{(BASE_DIR / 'app.db').as_posix()}"

    upload_root: Path = BASE_DIR / 'data' / 'uploads'
    downloads_zip_path: Path = BASE_DIR.parent / 'Downloads.zip'

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str = 'noreply@rixince.ai'
    smtp_use_tls: bool = True
    mail_debug_mode: bool = True

    qdrant_url: str = 'http://qdrant:6333'
    qdrant_api_key: str | None = None
    qdrant_base_collection: str = 'base_knowledge'
    qdrant_session_prefix: str = 'session_'

    dashscope_api_key: str | None = None
    qwen_text_model: str = 'qwen-max'
    qwen_vision_model: str = 'qwen-vl-max'
    qwen_embedding_model: str = 'text-embedding-v3'

    admin_email: str | None = None
    admin_password: str | None = None
    super_admin_email: str | None = None
    super_admin_password: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
