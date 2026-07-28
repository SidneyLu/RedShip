"""Map internal chat graph events → AI SDK UI Message Stream SSE lines.

Protocol: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
Header: ``x-vercel-ai-ui-message-stream: v1``
Each chunk: ``data: {json}\\n\\n``；流结束：``data: [DONE]\\n\\n``
"""
from __future__ import annotations

import json
from typing import Any


def format_sse(payload: dict[str, Any] | str) -> str:
    """Encode one SSE data line for the UI Message Stream protocol."""
    if isinstance(payload, str):
        return f"data: {payload}\n\n"
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


# Alias used by package exports / tests
encode_sse = format_sse


def ui_message_stream_headers() -> dict[str, str]:
    """Response headers required by AI SDK useChat / DefaultChatTransport."""
    return {
        "x-vercel-ai-ui-message-stream": "v1",
        # no-transform: avoid intermediary (ngrok / Next rewrite) buffering SSE
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }


def _part_text(part: Any) -> str:
    if isinstance(part, str):
        return part
    if not isinstance(part, dict):
        return ""
    if part.get("type") == "text":
        return str(part.get("text") or part.get("content") or "")
    return ""


def extract_user_query(messages: list[dict[str, Any]] | None) -> str:
    """Take plain text from the last user UIMessage (parts or content)."""
    if not messages:
        return ""
    for msg in reversed(messages):
        if not isinstance(msg, dict):
            continue
        if msg.get("role") != "user":
            continue
        parts = msg.get("parts")
        if isinstance(parts, list):
            text = "".join(_part_text(p) for p in parts).strip()
            if text:
                return text
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, list):
            text = "".join(_part_text(p) for p in content).strip()
            if text:
                return text
    return ""


