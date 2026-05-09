"""
Shared Pydantic types for the Adaptive Pedagogical Module.

Internal scale: OCEAN scores are 0-100 here. Conversion to RPE's 0.0-1.0 scale
happens ONLY in adapter.py — never sprinkle /100 anywhere else.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

# ----- enum-like ordered literals (used by dynamic_adjuster._step) -----------

Tone = Literal["gentle", "direct", "challenging"]
TONE_ORDER: list[Tone] = ["gentle", "direct", "challenging"]

Pacing = Literal["slow", "moderate", "fast"]
PACING_ORDER: list[Pacing] = ["slow", "moderate", "fast"]

Complexity = Literal["simple", "moderate", "complex"]
COMPLEXITY_ORDER: list[Complexity] = ["simple", "moderate", "complex"]

NpcPersonality = Literal[
    "warm_supportive",
    "professional",
    "demanding_critical",
    "analytical_probing",
]
# Order chosen so "softer" NPCs sit at the start; _step(-1) makes things gentler.
NPC_ORDER: list[NpcPersonality] = [
    "warm_supportive",
    "professional",
    "demanding_critical",
    "analytical_probing",
]

FeedbackStyle = Literal["encouraging", "balanced", "blunt"]
FEEDBACK_ORDER: list[FeedbackStyle] = ["encouraging", "balanced", "blunt"]

Outcome = Literal["success", "partial", "failure"]


# ----- pedagogy-internal Pydantic models ------------------------------------


class OceanScores(BaseModel):
    """OCEAN trait scores on the 0-100 internal APM scale."""

    openness: float = Field(ge=0.0, le=100.0)
    conscientiousness: float = Field(ge=0.0, le=100.0)
    extraversion: float = Field(ge=0.0, le=100.0)
    agreeableness: float = Field(ge=0.0, le=100.0)
    neuroticism: float = Field(ge=0.0, le=100.0)


class TeachingStrategy(BaseModel):
    """
    Output of strategy_optimizer. Drives NPC behaviour and feedback presentation.
    rationale lists one entry per OCEAN trait that influenced any choice.
    priority_skills is populated when a baseline is available; empty otherwise.
    """

    tone: Tone
    pacing: Pacing
    complexity: Complexity
    npc_personality: NpcPersonality
    feedback_style: FeedbackStyle
    rationale: list[str] = Field(default_factory=list)
    priority_skills: list[str] = Field(default_factory=list)


class BaselineSummary(BaseModel):
    """
    Distilled view of a BaselineSnapshot for the pedagogy pipeline.
    Produced by baseline_summarizer.summarize(); consumed by strategy_optimizer,
    dda_engine, and adapter. All fields except has_baseline are None when no
    baseline exists.
    """

    has_baseline: bool
    skill_scores: Optional[dict[str, float]] = None
    dominant_emotions: Optional[list[str]] = None   # top-3 by frequency
    stress_indicator: Optional[float] = None         # 0-1, sum of anxious/fearful/etc.
    confidence_indicator: Optional[float] = None     # 0-1, sum of calm/confident/etc.
    duration_seconds: Optional[int] = None
    raw_overall_score: Optional[float] = None


class PerformanceSignal(BaseModel):
    """
    Normalised, all-on-0-to-1 performance signal. The aggregator produces this
    from RPE FeedbackResponse and/or MCA nudges; dynamic_adjuster consumes it.
    """

    engagement_score: float = Field(ge=0.0, le=1.0)
    confidence_score: float = Field(ge=0.0, le=1.0)
    objective_completion_rate: float = Field(ge=0.0, le=1.0)
    stress_level: float = Field(ge=0.0, le=1.0)
    outcome: Outcome


class PersonalizationBrief(BaseModel):
    """
    Human-readable explanation of why the user received a particular plan.
    Produced by brief_generator.generate_brief(); stored as plan.brief_json.
    Designed to surface in the UI so users understand their personalised path.
    """

    summary: str
    drivers: list[str]
    strategy_highlights: list[str]
    difficulty_rationale: str
    priority_skills: list[str]
    has_baseline_evidence: bool


class AdjustmentResult(BaseModel):
    """Output of dynamic_adjuster.adjust()."""

    new_strategy: TeachingStrategy
    new_difficulty: int = Field(ge=1, le=10)
    rationale: list[str]
    signals_summary: dict
