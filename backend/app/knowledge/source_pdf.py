"""Resolve a knowledge Document (usually Markdown) to its original PDF when present.

Pairing contract (forward-compatible, reserved for UI/PDF viewer):
  1. ``Document.extra_metadata`` keys (first hit wins):
     ``source_pdf`` | ``original_path`` | ``original_pdf``
     Value: absolute path, or path relative to bibliography_dir / upload_dir.
  2. Self: if ``file_path`` already points at a ``.pdf`` (e.g. uploaded PDF).
  3. Sibling by stem: ``foo.md`` → ``foo.pdf`` next to the MD file
     (same directory under bibliography/ or uploads/).

MinerU batch (``docker-compose.mineru.yml``) reads ``raw/`` and writes only
``.md`` into ``bibliography/``; originals remain in ``raw/`` and are not
auto-linked unless copied beside the MD or recorded in metadata.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings
from app.db.models import Document

SOURCE_PDF_META_KEYS = ("source_pdf", "original_path", "original_pdf")


@dataclass(frozen=True)
class SourcePdfRef:
    path: Path
    relative_path: str | None
    resolution: str  # metadata | sibling | self
    mime_type: str = "application/pdf"

    @property
    def filename(self) -> str:
        return self.path.name


def _allowed_roots() -> list[Path]:
    roots: list[Path] = []
    for raw in (settings.bibliography_dir, settings.upload_dir):
        try:
            roots.append(Path(raw).resolve())
        except OSError:
            continue
    return roots


def _is_under_allowed_roots(path: Path) -> bool:
    try:
        resolved = path.resolve()
    except OSError:
        return False
    for root in _allowed_roots():
        if resolved == root or root in resolved.parents:
            return True
    return False


def _rel_under_roots(path: Path) -> str | None:
    try:
        resolved = path.resolve()
    except OSError:
        return None
    for root in _allowed_roots():
        try:
            return resolved.relative_to(root).as_posix()
        except ValueError:
            continue
    return None


def _candidate_from_string(raw: str, doc: Document) -> Path | None:
    text = raw.strip()
    if not text:
        return None
    p = Path(text)
    if p.is_absolute():
        return p if p.is_file() else None

    bases: list[Path] = [
        Path(settings.bibliography_dir),
        Path(settings.upload_dir),
        Path(settings.upload_dir) / "knowledge",
    ]
    if doc.file_path:
        bases.insert(0, Path(doc.file_path).parent)
    for base in bases:
        cand = base / p
        if cand.is_file():
            return cand
    return None


def resolve_source_pdf(doc: Document) -> SourcePdfRef | None:
    """Return a readable PDF path for *doc*, or None if unavailable."""
    meta = doc.extra_metadata if isinstance(doc.extra_metadata, dict) else {}

    for key in SOURCE_PDF_META_KEYS:
        raw = meta.get(key)
        if not isinstance(raw, str):
            continue
        cand = _candidate_from_string(raw, doc)
        if cand is None:
            continue
        if cand.suffix.lower() != ".pdf":
            continue
        if not _is_under_allowed_roots(cand):
            continue
        return SourcePdfRef(
            path=cand.resolve(),
            relative_path=_rel_under_roots(cand),
            resolution="metadata",
        )

    if doc.file_path:
        fp = Path(doc.file_path)
        if fp.is_file() and fp.suffix.lower() == ".pdf" and _is_under_allowed_roots(fp):
            return SourcePdfRef(
                path=fp.resolve(),
                relative_path=_rel_under_roots(fp) or doc.relative_path,
                resolution="self",
            )

    sibling_candidates: list[Path] = []
    if doc.file_path:
        sibling_candidates.append(Path(doc.file_path).with_suffix(".pdf"))
    if doc.relative_path:
        rel = Path(doc.relative_path)
        stem_pdf = rel.with_suffix(".pdf")
        sibling_candidates.append(Path(settings.bibliography_dir) / stem_pdf)
        sibling_candidates.append(Path(settings.upload_dir) / stem_pdf)
        sibling_candidates.append(Path(settings.upload_dir) / "knowledge" / Path(rel.name).with_suffix(".pdf"))

    seen: set[str] = set()
    for cand in sibling_candidates:
        try:
            key = str(cand.resolve()) if cand.exists() else str(cand)
        except OSError:
            key = str(cand)
        if key in seen:
            continue
        seen.add(key)
        if not cand.is_file():
            continue
        if cand.suffix.lower() != ".pdf":
            continue
        if not _is_under_allowed_roots(cand):
            continue
        return SourcePdfRef(
            path=cand.resolve(),
            relative_path=_rel_under_roots(cand),
            resolution="sibling",
        )

    return None
