#!/usr/bin/env python3
"""Re-OCR selected pages and merge into existing demo layout.json / content.md.

Usage:
  python backend/scripts/rerun_vision_pages.py --pages 4,5,8
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
DEFAULT_PDF = Path(
    r"e:\【发鲁昕宁】广东 黑龙江 西藏文史资料pdf\广东\80408271_广东文史资料 第1辑 下.pdf"
)
DEFAULT_OUT = REPO_ROOT / "data" / "demo" / "gd_wenshi_vol1_lower_p1-10"
DEFAULT_PUBLIC = REPO_ROOT / "frontend" / "public" / "demo" / "gd-wenshi"


def _bootstrap(*, dpi: int) -> None:
    env_path = REPO_ROOT / ".env"
    if env_path.is_file():
        try:
            from dotenv import load_dotenv

            load_dotenv(env_path, override=False)
        except ImportError:
            pass
    os.environ["VISION_PDF_ENABLED"] = "true"
    os.environ["VISION_PDF_DPI"] = str(dpi)
    os.environ.setdefault("VISION_MODEL", "qwen3.5-flash")
    os.environ.setdefault("ALLOW_INSECURE_DEFAULTS", "true")
    if str(BACKEND_ROOT) not in sys.path:
        sys.path.insert(0, str(BACKEND_ROOT))
    if "app.core.config" in sys.modules:
        from app.core import config as cfg

        cfg.get_settings.cache_clear()
        cfg.settings = cfg.get_settings()


def _render_one_page(pdf: Path, page_1based: int, out_png: Path, *, dpi: int) -> None:
    import fitz

    doc = fitz.open(pdf)
    try:
        i = page_1based - 1
        if i < 0 or i >= len(doc):
            raise IndexError(f"page {page_1based} out of range (doc has {len(doc)})")
        zoom = dpi / 72.0
        pix = doc.load_page(i).get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        out_png.parent.mkdir(parents=True, exist_ok=True)
        pix.save(str(out_png))
    finally:
        doc.close()


def _bbox_area(bb: list) -> float:
    if not isinstance(bb, list) or len(bb) < 4:
        return 0.0
    return max(0.0, float(bb[2]) - float(bb[0])) * max(0.0, float(bb[3]) - float(bb[1]))


async def _ocr_page(img: Path, page: int, *, extra_hint: str | None = None, repair: bool = False):
    from app.llm.dashscope import dashscope_client
    from app.knowledge.ingestion.vision_pdf import parse_layout_json_text

    raw = await dashscope_client.extract_page_layout(img, page=page, extra_hint=extra_hint)
    blocks = parse_layout_json_text(raw, page, repair=repair)
    return blocks, raw


def _blocks_to_page_entry(page: int, blocks) -> dict:
    return {
        "page": page,
        "width_norm": 1000,
        "height_norm": 1000,
        "blocks": [
            {"type": b.type, "text": b.text, "bbox": b.bbox}
            for b in blocks
        ],
    }


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--public", type=Path, default=DEFAULT_PUBLIC)
    parser.add_argument("--pages", type=str, default="4,5,8")
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--retries", type=int, default=2, help="Extra retries if page still degenerate")
    args = parser.parse_args()

    pages = sorted({int(x.strip()) for x in args.pages.split(",") if x.strip()})
    if not pages:
        print("no pages", file=sys.stderr)
        return 1

    _bootstrap(dpi=args.dpi)
    from app.core.config import settings
    from app.knowledge.ingestion.vision_pdf import LayoutBlock, blocks_to_markdown
    from app.knowledge.ingestion.vision_review import review_vision_markdown

    if not args.pdf.is_file():
        print(f"PDF missing: {args.pdf}", file=sys.stderr)
        return 1

    layout_path = args.out / "layout.json"
    if not layout_path.is_file():
        layout_path = args.public / "layout.json"
    if not layout_path.is_file():
        print("layout.json not found", file=sys.stderr)
        return 1

    layout = json.loads(layout_path.read_text(encoding="utf-8"))
    by_page = {int(p["page"]): p for p in layout.get("pages") or []}

    args.out.mkdir(parents=True, exist_ok=True)
    images_dir = args.out / "pages"
    images_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    print(f"model={settings.vision_model} dpi={args.dpi} pages={pages}")

    STRICT_HINT = (
        "【强制】上一轮 bbox 无效。请为每个可见文字区域输出独立紧框："
        "标题行、作者行、小节标题、每个正文段落、页脚页码分别一块；"
        "bbox 宽高都应明显小于整页，禁止所有块共用 [0,0,1000,1000]。"
    )

    for page in pages:
        attempt = 0
        best_blocks = []
        while True:
            attempt += 1
            img = images_dir / f"page-{page:04d}.png"
            _render_one_page(args.pdf, page, img, dpi=args.dpi)
            hint = STRICT_HINT if attempt > 1 else None
            print(f"OCR page {page} attempt {attempt} ({img.stat().st_size} bytes)…")
            blocks, _raw = await _ocr_page(img, page, extra_hint=hint, repair=False)
            areas = [_bbox_area(b.bbox) for b in blocks]
            deg = sum(1 for a in areas if a >= 0.85 * 1_000_000 or a < 1.0)
            print(
                f"  -> {len(blocks)} blocks, degenerate={deg}/{len(blocks)}, "
                f"max_area={max(areas) if areas else 0:.0f}"
            )
            if blocks and (not best_blocks or deg < sum(
                1 for b in best_blocks if _bbox_area(b.bbox) >= 0.85 * 1_000_000 or _bbox_area(b.bbox) < 1.0
            )):
                best_blocks = blocks
            if blocks and deg < max(1, (len(blocks) + 1) // 2):
                # Accept; apply repair only if still a minority of bad boxes
                from app.knowledge.ingestion.vision_pdf import parse_layout_json_text

                accepted = parse_layout_json_text(
                    json.dumps(
                        {
                            "blocks": [
                                {"type": b.type, "text": b.text, "bbox": b.bbox}
                                for b in blocks
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    page,
                    repair=True,
                )
                by_page[page] = _blocks_to_page_entry(page, accepted)
                break
            if attempt > args.retries:
                print(f"  !! page {page} still weak after retries; applying repair fallback")
                from app.knowledge.ingestion.vision_pdf import parse_layout_json_text

                accepted = parse_layout_json_text(
                    json.dumps(
                        {
                            "blocks": [
                                {"type": b.type, "text": b.text, "bbox": b.bbox}
                                for b in (best_blocks or blocks)
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    page,
                    repair=True,
                )
                by_page[page] = _blocks_to_page_entry(page, accepted)
                break
            print("  retrying (too many degenerate bboxes)…")

    max_page = max(by_page.keys()) if by_page else max(pages)
    layout = {
        "schema_version": layout.get("schema_version", 1),
        "norm": 1000,
        "pages": [by_page[p] for p in range(1, max_page + 1) if p in by_page],
    }

    # Rebuild markdown from all blocks in page order
    all_blocks: list[LayoutBlock] = []
    for p in sorted(by_page):
        for item in by_page[p].get("blocks") or []:
            all_blocks.append(
                LayoutBlock(
                    type=str(item.get("type") or "text"),
                    text=str(item.get("text") or ""),
                    bbox=list(item.get("bbox") or [0, 0, 0, 0]),
                    page=p,
                )
            )
    title = "80408271_广东文史资料 第1辑 下"
    md = blocks_to_markdown(all_blocks, title=title)

    out_layout = args.out / "layout.json"
    out_md = args.out / "content.md"
    out_layout.write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding="utf-8")
    out_md.write_text(md, encoding="utf-8")

    review = await review_vision_markdown(
        md,
        pages=len(layout["pages"]),
        block_count=len(all_blocks),
        empty_pages=sum(1 for p in layout["pages"] if not (p.get("blocks") or [])),
    )
    review_path = args.out / "review.json"
    review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")

    # Sync public
    public = args.public
    public.mkdir(parents=True, exist_ok=True)
    shutil.copy2(out_layout, public / "layout.json")
    shutil.copy2(out_md, public / "content.md")
    shutil.copy2(review_path, public / "review.json")
    src_pdf = args.out / "source.pdf"
    if src_pdf.is_file():
        shutil.copy2(src_pdf, public / "source.pdf")

    summary = {
        "rerun_pages": pages,
        "elapsed_sec": round(time.perf_counter() - t0, 1),
        "block_count": len(all_blocks),
        "review_score": review.get("score"),
        "layout": str(out_layout),
        "public": str(public),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
