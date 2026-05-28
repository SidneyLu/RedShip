"""语义分块：父子块策略供混合检索使用。

- 父块约 5–7k 字，对齐 Section 边界，存 Postgres
- 子块约 5k 字，embed 后写入 Milvus
- 检索时用子块命中，回答时回溯父块全文作为 LLM 上下文
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

from app.knowledge.ingestion.parser import ParsedDocument, Section


PARENT_TARGET = 5500
PARENT_MAX = 7000
CHILD_TARGET = 5500
CHILD_OVERLAP = 0


_SENT_SPLIT_RE = re.compile(
    r"(?<=[。！？!?\.;；])(?=\s|[^\d])"  # Chinese / English sentence enders
)


def split_sentences(text: str) -> list[str]:
    text = text.strip().replace("\r", "")
    if not text:
        return []
    parts = _SENT_SPLIT_RE.split(text)
    parts = [p.strip() for p in parts if p.strip()]
    if not parts:
        return [text]
    return parts


def _coalesce(sentences: list[str], target: int, hard_max: int | None = None) -> list[str]:
    """按目标字数贪心合并句子为块。"""
    chunks: list[str] = []
    buf: list[str] = []
    buf_len = 0
    limit = hard_max or int(target * 1.4)
    for s in sentences:
        if buf and buf_len + len(s) > limit:
            chunks.append("".join(buf).strip())
            buf = [s]
            buf_len = len(s)
        else:
            buf.append(s)
            buf_len += len(s)
            if buf_len >= target:
                chunks.append("".join(buf).strip())
                buf = []
                buf_len = 0
    if buf:
        chunks.append("".join(buf).strip())
    return [c for c in chunks if c]


def _make_child_chunks(parent_text: str) -> list[str]:
    sentences = split_sentences(parent_text)
    if not sentences:
        return []
    chunks = _coalesce(sentences, CHILD_TARGET, hard_max=int(CHILD_TARGET * 1.6))
    if len(chunks) <= 1 or CHILD_OVERLAP <= 0:
        return chunks
    # Apply tail-overlap to subsequent chunks for continuity
    overlapped: list[str] = [chunks[0]]
    for c in chunks[1:]:
        prev_tail = overlapped[-1][-CHILD_OVERLAP:]
        overlapped.append(prev_tail + c)
    return overlapped


@dataclass
class ChildChunk:
    text: str
    parent_index: int
    child_index_in_parent: int
    heading_path: str


@dataclass
class ParentChunk:
    text: str
    parent_index: int
    heading_path: str
    children: list[ChildChunk] = field(default_factory=list)
    metadata: dict[str, str] = field(default_factory=dict)


def chunk_document(doc: ParsedDocument) -> list[ParentChunk]:
    """Build a flat list of parent chunks (each with its children)."""
    parents: list[ParentChunk] = []
    counter = 0
    for section in doc.sections:
        sentences = split_sentences(section.text)
        sec_chunks = _coalesce(sentences, PARENT_TARGET, hard_max=PARENT_MAX) or [section.text]
        for chunk_text in sec_chunks:
            children_text = _make_child_chunks(chunk_text)
            children = [
                ChildChunk(
                    text=ct,
                    parent_index=counter,
                    child_index_in_parent=i,
                    heading_path=section.heading_path,
                )
                for i, ct in enumerate(children_text)
            ]
            parents.append(
                ParentChunk(
                    text=chunk_text,
                    parent_index=counter,
                    heading_path=section.heading_path,
                    children=children,
                    metadata=section.metadata,
                )
            )
            counter += 1
    return parents


def flatten_children(parents: Iterable[ParentChunk]) -> list[ChildChunk]:
    out: list[ChildChunk] = []
    for p in parents:
        out.extend(p.children)
    return out
