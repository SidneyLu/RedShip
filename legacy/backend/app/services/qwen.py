from __future__ import annotations

import base64
import json
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.core.config import get_settings
from app.db.schemas import Citation, VisualizationSpec


@dataclass
class QwenResult:
    answer: str
    visualization: dict[str, Any] | None
    model: str | None
    modalities_used: list[str]


def build_context(citations: list[Citation]) -> str:
    if not citations:
        return '无可用引用证据。'
    lines = [f"- [{item.source_domain}] {item.title} ({item.location or '位置未知'})" for item in citations]
    return '\n'.join(lines)


def _default_visualization(question: str, citations: list[Citation]) -> dict[str, Any]:
    if citations:
        counts: dict[str, int] = {}
        for item in citations:
            counts[item.source_domain] = counts.get(item.source_domain, 0) + 1
        data = [{'source': key, 'count': value} for key, value in counts.items()]
        chart = {
            'type': 'bar',
            'title': '证据来源分布',
            'x_key': 'source',
            'y_key': 'count',
            'series_key': None,
        }
        insights = ['引用来源越多，通常意味着证据覆盖更广。']
    else:
        data = [{'step': 'query', 'score': 1}]
        chart = {
            'type': 'line',
            'title': f'问题分析趋势（{question[:20]}）',
            'x_key': 'step',
            'y_key': 'score',
            'series_key': None,
        }
        insights = ['当前没有引用证据，建议先开启检索或补充上传文档。']
    return {
        'engine': 'd3',
        'spec_version': 'v1',
        'chart': chart,
        'data': data,
        'insights': insights,
    }


def _json_from_content(raw: str) -> dict[str, Any] | None:
    text = raw.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    start = text.find('{')
    end = text.rfind('}')
    if start >= 0 and end > start:
        try:
            parsed = json.loads(text[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


def _image_data_url(path: str) -> str | None:
    source = Path(path)
    if not source.exists():
        return None
    data = source.read_bytes()
    mime = mimetypes.guess_type(source.name)[0] or 'application/octet-stream'
    encoded = base64.b64encode(data).decode('ascii')
    return f'data:{mime};base64,{encoded}'


def _pdf_page_to_data_url(path: str, page: int | None = None) -> str | None:
    # Optional dependency. If unavailable we return None and keep text fallback.
    try:
        import fitz  # type: ignore
    except Exception:
        return None

    source = Path(path)
    if not source.exists():
        return None

    page_index = max(0, (page or 1) - 1)
    with fitz.open(source) as doc:  # type: ignore[attr-defined]
        if page_index >= len(doc):
            page_index = 0
        pix = doc[page_index].get_pixmap(matrix=fitz.Matrix(2, 2))
        png = pix.tobytes('png')
    encoded = base64.b64encode(png).decode('ascii')
    return f'data:image/png;base64,{encoded}'


def _build_user_prompt(
    message: str,
    citations: list[Citation],
    deep_research: bool,
) -> str:
    prompt = [
        f'用户问题：{message}',
        f'可用证据：\n{build_context(citations)}',
        '请严格返回 JSON 对象，字段为 answer 和 visualization。',
        'visualization 必须包含 engine/spec_version/chart/data/insights，且 engine=d3，spec_version=v1。',
    ]
    if deep_research:
        prompt.append('回答需包含研究路径、证据权衡和结论。')
    return '\n'.join(prompt)


def ask_qwen(
    message: str,
    citations: list[Citation],
    deep_research: bool = False,
    history: list[dict[str, str]] | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> QwenResult | None:
    settings = get_settings()
    if not settings.dashscope_api_key:
        return None

    attachments = attachments or []
    has_attachments = len(attachments) > 0
    model = settings.qwen_vision_model if has_attachments else settings.qwen_text_model
    modalities = ['text']

    system_prompt = (
        '你是日新册党史研究智能体。'
        '输出必须是 JSON 对象，不要输出 markdown。'
        'answer 字段为中文回答，visualization 字段为可渲染的 D3 结构化图表协议。'
    )
    user_prompt = _build_user_prompt(message, citations, deep_research)

    history_messages: list[dict[str, Any]] = []
    if history:
        for item in history[-10:]:
            role = item.get('role')
            content = (item.get('content') or '').strip()
            if role not in {'user', 'assistant'} or not content:
                continue
            history_messages.append({'role': role, 'content': content[:8000]})

    user_content: str | list[dict[str, Any]]
    if has_attachments:
        chunks: list[dict[str, Any]] = [{'type': 'text', 'text': user_prompt}]
        for attachment in attachments:
            media_type = attachment.get('media_type')
            if media_type in {'image', 'pdf_page'}:
                modalities.append(str(media_type))
            if media_type == 'image':
                data_url = _image_data_url(str(attachment.get('storage_path', '')))
            elif media_type == 'pdf_page':
                data_url = _pdf_page_to_data_url(
                    str(attachment.get('storage_path', '')),
                    int(attachment.get('page') or 1),
                )
            else:
                data_url = None
            if data_url:
                chunks.append({'type': 'image_url', 'image_url': {'url': data_url}})
        user_content = chunks
    else:
        user_content = user_prompt

    payload = {
        'model': model,
        'messages': [{'role': 'system', 'content': system_prompt}, *history_messages, {'role': 'user', 'content': user_content}],
        'temperature': 0.2,
    }

    try:
        with httpx.Client(timeout=35) as client:
            res = client.post(
                'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                headers={'Authorization': f'Bearer {settings.dashscope_api_key}'},
                json=payload,
            )
            res.raise_for_status()
            data = res.json()
            raw_content = data['choices'][0]['message']['content']
            parsed = _json_from_content(raw_content if isinstance(raw_content, str) else json.dumps(raw_content))
            if not parsed:
                return QwenResult(
                    answer=str(raw_content),
                    visualization=_default_visualization(message, citations),
                    model=model,
                    modalities_used=sorted(set(modalities)),
                )

            answer = str(parsed.get('answer') or '').strip()
            visualization_raw = parsed.get('visualization')
            visualization: dict[str, Any] | None = None
            if isinstance(visualization_raw, dict):
                try:
                    visualization = VisualizationSpec.model_validate(visualization_raw).model_dump()
                except Exception:
                    visualization = _default_visualization(message, citations)
            else:
                visualization = _default_visualization(message, citations)

            if not answer:
                answer = '模型未返回 answer 字段，已使用默认应答。'

            return QwenResult(
                answer=answer,
                visualization=visualization,
                model=model,
                modalities_used=sorted(set(modalities)),
            )
    except Exception as exc:
        print(f'[WARN] Qwen request failed: {exc}')
        return None
