"""Unit tests for Document → source PDF resolver."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.knowledge.source_pdf import resolve_source_pdf


def _doc(**kwargs):
    defaults = {
        "id": "doc-1",
        "file_path": None,
        "relative_path": None,
        "source": "bibliography",
        "extra_metadata": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


@pytest.fixture()
def bib_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    bib = tmp_path / "bibliography"
    uploads = tmp_path / "uploads"
    bib.mkdir()
    uploads.mkdir()
    monkeypatch.setattr("app.knowledge.source_pdf.settings.bibliography_dir", str(bib))
    monkeypatch.setattr("app.knowledge.source_pdf.settings.upload_dir", str(uploads))
    return bib


def test_missing_pdf_returns_none(bib_root: Path):
    md = bib_root / "series" / "foo.md"
    md.parent.mkdir(parents=True)
    md.write_text("# hi", encoding="utf-8")
    doc = _doc(file_path=str(md), relative_path="series/foo.md")
    assert resolve_source_pdf(doc) is None


def test_sibling_stem_pairing(bib_root: Path):
    md = bib_root / "series" / "foo.md"
    pdf = bib_root / "series" / "foo.pdf"
    md.parent.mkdir(parents=True)
    md.write_text("# hi", encoding="utf-8")
    pdf.write_bytes(b"%PDF-1.4")
    doc = _doc(file_path=str(md), relative_path="series/foo.md")
    ref = resolve_source_pdf(doc)
    assert ref is not None
    assert ref.resolution == "sibling"
    assert ref.path == pdf.resolve()
    assert ref.relative_path == "series/foo.pdf"


def test_metadata_source_pdf_wins(bib_root: Path):
    md = bib_root / "a.md"
    sibling = bib_root / "a.pdf"
    other = bib_root / "custom.pdf"
    md.write_text("# hi", encoding="utf-8")
    sibling.write_bytes(b"%PDF-sib")
    other.write_bytes(b"%PDF-meta")
    doc = _doc(
        file_path=str(md),
        relative_path="a.md",
        extra_metadata={"source_pdf": "custom.pdf"},
    )
    ref = resolve_source_pdf(doc)
    assert ref is not None
    assert ref.resolution == "metadata"
    assert ref.path == other.resolve()


def test_self_when_document_is_pdf(bib_root: Path):
    pdf = bib_root / "direct.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    doc = _doc(file_path=str(pdf), relative_path="direct.pdf")
    ref = resolve_source_pdf(doc)
    assert ref is not None
    assert ref.resolution == "self"
