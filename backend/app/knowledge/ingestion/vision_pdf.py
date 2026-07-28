"""Scan-PDF → page images → qwen3.5-flash VL layout JSON → Markdown + sidecar."""
from __future__ import annotations

import json
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from loguru import logger

from app.core.config import settings
from app.knowledge.ingestion.parser import ParsedDocument, Section

LAYOUT_SCHEMA_VERSION = 1
_BODY_BLOCK_TYPES = {"text", "sectionheader", "title", "paragraph", "caption"}
_SKIP_RAG_TYPES = {"pagefooter", "pageheader", "footer", "header"}


@dataclass
class LayoutBlock:
    type: str
    text: str
    bbox: list[float]  # [x0, y0, x1, y1] in 0–1000
    page: int


@dataclass
class VisionPdfResult:
    parsed: ParsedDocument
    layout: dict[str, Any]
    markdown: str
    pages: int
    block_count: int
    empty_pages: int


def _normalize_bbox(raw: Any) -> list[float] | None:
    if not isinstance(raw, (list, tuple)) or len(raw) < 4:
        return None
    try:
        vals = [float(raw[i]) for i in range(4)]
    except (TypeError, ValueError):
        return None
    # Accept 0–1 normalized coords and scale up
    if all(0.0 <= v <= 1.5 for v in vals) and max(vals) <= 1.5:
        vals = [v * 1000.0 for v in vals]
    return [max(0.0, min(1000.0, v)) for v in vals]


def _bbox_area(bbox: list[float]) -> float:
    return max(0.0, bbox[2] - bbox[0]) * max(0.0, bbox[3] - bbox[1])


def _is_degenerate_bbox(bbox: list[float]) -> bool:
    if len(bbox) < 4:
        return True
    return _bbox_area(bbox) >= 0.85 * 1000.0 * 1000.0 or _bbox_area(bbox) < 1.0


