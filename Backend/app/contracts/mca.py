"""
MCA (Multimodal Communication Analysis) integration contracts.

Mirrors shape from:
  - Backend/app/api/v1/mca/audio.py        (outbound WS payload structure)
  - Backend/app/api/v1/mca/base_types.py:22-27 (Nudge dataclass)

SCHEMA_VERSION = 1

APM does NOT consume MCA's WebSocket directly (their auth is a hardcoded
token, not our JWT). Instead APM exposes POST /api/v1/pedagogy/signals/live
which accepts a list of these McaNudge payloads — that lets the May-08 demo
POST simulated nudges and prove the live-adjustment loop without coupling to
MCA's auth scheme.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = 1

NudgeCategory = Literal[
    "volume",
    "pitch",
    "pace",
    "clarity",
    "fusion",
    "silence",
    "ser",
]
NudgeSeverity = Literal["info", "warning", "critical"]


class McaNudge(BaseModel):
    """
    Single live coaching nudge from MCA's audio analyser.

    Source:
      - Backend/app/api/v1/mca/audio.py outbound `metrics` block
      - Backend/app/api/v1/mca/base_types.py::Nudge (lines 22-27)
    """

    emotion: str
    confidence: float = Field(ge=0.0, le=1.0)
    nudge: str | None = None
    nudge_category: NudgeCategory
    nudge_severity: NudgeSeverity
