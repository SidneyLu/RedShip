#!/usr/bin/env python3
"""Render a scanned PDF to page images and run the vision OCR workflow (first N pages).

Writes artifacts to data/demo/... and syncs to frontend/public/demo/gd-wenshi/.

Usage:
  python backend/scripts/demo_vision_pdf_10pages.py
  python backend/scripts/demo_vision_pdf_10pages.py --pdf "E:/path/to/file.pdf" --pages 10
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
DEFAULT_PDF = Path(
    r"e:\【发鲁昕宁】广东 黑龙江 西藏文史资料pdf\广东\80408271_广东文史资料 第1辑 下.pdf"
)
DEFAULT_OUT = REPO_ROOT / "data" / "demo" / "gd_wenshi_vol1_lower_p1-10"
DEFAULT_PUBLIC = REPO_ROOT / "frontend" / "public" / "demo" / "gd-wenshi"


def _bootstrap_env(*, max_pages: int, dpi: int) -> None:
    """Load repo .env and force vision-PDF settings before importing app.*."""
    env_path = REPO_ROOT / ".env"
    if env_path.is_file():
        try:
            from dotenv import load_dotenv

            load_dotenv(env_path, override=False)
        except ImportError:
            pass

    os.environ["VISION_PDF_ENABLED"] = "true"
    os.environ["VISION_PDF_MAX_PAGES"] = str(max_pages)
    os.environ["VISION_PDF_DPI"] = str(dpi)
    os.environ.setdefault("VISION_MODEL", "qwen3.5-flash")
    os.environ.setdefault("ALLOW_INSECURE_DEFAULTS", "true")

    if str(BACKEND_ROOT) not in sys.path:
        sys.path.insert(0, str(BACKEND_ROOT))

    if "app.core.config" in sys.modules:
        from app.core import config as cfg

        cfg.get_settings.cache_clear()
        cfg.settings = cfg.get_settings()


def _write_truncated_pdf(src: Path, dest: Path, *, pages: int) -> None:
    import fitz

    doc = fitz.open(src)
    try:
        n = min(len(doc), pages)
        out = fitz.open()
        try:
            out.insert_pdf(doc, from_page=0, to_page=n - 1)
            dest.parent.mkdir(parents=True, exist_ok=True)
            out.save(str(dest))
        finally:
            out.close()
    finally:
        doc.close()


def _sync_public(
    *,
    public_dir: Path,
    source_pdf: Path,
    content_md: Path,
    layout_json: Path,
    review_path: Path | None,
) -> None:
    public_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_pdf, public_dir / "source.pdf")
    shutil.copy2(content_md, public_dir / "content.md")
    shutil.copy2(layout_json, public_dir / "layout.json")
    if review_path and review_path.is_file():
        shutil.copy2(review_path, public_dir / "review.json")


async def _run(
    pdf: Path,
    out_dir: Path,
    *,
    pages: int,
    dpi: int,
    public_dir: Path | None,
) -> int:
    _bootstrap_env(max_pages=pages, dpi=dpi)

    from app.core.config import settings
    from app.knowledge.ingestion.vision_pdf import (
        extract_scanned_pdf,
        render_pdf_pages,
        write_vision_artifacts,
    )
    from app.knowledge.ingestion.vision_review import review_vision_markdown

    key = (settings.dashscope_api_key or "").strip()
    if not key or key.startswith("sk-your"):
        print("DASHSCOPE_API_KEY missing or placeholder", file=sys.stderr)
        return 1

    if not pdf.is_file():
        print(f"PDF not found: {pdf}", file=sys.stderr)
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    images_dir = out_dir / "pages"
    if images_dir.exists():
        shutil.rmtree(images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    print(f"PDF: {pdf}")
    print(
        f"settings: vision_pdf={settings.vision_pdf_enabled} "
        f"dpi={settings.vision_pdf_dpi} max_pages={settings.vision_pdf_max_pages} "
        f"model={settings.vision_model}"
    )

    t0 = time.perf_counter()
    page_paths = render_pdf_pages(pdf, images_dir, dpi=dpi, max_pages=pages)
    print(f"rendered {len(page_paths)} page image(s) -> {images_dir}")
    if page_paths:
        from PIL import Image

        with Image.open(page_paths[0]) as im:
            print(f"page-0001 size: {im.size[0]}x{im.size[1]}")

    dest_pdf = out_dir / "source.pdf"
    _write_truncated_pdf(pdf, dest_pdf, pages=pages)

    result = await extract_scanned_pdf(pdf, title=pdf.stem)
    md_path, layout_path = write_vision_artifacts(pdf, result, out_dir=out_dir)

    content_md = out_dir / "content.md"
    content_md.write_text(result.markdown, encoding="utf-8")
    layout_json = out_dir / "layout.json"
    layout_json.write_text(
        json.dumps(result.layout, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    review = await review_vision_markdown(
        result.markdown,
        pages=result.pages,
        block_count=result.block_count,
        empty_pages=result.empty_pages,
    )
    review_path = out_dir / "review.json"
    review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")

    if public_dir is not None:
        _sync_public(
            public_dir=public_dir,
            source_pdf=dest_pdf,
            content_md=content_md,
            layout_json=layout_json,
            review_path=review_path,
        )
        print(f"synced public demo -> {public_dir}")

    elapsed = time.perf_counter() - t0
    summary = {
        "pdf": str(pdf),
        "pages_rendered": len(page_paths),
        "pages_ocr": result.pages,
        "block_count": result.block_count,
        "empty_pages": result.empty_pages,
        "review_score": review.get("score"),
        "review_summary": review.get("summary"),
        "needs_rerun": review.get("needs_rerun"),
        "elapsed_sec": round(elapsed, 1),
        "dpi": dpi,
        "artifacts": {
            "images": str(images_dir),
            "content_md": str(content_md),
            "layout_json": str(layout_json),
            "review_json": str(review_path),
            "stem_md": str(md_path),
            "stem_layout": str(layout_path),
            "source_pdf": str(dest_pdf),
            "public_dir": str(public_dir) if public_dir else None,
        },
    }
    (out_dir / "run_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Demo: PDF → images → vision OCR")
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--public", type=Path, default=DEFAULT_PUBLIC)
    parser.add_argument("--no-public", action="store_true", help="Skip frontend/public sync")
    parser.add_argument("--pages", type=int, default=10, help="Max pages to OCR")
    parser.add_argument("--dpi", type=int, default=300)
    args = parser.parse_args()
    public = None if args.no_public else args.public
    return asyncio.run(
        _run(args.pdf, args.out, pages=args.pages, dpi=args.dpi, public_dir=public)
    )


if __name__ == "__main__":
    raise SystemExit(main())
