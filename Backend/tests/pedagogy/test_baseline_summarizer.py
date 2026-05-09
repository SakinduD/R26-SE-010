"""
Tests for baseline_summarizer.summarize().
"""
import pytest

from app.services.pedagogy.baseline_summarizer import summarize
from app.services.pedagogy.types import BaselineSummary


class _FakeSnapshot:
    """Minimal stand-in for BaselineSnapshot ORM row (no DB required)."""

    def __init__(
        self,
        skill_scores=None,
        emotion_distribution=None,
        overall_score=None,
        duration_seconds=None,
    ):
        self.skill_scores = skill_scores
        self.emotion_distribution = emotion_distribution or {}
        self.overall_score = overall_score
        self.duration_seconds = duration_seconds


def test_none_snapshot_yields_has_baseline_false():
    result = summarize(None)
    assert result.has_baseline is False
    assert result.skill_scores is None
    assert result.dominant_emotions is None
    assert result.stress_indicator is None
    assert result.confidence_indicator is None


def test_dominant_emotions_top_3():
    snap = _FakeSnapshot(
        emotion_distribution={
            "calm": 0.5,
            "anxious": 0.3,
            "happy": 0.15,
            "fearful": 0.05,
        }
    )
    result = summarize(snap)
    assert result.has_baseline is True
    assert result.dominant_emotions == ["calm", "anxious", "happy"]


def test_stress_indicator_clamped():
    # All weight in stress emotions — should clamp at 1.0
    snap = _FakeSnapshot(
        emotion_distribution={
            "anxious": 0.5,
            "fearful": 0.3,
            "stressed": 0.25,  # sum > 1.0 before clamp
        }
    )
    result = summarize(snap)
    assert result.stress_indicator == 1.0


def test_confidence_indicator_clamped():
    snap = _FakeSnapshot(
        emotion_distribution={
            "confident": 0.6,
            "calm": 0.5,  # sum > 1.0 before clamp
        }
    )
    result = summarize(snap)
    assert result.confidence_indicator == 1.0


def test_stress_and_confidence_computed_separately():
    snap = _FakeSnapshot(
        emotion_distribution={
            "anxious": 0.4,
            "calm": 0.35,
            "neutral": 0.25,
        }
    )
    result = summarize(snap)
    assert abs(result.stress_indicator - 0.4) < 1e-9
    assert abs(result.confidence_indicator - 0.60) < 1e-9


def test_skill_scores_copied():
    snap = _FakeSnapshot(skill_scores={"assertiveness": 0.3, "accountability": 0.7})
    result = summarize(snap)
    assert result.skill_scores == {"assertiveness": 0.3, "accountability": 0.7}


def test_overall_score_and_duration_forwarded():
    snap = _FakeSnapshot(overall_score=72.5, duration_seconds=180)
    result = summarize(snap)
    assert result.raw_overall_score == pytest.approx(72.5)
    assert result.duration_seconds == 180
