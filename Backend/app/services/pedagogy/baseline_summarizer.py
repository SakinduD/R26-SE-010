"""
Baseline summarizer — pure function, no I/O, no DB.

Converts a BaselineSnapshot ORM row into a BaselineSummary that the rest of
the pedagogy pipeline (strategy_optimizer, dda_engine, adapter) can consume
without knowing anything about how the snapshot was stored.

The snapshot holds exactly what MCA stores for the session:
  skill_scores          0-100 integers (vocal_command, speech_fluency,
                        presence_engagement, emotional_regulation)
  emotion_distribution  weights per SER label (neutral, happy, sad, angry,
                        fearful, disgust, surprised); not guaranteed to sum to 1
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from app.services.pedagogy.types import BaselineSummary

if TYPE_CHECKING:
    from app.models.baseline_snapshot import BaselineSnapshot

# MCA skill scores are 0-100; the pedagogy rules work on 0.0-1.0. This is a
# skill-score conversion, NOT an OCEAN conversion — adapter.py's single-site
# rule is about personality scores only.
_SKILL_SCORE_SCALE = 100.0

# MCA's valence split of its SER labels (see app/api/v1/mca/scoring.py).
# neutral and surprised carry no valence, so they count towards neither.
_STRESS_EMOTIONS: frozenset[str] = frozenset({"angry", "fearful", "sad", "disgust"})
_CONFIDENCE_EMOTIONS: frozenset[str] = frozenset({"happy"})


def _emotion_share(dist: dict[str, float], labels: frozenset[str], total: float) -> float:
    return min(1.0, sum(v for k, v in dist.items() if str(k).lower() in labels) / total)


def summarize(snapshot: "BaselineSnapshot | None") -> BaselineSummary:
    """
    Distil a BaselineSnapshot into a BaselineSummary for the pedagogy pipeline.

    Returns has_baseline=False with all other fields None when snapshot is None,
    so callers can always treat the return value uniformly. stress_indicator
    and confidence_indicator are None when the session recorded no emotion,
    so the baseline emotion rules are skipped instead of reading "no data" as
    "no confidence".
    """
    if snapshot is None:
        return BaselineSummary(has_baseline=False)

    emotion_dist: dict[str, float] = {
        k: float(v) for k, v in (snapshot.emotion_distribution or {}).items()
        if v is not None
    }
    total = sum(v for v in emotion_dist.values() if v > 0)

    # Top-3 emotions by frequency (descending value)
    dominant_emotions: list[str] = sorted(
        emotion_dist, key=lambda k: emotion_dist[k], reverse=True
    )[:3]

    stress_indicator: Optional[float] = None
    confidence_indicator: Optional[float] = None
    if total > 0:
        stress_indicator = _emotion_share(emotion_dist, _STRESS_EMOTIONS, total)
        confidence_indicator = _emotion_share(emotion_dist, _CONFIDENCE_EMOTIONS, total)

    skill_scores: dict[str, float] | None = (
        {k: float(v) / _SKILL_SCORE_SCALE for k, v in snapshot.skill_scores.items()}
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
