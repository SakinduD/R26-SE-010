"""
Baseline summarizer — pure function, no I/O, no DB.

Converts a BaselineSnapshot ORM row into a BaselineSummary that the rest of
the pedagogy pipeline (strategy_optimizer, dda_engine, adapter) can consume
without knowing anything about how the snapshot was stored.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from app.services.pedagogy.types import BaselineSummary

if TYPE_CHECKING:
    from app.models.baseline_snapshot import BaselineSnapshot

# Emotions that indicate stress / nervousness
_STRESS_EMOTIONS: frozenset[str] = frozenset(
    {"anxious", "fearful", "stressed", "nervous", "sad"}
)

# Emotions that indicate confidence / composure
_CONFIDENCE_EMOTIONS: frozenset[str] = frozenset(
    {"confident", "calm", "happy", "neutral"}
)


def summarize(snapshot: "BaselineSnapshot | None") -> BaselineSummary:
    """
    Distil a BaselineSnapshot into a BaselineSummary for the pedagogy pipeline.

    Returns has_baseline=False with all other fields None when snapshot is None,
    so callers can always treat the return value uniformly.
    """
    if snapshot is None:
        return BaselineSummary(has_baseline=False)

    emotion_dist: dict[str, float] = snapshot.emotion_distribution or {}

    # Top-3 emotions by frequency (descending value)
    dominant_emotions: list[str] = sorted(
        emotion_dist, key=lambda k: emotion_dist[k], reverse=True
    )[:3]

    # Stress indicator: sum of stress-related emotion proportions, clamped 0-1
    stress_indicator: float = min(
        1.0,
        sum(v for k, v in emotion_dist.items() if k in _STRESS_EMOTIONS),
    )

    # Confidence indicator: sum of positive-composure proportions, clamped 0-1
    confidence_indicator: float = min(
        1.0,
        sum(v for k, v in emotion_dist.items() if k in _CONFIDENCE_EMOTIONS),
    )

    # skill_scores copied as-is (MCA float values, typically 0-1)
    skill_scores: dict[str, float] | None = (
        {k: float(v) for k, v in snapshot.skill_scores.items()}
        if snapshot.skill_scores
        else None
    )

    return BaselineSummary(
        has_baseline=True,
        skill_scores=skill_scores,
        dominant_emotions=dominant_emotions if dominant_emotions else None,
        stress_indicator=stress_indicator,
        confidence_indicator=confidence_indicator,
        duration_seconds=snapshot.duration_seconds,
        raw_overall_score=(
            float(snapshot.overall_score)
            if snapshot.overall_score is not None
            else None
        ),
    )
