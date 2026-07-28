"""Unit tests for artifact-html / artifact-viz fence parser."""
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
    assert arts[0]["format"] == "html"


def test_extract_viz_from_markdown():
    md = """
```artifact-viz
{"title": "阶段对比", "kind": "echarts", "option": {"series": [{"type": "bar", "data": [1, 2]}]}}
```
"""
    arts = extract_artifacts_from_markdown(md)
    assert len(arts) == 1
    assert arts[0]["format"] == "viz"
    assert arts[0]["title"] == "阶段对比"
    assert arts[0]["viz"]["kind"] == "echarts"
    assert arts[0]["viz"]["option"]["series"][0]["data"] == [1, 2]


def test_extract_skips_empty():
    assert extract_artifacts_from_markdown("no fences") == []


def test_extract_skips_invalid_viz_json():
    md = """
```artifact-viz
{not json
```
"""
    assert extract_artifacts_from_markdown(md) == []


def test_incremental_fence_parser():
    p = ArtifactFenceParser()
    events: list = []
    for tok in ["前缀", "```artifact-html\n", "<p>1</p>", "\n```", "后缀"]:
        events.extend(p.feed(tok))
    assert any(e.get("type") == "artifact" for e in events)
    done = [e for e in events if e.get("status") == "done"]
    assert done and done[0]["format"] == "html"


def test_incremental_viz_emits_after_close():
    p = ArtifactFenceParser()
    events: list = []
    chunks = [
        "```artifact-viz\n",
        '{"title":"T","kind":"timeline","items":[{"time":"1935","name":"遵义"}]}',
        "\n```",
    ]
    for tok in chunks:
        events.extend(p.feed(tok))
    done = [e for e in events if e.get("status") == "done"]
    assert len(done) == 1
    assert done[0]["format"] == "viz"
    assert done[0]["viz"]["kind"] == "timeline"
