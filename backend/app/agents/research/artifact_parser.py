"""从 Markdown 流中解析 ```artifact-html / ```artifact-viz 围栏并产出 artifact 事件。"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any

_OPEN_RE = re.compile(r"```artifact-(html|viz)\s*\n", re.IGNORECASE)
_TITLE_RE = re.compile(r"^<!--\s*title:\s*(.+?)\s*-->\s*\n?", re.IGNORECASE)
_CLOSE = "```"
_MAX_CODE_BYTES = 200 * 1024

_EXTRACT_HTML_RE = re.compile(
    r"```artifact-html\s*\n(?:<!--\s*title:\s*(.+?)\s*-->\s*\n)?([\s\S]*?)```",
    re.IGNORECASE,
)
_EXTRACT_VIZ_RE = re.compile(
    r"```artifact-viz\s*\n([\s\S]*?)```",
    re.IGNORECASE,
)


def _parse_viz_json(raw: str) -> dict[str, Any] | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Tolerate trailing commas / markdown fences leftovers lightly
        try:
            data = json.loads(text.strip("` \n"))
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    kind = str(data.get("kind") or "echarts").strip().lower()
    if kind not in {"echarts", "timeline", "network"}:
        kind = "echarts"
    title = str(data.get("title") or "").strip() or None
    viz: dict[str, Any] = {"kind": kind}
    if title:
        viz["title"] = title
    if kind == "echarts":
        option = data.get("option")
        if not isinstance(option, dict):
            return None
        viz["option"] = option
    elif kind == "timeline":
        items = data.get("items")
        if not isinstance(items, list) or not items:
            return None
        viz["items"] = items
    elif kind == "network":
        nodes = data.get("nodes")
        links = data.get("links")
        if not isinstance(nodes, list) or not nodes:
            return None
        viz["nodes"] = nodes
        viz["links"] = links if isinstance(links, list) else []
    return viz


def extract_artifacts_from_markdown(text: str) -> list[dict[str, Any]]:
    """从完整 Markdown 提取 artifact-html / artifact-viz 块（用于持久化）。"""
    out: list[dict[str, Any]] = []
    idx = 0

    for m in _EXTRACT_HTML_RE.finditer(text or ""):
        idx += 1
        title = (m.group(1) or f"可视化 {idx}").strip()
        code = (m.group(2) or "").strip()
        if not code:
            continue
        if len(code.encode("utf-8")) > _MAX_CODE_BYTES:
            continue
        out.append(
            {
                "id": f"art-{idx}-{uuid.uuid4().hex[:8]}",
                "title": title,
                "format": "html",
                "language": "html",
                "code": code,
                "status": "done",
            }
        )

    for m in _EXTRACT_VIZ_RE.finditer(text or ""):
        idx += 1
        code = (m.group(1) or "").strip()
        if not code or len(code.encode("utf-8")) > _MAX_CODE_BYTES:
            continue
        viz = _parse_viz_json(code)
        if not viz:
            continue
        title = str(viz.get("title") or f"附图 {idx}").strip()
        out.append(
            {
                "id": f"art-{idx}-{uuid.uuid4().hex[:8]}",
                "title": title,
                "format": "viz",
                "language": "json",
                "code": code,
                "viz": viz,
                "status": "done",
            }
        )

    return out


class ArtifactFenceParser:
    """增量解析 token，旁路产出 artifact 流式事件；原文 token 原样透传。"""

    def __init__(self) -> None:
        self._buf = ""
        self._in_fence = False
        self._fence_kind: str = "html"  # html | viz
        self._artifact_id: str | None = None
        self._title = "可视化"
        self._code = ""
        self._last_emitted_len = 0
        self._count = 0
        self.artifacts: list[dict[str, Any]] = []

    def feed(self, token: str) -> list[dict[str, Any]]:
        """喂入一个文本 delta，返回需额外 yield 的 artifact 事件（不含 token 本身）。"""
        events: list[dict[str, Any]] = []
        self._buf += token

        while True:
            if not self._in_fence:
                m = _OPEN_RE.search(self._buf)
                if not m:
                    if "```" in self._buf[-24:]:
                        idx = self._buf.rfind("```")
                        self._buf = self._buf[idx:]
                    else:
                        self._buf = ""
                    break

                self._fence_kind = m.group(1).lower()
                self._buf = self._buf[m.end() :]
                self._in_fence = True
                self._count += 1
                self._artifact_id = f"art-{self._count}-{uuid.uuid4().hex[:8]}"
                self._title = f"{'附图' if self._fence_kind == 'viz' else '可视化'} {self._count}"
                self._code = ""
                self._last_emitted_len = 0

                if self._fence_kind == "html":
                    tm = _TITLE_RE.match(self._buf)
                    if tm:
                        self._title = tm.group(1).strip() or self._title
                        self._buf = self._buf[tm.end() :]

                events.append(self._streaming_event(code=""))
            else:
                if self._fence_kind == "html" and not self._code:
                    tm = _TITLE_RE.match(self._buf)
                    if tm:
                        self._title = tm.group(1).strip() or self._title
                        self._buf = self._buf[tm.end() :]
                        events.append(self._streaming_event(code=""))

                close_idx = self._buf.find(_CLOSE)
                if close_idx < 0:
                    hold = 0
                    for i in range(1, min(3, len(self._buf)) + 1):
                        if self._buf.endswith("`" * i):
                            hold = i
                    if hold:
                        self._code += self._buf[:-hold]
                        self._buf = self._buf[-hold:]
                    else:
                        self._code += self._buf
                        self._buf = ""
                    # HTML can stream partials; viz waits for closed JSON
                    if self._fence_kind == "html":
                        events.extend(self._maybe_emit_partial())
                    break

                self._code += self._buf[:close_idx]
                self._buf = self._buf[close_idx + len(_CLOSE) :]
                code = self._code.strip()
                done = self._finish_artifact(code)
                if done:
                    events.append(done)
                self._in_fence = False
                self._artifact_id = None
                self._code = ""
                self._last_emitted_len = 0
        return events

    def flush(self) -> list[dict[str, Any]]:
        """流结束时若仍在未闭合 fence，按已有内容收尾。"""
        if not self._in_fence or not self._artifact_id:
            return []
        self._code += self._buf
        self._buf = ""
        code = self._code.strip()
        self._in_fence = False
        done = self._finish_artifact(code)
        return [done] if done else []

    def _streaming_event(self, *, code: str) -> dict[str, Any]:
        fmt = "viz" if self._fence_kind == "viz" else "html"
        return {
            "type": "artifact",
            "id": self._artifact_id,
            "title": self._title,
            "format": fmt,
            "language": "json" if fmt == "viz" else "html",
            "code": code,
            "status": "streaming",
        }

    def _finish_artifact(self, code: str) -> dict[str, Any] | None:
        if not code or not self._artifact_id:
            return None
        if len(code.encode("utf-8")) > _MAX_CODE_BYTES:
            return None

        if self._fence_kind == "viz":
            viz = _parse_viz_json(code)
            if not viz:
                return None
            title = str(viz.get("title") or self._title).strip() or self._title
            art = {
                "id": self._artifact_id,
                "title": title,
                "format": "viz",
                "language": "json",
                "code": code,
                "viz": viz,
                "status": "done",
            }
            self.artifacts.append(art)
            return {"type": "artifact", **art}

        art = {
            "id": self._artifact_id,
            "title": self._title,
            "format": "html",
            "language": "html",
            "code": code,
            "status": "done",
        }
        self.artifacts.append(art)
        return {"type": "artifact", **art}

    def _maybe_emit_partial(self) -> list[dict[str, Any]]:
        if not self._artifact_id:
            return []
        if len(self._code) - self._last_emitted_len < 800:
            return []
        self._last_emitted_len = len(self._code)
        code = self._code
        if len(code.encode("utf-8")) > _MAX_CODE_BYTES:
            return []
        return [self._streaming_event(code=code)]