def _repair_page_blocks(blocks: list[LayoutBlock], page: int) -> list[LayoutBlock]:
    """If most boxes on a page are full-page/empty, stack estimated rects by reading order."""
    if not blocks:
        return blocks
    bad = sum(1 for b in blocks if _is_degenerate_bbox(b.bbox))
    if bad < max(1, (len(blocks) + 1) // 2):
        return blocks

    logger.warning(
        "Page {}: {}/{} blocks have degenerate bbox; estimating vertical stack",
        page,
        bad,
        len(blocks),
    )
    margin_x, margin_y, gap = 70.0, 55.0, 10.0
    usable = 1000.0 - margin_y * 2 - gap * max(0, len(blocks) - 1)
    weights: list[float] = []
    for b in blocks:
        lines = max(1, b.text.count("\n") + 1)
        chars = max(8, len("".join(b.text.split())))
        weights.append(max(1.0, lines * 1.2 + chars / 36.0))
    total_w = sum(weights) or 1.0
    y = margin_y
    fixed: list[LayoutBlock] = []
    for b, w in zip(blocks, weights):
        h = max(22.0, (w / total_w) * usable)
        y1 = min(1000.0 - margin_y, y + h)
        fixed.append(
            LayoutBlock(
                type=b.type,
                text=b.text,
                bbox=[margin_x, y, 1000.0 - margin_x, y1],
                page=b.page,
            )
        )
        y = y1 + gap
    return fixed


def _parse_blocks_payload(payload: Any, page: int) -> list[LayoutBlock]:
    blocks_raw: list[Any] = []
    if isinstance(payload, dict):
        blocks_raw = payload.get("blocks") or payload.get("items") or []
    elif isinstance(payload, list):
        blocks_raw = payload
    out: list[LayoutBlock] = []
    for item in blocks_raw:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        btype = str(item.get("type") or "text").strip().lower() or "text"
        bbox = _normalize_bbox(item.get("bbox") or item.get("box") or item.get("rect"))
        if not bbox:
            # Placeholder; repaired per-page after parse (avoid full-page wash).
            bbox = [0.0, 0.0, 0.0, 0.0]
        out.append(LayoutBlock(type=btype, text=text, bbox=bbox, page=page))
    return out


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def parse_layout_json_text(text: str, page: int, *, repair: bool = True) -> list[LayoutBlock]:
    raw = (text or "").strip()
    if not raw:
        return []
    m = _JSON_FENCE_RE.search(raw)
    if m:
        raw = m.group(1).strip()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        # Try first { ... } slice
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                payload = json.loads(raw[start : end + 1])
            except json.JSONDecodeError:
                logger.warning("VL layout JSON parse failed on page {}", page)
                return []
        else:
            return []
    blocks = _parse_blocks_payload(payload, page)
    return _repair_page_blocks(blocks, page) if repair else blocks


def render_pdf_pages(pdf_path: Path, out_dir: Path, *, dpi: int, max_pages: int) -> list[Path]:
    try:
        import fitz  # PyMuPDF
    except ImportError as e:
        raise RuntimeError(
            "PyMuPDF (pymupdf) is required for vision PDF parsing. "
            "Install with `pip install pymupdf`."
        ) from e

    doc = fitz.open(pdf_path)
    try:
        n = min(len(doc), max_pages)
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        paths: list[Path] = []
        for i in range(n):
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            out = out_dir / f"page-{i + 1:04d}.png"
            pix.save(str(out))
            paths.append(out)
        return paths
    finally:
        doc.close()


def blocks_to_markdown(blocks: list[LayoutBlock], *, title: str) -> str:
    lines: list[str] = [f"# {title}", ""]
    current_page: int | None = None
    for b in blocks:
        if b.type in _SKIP_RAG_TYPES:
            continue
        if current_page != b.page:
            current_page = b.page
            lines.append(f"<!-- page: {b.page} -->")
            lines.append("")
        if b.type in {"sectionheader", "title"}:
            lines.append(f"## {b.text}")
            lines.append("")
        else:
            lines.append(b.text)
            lines.append("")
    return "\n".join(lines).strip() + "\n"


def blocks_to_layout(blocks: list[LayoutBlock], *, pages: int) -> dict[str, Any]:
    by_page: dict[int, list[dict[str, Any]]] = {}
    for b in blocks:
        by_page.setdefault(b.page, []).append(
            {"type": b.type, "text": b.text, "bbox": b.bbox}
        )
    return {
        "schema_version": LAYOUT_SCHEMA_VERSION,
        "norm": 1000,
        "pages": [
            {
                "page": p,
                "width_norm": 1000,
                "height_norm": 1000,
                "blocks": by_page.get(p, []),
            }
            for p in range(1, pages + 1)
        ],
    }


def layout_to_sections(blocks: list[LayoutBlock], *, title: str) -> list[Section]:
    """Group body blocks into sections keyed by heading / page."""
    sections: list[Section] = []
    buf: list[str] = []
    heading = title
    page_start = 1
    page_end = 1
    bboxes: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal buf, heading, page_start, page_end, bboxes
        text = "\n".join(buf).strip()
        if not text:
            buf = []
            bboxes = []
            return
        sections.append(
            Section(
                heading_path=heading[:500],
                text=text,
                metadata={
                    "page_start": str(page_start),
                    "page_end": str(page_end),
                    "bboxes_json": json.dumps(bboxes, ensure_ascii=False),
                },
            )
        )
        buf = []
        bboxes = []

    for b in blocks:
        if b.type in _SKIP_RAG_TYPES:
            continue
        if b.type in {"sectionheader", "title"} and buf:
            flush()
            heading = b.text
            page_start = b.page
            page_end = b.page
            buf = [b.text]
            bboxes = [{"page": b.page, "bbox": b.bbox, "type": b.type}]
            continue
        if not buf:
            page_start = b.page
            if b.type in {"sectionheader", "title"}:
                heading = b.text
        page_end = b.page
        buf.append(b.text)
        bboxes.append({"page": b.page, "bbox": b.bbox, "type": b.type})
    flush()
    if not sections:
        # Fallback: one section with all body text
        body = "\n".join(b.text for b in blocks if b.type not in _SKIP_RAG_TYPES)
        sections.append(Section(heading_path=title, text=body or title))
    return sections


async def extract_scanned_pdf(
    pdf_path: Path,
    *,
    title: str | None = None,
) -> VisionPdfResult:
    """Render PDF pages and run VL layout extraction (settings.vision_model)."""
    from app.llm.dashscope import dashscope_client

    if not settings.vision_pdf_enabled:
        raise RuntimeError("VISION_PDF_ENABLED is false")

    pdf_path = pdf_path.resolve()
    if not pdf_path.is_file():
        raise FileNotFoundError(str(pdf_path))

    dpi = max(72, int(settings.vision_pdf_dpi))
    max_pages = max(1, int(settings.vision_pdf_max_pages))
    doc_title = title or pdf_path.stem

    all_blocks: list[LayoutBlock] = []
    page_count = 0
    with tempfile.TemporaryDirectory(prefix="redship_vision_pdf_") as tmp:
        page_images = render_pdf_pages(pdf_path, Path(tmp), dpi=dpi, max_pages=max_pages)
        page_count = len(page_images)
        if not page_images:
            raise ValueError(f"PDF has no pages: {pdf_path.name}")
        for idx, img in enumerate(page_images, start=1):
            logger.info("VL layout page {}/{} for {}", idx, page_count, pdf_path.name)
            raw = await dashscope_client.extract_page_layout(img, page=idx)
            all_blocks.extend(parse_layout_json_text(raw, idx))

    pages = page_count
    if all_blocks:
        pages = max(pages, max(b.page for b in all_blocks))

    empty_pages = 0
    if pages:
        present = {b.page for b in all_blocks if b.type not in _SKIP_RAG_TYPES and b.text.strip()}
        empty_pages = sum(1 for p in range(1, pages + 1) if p not in present)

    markdown = blocks_to_markdown(all_blocks, title=doc_title)
    layout = blocks_to_layout(all_blocks, pages=pages or 1)
    sections = layout_to_sections(all_blocks, title=doc_title)
    parsed = ParsedDocument(
        title=doc_title,
        sections=sections,
        metadata={
            "format": "pdf",
            "parser": "vision_pdf",
            "vision_model": settings.vision_model,
            "pages": str(pages or 1),
        },
    )
    return VisionPdfResult(
        parsed=parsed,
        layout=layout,
        markdown=markdown,
        pages=pages or 1,
        block_count=len(all_blocks),
        empty_pages=empty_pages,
    )


def write_vision_artifacts(
    pdf_path: Path,
    result: VisionPdfResult,
    *,
    out_dir: Path | None = None,
) -> tuple[Path, Path]:
    """Write sibling foo.md + foo.layout.json next to the PDF (or out_dir)."""
    base = out_dir or pdf_path.parent
    base.mkdir(parents=True, exist_ok=True)
    stem = pdf_path.stem
    md_path = base / f"{stem}.md"
    layout_path = base / f"{stem}.layout.json"
    md_path.write_text(result.markdown, encoding="utf-8")
    layout_path.write_text(
        json.dumps(result.layout, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return md_path, layout_path
