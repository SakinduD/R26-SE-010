"""
MCA integration contracts, mirroring the audio WebSocket `metrics` payload
and the Nudge dataclass. APM receives these via its own live-signals endpoint
rather than reading MCA's WebSocket.
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
    """One live coaching nudge from MCA's audio analyser."""

    emotion: str
    confidence: float = Field(ge=0.0, le=1.0)
    nudge: str | None = None
    nudge_category: NudgeCategory
    nudge_severity: NudgeSeverity
