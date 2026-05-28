from __future__ import annotations

import zipfile
from pathlib import Path

from sqlalchemy.orm import Session

from app.db.models import BaseCorpusChunk


TEXT_EXTENSIONS = {'.md', '.txt'}


def _chunks(text: str, chunk_size: int = 1400, overlap: int = 200):
    if not text:
        return
    step = max(1, chunk_size - overlap)
    for start in range(0, len(text), step):
        yield text[start : start + chunk_size]


def ingest_downloads_zip(
    db: Session,
    zip_path: Path,
    max_files: int | None = None,
    max_chunks: int | None = None,
) -> dict:
    if not zip_path.exists():
        return {'ingested': 0, 'reason': f'zip not found: {zip_path}'}

    db.query(BaseCorpusChunk).delete()
    db.commit()

    ingested_files = 0
    ingested_chunks = 0

    with zipfile.ZipFile(zip_path, 'r') as zf:
        entries = [e for e in zf.infolist() if Path(e.filename).suffix.lower() in TEXT_EXTENSIONS]
        for entry in entries:
            if (max_files is not None and ingested_files >= max_files) or (
                max_chunks is not None and ingested_chunks >= max_chunks
            ):
                break
            try:
                text = zf.read(entry.filename).decode('utf-8', errors='ignore')
            except Exception:
                continue

            if not text.strip():
                continue

            chunk_idx = 0
            for chunk in _chunks(text):
                if max_chunks is not None and ingested_chunks >= max_chunks:
                    break
                row = BaseCorpusChunk(source_path=entry.filename, chunk_index=chunk_idx, content=chunk)
                db.add(row)
                ingested_chunks += 1
                chunk_idx += 1

            ingested_files += 1

    db.commit()
    return {'ingested_files': ingested_files, 'ingested_chunks': ingested_chunks}


def ensure_base_corpus_seeded(db: Session, zip_path: Path) -> None:
    count = db.query(BaseCorpusChunk).count()
    if count > 0:
        return
    ingest_downloads_zip(db, zip_path=zip_path, max_files=None, max_chunks=None)
