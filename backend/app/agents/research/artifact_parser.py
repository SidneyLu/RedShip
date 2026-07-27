"""从 Markdown 流中解析 ```artifact-html 围栏并产出 artifact 事件。"""
from __future__ import annotations

import re
import uuid
from typing import Any

_OPEN_RE = re.compile(r"```artifact-html\s*\n", re.IGNORECASE)
_TITLE_RE = re.compile(r"^<!--\s*title:\s*(.+?)\s*-->\s*\n?", re.IGNORECASE)
_CLOSE = "```"
_MAX_CODE_BYTES = 200 * 1024


def extract_artifacts_from_markdown(text: str) -> list[dict[str, Any]]:
    """从完整 Markdown 提取 artifact-html 块（用于持久化）。"""
    pattern = re.compile(
        r"```artifact-html\s*\n(?:<!--\s*title:\s*(.+?)\s*-->\s*\n)?([\s\S]*?)```",
        re.IGNORECASE,
    )
    out: list[dict[str, Any]] = []
    for idx, m in enumerate(pattern.finditer(text or ""), start=1):
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
                "language": "html",
                "code": code,
                "status": "done",
            }
        )
    return out


class ArtifactFenceParser:
    """增量解析 token，旁路产出 artifact 流式事件；原文 token 原样透传。"""

    def __init__(self) -> None:
        self._buf = ""
        self._in_fence = False
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
                    # 保留可能的半开 fence 前缀
                    if "```" in self._buf[-24:]:
                        idx = self._buf.rfind("```")
                        self._buf = self._buf[idx:]
                    else:
                        self._buf = ""
                    break

                self._buf = self._buf[m.end() :]
                self._in_fence = True
                self._count += 1
                self._artifact_id = f"art-{self._count}-{uuid.uuid4().hex[:8]}"
                self._title = f"可视化 {self._count}"
                self._code = ""
                self._last_emitted_len = 0
                tm = _TITLE_RE.match(self._buf)
                if tm:
                    self._title = tm.group(1).strip() or self._title
                    self._buf = self._buf[tm.end() :]
                events.append(
                    {
                        "type": "artifact",
                        "id": self._artifact_id,
                        "title": self._title,
                        "language": "html",
                        "code": "",
                        "status": "streaming",
                    }
                )
            else:
                # 围栏刚打开时，仍可能在后续 token 里收到 title 注释
                if not self._code:
                    tm = _TITLE_RE.match(self._buf)
                    if tm:
                        self._title = tm.group(1).strip() or self._title
                        self._buf = self._buf[tm.end() :]
                        # 更新标题
                        events.append(
                            {
                                "type": "artifact",
                                "id": self._artifact_id,
                                "title": self._title,
                                "language": "html",
                                "code": "",
                                "status": "streaming",
                            }
                        )

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
                    events.extend(self._maybe_emit_partial())
                    break

                self._code += self._buf[:close_idx]
                self._buf = self._buf[close_idx + len(_CLOSE) :]
                code = self._code.strip()
                if code and len(code.encode("utf-8")) <= _MAX_CODE_BYTES:
                    art = {
                        "id": self._artifact_id,
                        "title": self._title,
                        "language": "html",
                        "code": code,
                        "status": "done",
                    }
                    self.artifacts.append(art)
                    events.append({"type": "artifact", **art})
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
        if not code or len(code.encode("utf-8")) > _MAX_CODE_BYTES:
            return []
        art = {
            "id": self._artifact_id,
            "title": self._title,
            "language": "html",
            "code": code,
            "status": "done",
        }
        self.artifacts.append(art)
        return [{"type": "artifact", **art}]

    def _maybe_emit_partial(self) -> list[dict[str, Any]]:
        if not self._artifact_id:
            return []
        if len(self._code) - self._last_emitted_len < 800:
            return []
        self._last_emitted_len = len(self._code)
        code = self._code
        if len(code.encode("utf-8")) > _MAX_CODE_BYTES:
            return []
        return [
            {
                "type": "artifact",
                "id": self._artifact_id,
                "title": self._title,
                "language": "html",
                "code": code,
                "status": "streaming",
            }
        ]
