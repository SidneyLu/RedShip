"""DashScope LLM clients (embed / rerank / chat / responses / files)."""
from app.llm.dashscope import dashscope_client, get_dashscope_client

__all__ = ["dashscope_client", "get_dashscope_client"]
