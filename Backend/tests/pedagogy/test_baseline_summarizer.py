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
            "neutral": 0.5,
            "fearful": 0.3,
            "happy": 0.15,
            "sad": 0.05,
        }
    )
    result = summarize(snap)
    assert result.has_baseline is True
    assert result.dominant_emotions == ["neutral", "fearful", "happy"]


def test_mca_negative_labels_are_stress():
    snap = _FakeSnapshot(
        emotion_distribution={"angry": 0.4, "fearful": 0.3, "sad": 0.2, "disgust": 0.1}
    )
    result = summarize(snap)
    assert result.stress_indicator == pytest.approx(1.0)
    assert result.confidence_indicator == pytest.approx(0.0)


def test_only_happy_is_confidence():
    snap = _FakeSnapshot(emotion_distribution={"happy": 0.6, "neutral": 0.3, "surprised": 0.1})
    result = summarize(snap)
    assert result.confidence_indicator == pytest.approx(0.6)
    assert result.stress_indicator == pytest.approx(0.0)


def test_neutral_voice_is_neither_stress_nor_confidence():
    result = summarize(_FakeSnapshot(emotion_distribution={"neutral": 1.0}))
    assert result.stress_indicator == pytest.approx(0.0)
    assert result.confidence_indicator == pytest.approx(0.0)


def test_shares_are_normalised_by_distribution_total():
    # MCA does not guarantee the distribution sums to 1 (it divides by the total too).
    snap = _FakeSnapshot(emotion_distribution={"fearful": 2.0, "happy": 1.0, "neutral": 1.0})
    result = summarize(snap)
    assert result.stress_indicator == pytest.approx(0.5)
    assert result.confidence_indicator == pytest.approx(0.25)


def test_labels_match_case_insensitively():
    result = summarize(_FakeSnapshot(emotion_distribution={"Angry": 0.5, "Happy": 0.5}))
    assert result.stress_indicator == pytest.approx(0.5)
    assert result.confidence_indicator == pytest.approx(0.5)


@pytest.mark.parametrize("dist", [{}, None, {"neutral": 0.0, "happy": 0.0}])
def test_no_emotion_data_gives_none_indicators(dist):
    result = summarize(_FakeSnapshot(emotion_distribution=dist))
    assert result.has_baseline is True
    assert result.stress_indicator is None
    assert result.confidence_indicator is None


def test_mca_skill_scores_scaled_to_unit_interval():
    snap = _FakeSnapshot(skill_scores={"vocal_command": 30, "speech_fluency": 70, "emotional_regulation": 100})
    result = summarize(snap)
    assert result.skill_scores == pytest.approx(
        {"vocal_command": 0.30, "speech_fluency": 0.70, "emotional_regulation": 1.0}
    )


def test_overall_score_and_duration_forwarded():
    snap = _FakeSnapshot(overall_score=72.5, duration_seconds=180)
    result = summarize(snap)
    assert result.raw_overall_score == pytest.approx(72.5)
    assert result.duration_seconds == 180
