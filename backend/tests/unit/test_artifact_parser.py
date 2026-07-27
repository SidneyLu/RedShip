"""Unit tests for artifact-html fence parser."""
from __future__ import annotations

import pytest

from app.agents.research.artifact_parser import ArtifactFenceParser, extract_artifacts_from_markdown

pytestmark = pytest.mark.unit


def test_extract_artifacts_from_markdown():
    md = """报告正文

```artifact-html
<!-- title: 时间线 -->
<div>ok</div>
```
"""
    arts = extract_artifacts_from_markdown(md)
    assert len(arts) == 1
    assert arts[0]["title"] == "时间线"
    assert "<div>ok</div>" in arts[0]["code"]
    assert arts[0]["status"] == "done"


def test_extract_skips_empty():
    assert extract_artifacts_from_markdown("no fences") == []


def test_incremental_fence_parser():
    p = ArtifactFenceParser()
    events: list = []
    for tok in ["前缀", "```artifact-html\n", "<p>1</p>", "\n```", "后缀"]:
        events.extend(p.feed(tok))
    assert any(e.get("type") == "artifact" for e in events)
