"""Isolate unit tests from optional native deps without full requirements install."""
from __future__ import annotations

import sys
from unittest.mock import MagicMock

for _mod in ("pymilvus", "dashscope"):
    sys.modules.setdefault(_mod, MagicMock())