class UIMessageStreamEncoder:
    """Stateful translator from RedShip dict events to UI Message Stream parts."""

    def __init__(
        self,
        *,
        message_id: str,
        text_id: str = "text-1",
        reasoning_id: str = "reasoning-1",
        citations_id: str = "citations",
    ) -> None:
        self._message_id = message_id
        self._text_id = text_id
        self._reasoning_id = reasoning_id
        self._citations_id = citations_id
        self._text_started = False
        self._reasoning_started = False
        self._terminated = False

    def start(
        self,
        *,
        thread_id: str,
        mode: str,
        user_message_id: str,
        assistant_message_id: str | None = None,
    ) -> list[str]:
        """Emit message ``start`` + persistent ``data-ack``."""
        mid = assistant_message_id or self._message_id
        return [
            format_sse({"type": "start", "messageId": mid}),
            format_sse(
                {
                    "type": "data-ack",
                    "data": {
                        "thread_id": thread_id,
                        "mode": mode,
                        "user_message_id": user_message_id,
                        "assistant_message_id": mid,
                    },
                }
            ),
        ]

    def map_event(self, ev: dict[str, Any]) -> list[str]:
        """Translate one internal event into zero or more SSE lines."""
        if self._terminated:
            return []

        etype = ev.get("type")
        if not etype:
            return []

        if etype == "ack":
            return self.start(
                thread_id=str(ev.get("thread_id") or ""),
                mode=str(ev.get("mode") or "chat"),
                user_message_id=str(ev.get("user_message_id") or ""),
                assistant_message_id=str(ev.get("assistant_message_id") or self._message_id),
            )

        if etype in {"stage", "analysis"}:
            data = {k: v for k, v in ev.items() if k != "type"}
            if etype == "analysis" and "name" not in data:
                data["name"] = "analysis"
            return [
                format_sse(
                    {
                        "type": "data-stage",
                        "data": data,
                        "transient": True,
                    }
                )
            ]

        if etype == "research_step":
            step = str(ev.get("step") or "step")
            iteration = ev.get("iteration")
            part_id = f"rs-{step}"
            if iteration is not None:
                part_id = f"{part_id}-{iteration}"
            data = {k: v for k, v in ev.items() if k != "type"}
            return [
                format_sse(
                    {
                        "type": "data-research-step",
                        "id": part_id,
                        "data": data,
                    }
                )
            ]

        if etype == "artifact":
            art_id = str(ev.get("id") or "artifact")
            fmt = str(ev.get("format") or ("viz" if ev.get("viz") else "html")).lower()
            if fmt not in {"html", "viz"}:
                fmt = "html"
            data: dict[str, Any] = {
                "id": art_id,
                "title": ev.get("title") or ("附图" if fmt == "viz" else "可视化"),
                "format": fmt,
                "language": ev.get("language") or ("json" if fmt == "viz" else "html"),
                "code": ev.get("code") or "",
                "status": ev.get("status") or "done",
            }
            if isinstance(ev.get("viz"), dict):
                data["viz"] = ev["viz"]
            return [
                format_sse(
                    {
                        "type": "data-artifact",
                        "id": art_id,
                        "data": data,
                    }
                )
            ]

        if etype == "citations_ready":
            return [
                format_sse(
                    {
                        "type": "data-citations",
                        "id": self._citations_id,
                        "data": {"items": ev.get("items") or []},
                    }
                )
            ]

        if etype == "final_state":
            citations = ev.get("citations")
            if citations is None:
                return []
            return [
                format_sse(
                    {
                        "type": "data-citations",
                        "id": self._citations_id,
                        "data": {"items": citations},
                    }
                )
            ]

        if etype == "token":
            return self._text_delta(str(ev.get("content") or ""))

        if etype == "reasoning":
            return self._reasoning_delta(str(ev.get("content") or ""))

        if etype == "done":
            # Intermediate LLM done (finish_reason only) — ignore; finish after DB save.
            return []

        if etype == "error":
            return self.emit_error(
                str(ev.get("message") or ev.get("errorText") or "error"),
                terminate=False,
            )

        return []

    def finish(self) -> list[str]:
        """Close open text/reasoning blocks, then emit finish + [DONE]."""
        if self._terminated:
            return []
        lines: list[str] = []
        lines.extend(self._end_reasoning())
        lines.extend(self._end_text())
        lines.append(format_sse({"type": "finish"}))
        lines.append(format_sse("[DONE]"))
        self._terminated = True
        return lines

    def emit_error(self, message: str, *, terminate: bool = False) -> list[str]:
        """Emit an error part; optionally close the stream."""
        lines = [format_sse({"type": "error", "errorText": message})]
        if terminate:
            lines.extend(self.finish())
        return lines

    def _text_delta(self, content: str) -> list[str]:
        lines: list[str] = []
        # Reasoning typically precedes answer tokens; close it before text.
        lines.extend(self._end_reasoning())
        if not self._text_started:
            self._text_started = True
            lines.append(format_sse({"type": "text-start", "id": self._text_id}))
        if content:
            lines.append(
                format_sse({"type": "text-delta", "id": self._text_id, "delta": content})
            )
        return lines

    def _reasoning_delta(self, content: str) -> list[str]:
        lines: list[str] = []
        if not self._reasoning_started:
            self._reasoning_started = True
            lines.append(format_sse({"type": "reasoning-start", "id": self._reasoning_id}))
        if content:
            lines.append(
                format_sse(
                    {
                        "type": "reasoning-delta",
                        "id": self._reasoning_id,
                        "delta": content,
                    }
                )
            )
        return lines

    def _end_text(self) -> list[str]:
        if not self._text_started:
            return []
        self._text_started = False
        return [format_sse({"type": "text-end", "id": self._text_id})]

    def _end_reasoning(self) -> list[str]:
        if not self._reasoning_started:
            return []
        self._reasoning_started = False
        return [format_sse({"type": "reasoning-end", "id": self._reasoning_id})]


# Back-compat alias
UIMessageStreamAdapter = UIMessageStreamEncoder
