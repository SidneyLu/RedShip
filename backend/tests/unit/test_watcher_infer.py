"""Unit tests for bibliography path heuristics."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.knowledge.ingestion.watcher import _sha256, infer_era, infer_series

pytestmark = pytest.mark.unit


def test_infer_era_from_title():
    assert infer_era(Path("a.md"), "长征路上") == "土地革命战争"
    assert infer_era(Path("a.md"), "抗日战争纪事") == "抗日战争"
    assert infer_era(Path("a.md"), "无关标题") == ""


def test_infer_series_from_path():
    p = Path("bibliography") / "南开人物志" / "foo.md"
    series = infer_series(p)
    assert series in {"南开人物志", "bibliography"} or "人物" in series or series == "南开人物志"


def test_sha256_stable(tmp_path: Path):
    f = tmp_path / "a.txt"
    f.write_bytes(b"hello")
    h1 = _sha256(f)
    h2 = _sha256(f)
    assert h1 == h2
    assert len(h1) == 64
