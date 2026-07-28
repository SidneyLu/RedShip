"""文献解析：PDF/DOCX 仅 MinerU；MD/TXT 直接读取并按标题切 Section。

对应 PLAN.md 摄入管道第一步；无 pypdf/python-docx 回退路径。
"""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from loguru import logger

from app.core.config import settings
from app.knowledge.contracts import IMAGE_EXTENSIONS


@dataclass
class Section:
    heading_path: str
    text: str
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class ParsedDocument:
    title: str
    sections: list[Section]
    metadata: dict[str, str] = field(default_factory=dict)

    def full_text(self) -> str:
        return "\n\n".join(s.text for s in self.sections)


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)

_MINERU_BIN = shutil.which("mineru")


def _ensure_mineru() -> str:
    if not _MINERU_BIN:
        raise RuntimeError(
            "MinerU CLI (`mineru`) is required but not found. "
            "Install with `pip install mineru` and ensure the backend image includes MinerU."
        )
    return _MINERU_BIN


def _split_markdown(text: str, title: str) -> list[Section]:
    sections: list[Section] = []
    matches = list(_HEADING_RE.finditer(text))
    if not matches:
        body = text.strip()
        if not body:
            raise ValueError("Document contains no extractable text.")
        return [Section(heading_path=title, text=body)]

    chunks: list[tuple[str, int, int]] = []
    for i, m in enumerate(matches):
        level = len(m.group(1))
        heading = m.group(2).strip()
        if i == 0 and m.start() > 0:
            chunks.append((title, 0, m.start()))
        stack: list[tuple[int, str]] = []
        for prev in matches[: i + 1]:
            lvl = len(prev.group(1))
            hdr = prev.group(2).strip()
            while stack and stack[-1][0] >= lvl:
                stack.pop()
            stack.append((lvl, hdr))
        path = " / ".join(h for _, h in stack)
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        chunks.append((path, m.end(), end))

    for path, s, e in chunks:
        section_text = text[s:e].strip()
        if section_text:
            sections.append(Section(heading_path=path, text=section_text))
    if not sections:
        raise ValueError("Document contains no extractable text after heading split.")
    return sections


def _parse_markdown(path: Path) -> ParsedDocument:
    raw = path.read_text(encoding="utf-8", errors="strict")
    title = path.stem
    sections = _split_markdown(raw, title)
    return ParsedDocument(title=title, sections=sections, metadata={"format": "markdown", "parser": "direct"})


def _parse_txt(path: Path) -> ParsedDocument:
    raw = path.read_text(encoding="utf-8", errors="strict").strip()
    if not raw:
        raise ValueError(f"Empty text file: {path}")
    return ParsedDocument(
        title=path.stem,
        sections=[Section(heading_path=path.stem, text=raw)],
        metadata={"format": "txt", "parser": "direct"},
    )


def _run_mineru(path: Path) -> str:
    """Invoke MinerU pipeline backend and return consolidated Markdown."""
    mineru = _ensure_mineru()
    logger.info("MinerU parsing {} (backend={})", path.name, settings.mineru_backend)

    with tempfile.TemporaryDirectory(prefix="redship_mineru_") as tmp:
        out_dir = Path(tmp)
        cmd = [
            mineru,
            "-p",
            str(path),
            "-o",
            str(out_dir),
            "-b",
            settings.mineru_backend,
        ]
        # auto：文字 PDF 走 txt，扫描件走 OCR；强制 OCR 时用 ocr
        if settings.mineru_ocr:
            cmd.extend(["-m", "ocr"])
        else:
            cmd.extend(["-m", "txt"])
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            timeout=settings.mineru_timeout_seconds,
        )
        if proc.returncode != 0:
            stderr = (proc.stderr or proc.stdout or "").strip()
            raise RuntimeError(
                f"MinerU failed for {path.name} (exit {proc.returncode}): {stderr[-3000:]}"
            )

        md_files = sorted(out_dir.rglob("*.md"), key=lambda p: p.stat().st_size, reverse=True)
        if not md_files:
            raise RuntimeError(f"MinerU produced no markdown output for {path.name}")

        # Use the largest markdown artifact (main document body).
        return md_files[0].read_text(encoding="utf-8", errors="strict")


def _parse_with_mineru(path: Path, *, fmt: str) -> ParsedDocument:
    md_content = _run_mineru(path)
    sections = _split_markdown(md_content, path.stem)
    return ParsedDocument(
        title=path.stem,
        sections=sections,
        metadata={"format": fmt, "parser": "mineru", "backend": settings.mineru_backend},
    )


SUPPORTED_EXTENSIONS = {".md", ".markdown", ".pdf", ".docx", ".txt", ".text"}
SESSION_UPLOAD_EXTENSIONS = SUPPORTED_EXTENSIONS | IMAGE_EXTENSIONS
MARKDOWN_ONLY_EXTENSIONS = {".md", ".markdown"}


def parse_document(path: Path) -> ParsedDocument:
    ext = path.suffix.lower()
    if ext in {".md", ".markdown"}:
        return _parse_markdown(path)
    if ext in {".txt", ".text"}:
        return _parse_txt(path)
    if ext == ".pdf":
        return _parse_with_mineru(path, fmt="pdf")
    if ext == ".docx":
        return _parse_with_mineru(path, fmt="docx")
    if ext in IMAGE_EXTENSIONS:
        raise ValueError(
            f"Image files must be parsed via DashScope vision (got {ext}); "
            "use parse_image_document()."
        )
    raise ValueError(f"Unsupported file type: {ext}")


async def parse_image_document(path: Path) -> ParsedDocument:
    """图片：VL OCR + 描述 → 单 section 文档。"""
    from app.llm.dashscope import dashscope_client

    text = (await dashscope_client.describe_image(path)).strip()
    if not text:
        raise ValueError(f"No text could be extracted from image: {path.name}")
    return ParsedDocument(
        title=path.stem,
        sections=[Section(heading_path=path.stem, text=text)],
        metadata={"format": path.suffix.lstrip("."), "parser": "vision"},
    )


async def parse_scanned_pdf_document(path: Path) -> ParsedDocument:
    """扫描 PDF：qwen VL 分页 layout → Markdown sections（含页码 metadata）。"""
    from app.knowledge.ingestion.vision_pdf import extract_scanned_pdf

    result = await extract_scanned_pdf(path)
    return result.parsed


def bibliography_extensions() -> set[str]:
    if settings.bibliography_markdown_only:
        return MARKDOWN_ONLY_EXTENSIONS
    return SUPPORTED_EXTENSIONS


def iter_bibliography(root: Path) -> Iterable[Path]:
    if not root.exists():
        return
    exts = bibliography_extensions()
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in exts:
            yield p
