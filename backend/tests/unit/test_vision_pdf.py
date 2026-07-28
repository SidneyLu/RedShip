"""Unit tests for VL layout JSON parsing (no live DashScope)."""
from __future__ import annotations

import pytest

from app.knowledge.ingestion.vision_pdf import (
    blocks_to_markdown,
    parse_layout_json_text,
)
from app.knowledge.ingestion.vision_review import _parse_review_json

pytestmark = pytest.mark.unit


def test_parse_layout_json_text():
    raw = '{"blocks":[{"type":"sectionheader","text":"标题","bbox":[10,20,900,80]},{"type":"text","text":"正文","bbox":[10,100,900,200]}]}'
    blocks = parse_layout_json_text(raw, page=3)
    assert len(blocks) == 2
    assert blocks[0].page == 3
    assert blocks[0].type == "sectionheader"
    assert blocks[1].bbox[0] == 10.0


def test_parse_layout_accepts_unit_interval_bbox():
    raw = '{"blocks":[{"type":"text","text":"a","bbox":[0.1,0.2,0.9,0.3]}]}'
    blocks = parse_layout_json_text(raw, 1)
    assert blocks[0].bbox[0] == pytest.approx(100.0)


def test_parse_repairs_full_page_bboxes():
    raw = (
        '{"blocks":['
        '{"type":"sectionheader","text":"目录","bbox":[0,0,1000,1000]},'
        '{"type":"text","text":"条目一","bbox":[0,0,1000,1000]},'
        '{"type":"text","text":"条目二","bbox":[0,0,1000,1000]}'
        "]}"
    )
    blocks = parse_layout_json_text(raw, page=4)
    assert len(blocks) == 3
    assert all(b.bbox != [0.0, 0.0, 1000.0, 1000.0] for b in blocks)
    assert blocks[0].bbox[1] < blocks[1].bbox[1] < blocks[2].bbox[1]


def test_blocks_to_markdown_skips_footer():
    from app.knowledge.ingestion.vision_pdf import LayoutBlock

    blocks = [
        LayoutBlock("sectionheader", "一、前言", [0, 0, 100, 50], 1),
        LayoutBlock("text", "内容", [0, 60, 100, 200], 1),
        LayoutBlock("pagefooter", "— 1 —", [0, 900, 1000, 980], 1),
    ]
    md = blocks_to_markdown(blocks, title="测试")
    assert "一、前言" in md
    assert "内容" in md
    assert "— 1 —" not in md


def test_parse_review_json():
    out = _parse_review_json('{"score":0.82,"issues":["噪声"],"summary":"可用"}')
    assert out["score"] == 0.82
    assert out["issues"] == ["噪声"]
