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
    """
    One live coaching nudge from MCA's audio analyser: the `metrics` object of
    an audio WebSocket frame whose nudge_category is set. Extra frame fields
    (speaking, detections, ...) are ignored.

    emotion is None when the learner wasn't speaking in that chunk; MCA then
    sends confidence 0.0, which is not an emotion reading.
    """

    emotion: str | None = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    nudge: str | None = None
    nudge_category: NudgeCategory
    nudge_severity: NudgeSeverity
