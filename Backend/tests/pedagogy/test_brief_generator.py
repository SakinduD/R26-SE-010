"""
Tests for brief_generator.generate_brief().
"""
import pytest

from app.services.pedagogy.brief_generator import generate_brief
from app.services.pedagogy.types import BaselineSummary, OceanScores, TeachingStrategy

_MID_STRATEGY = TeachingStrategy(
    tone="direct",
    pacing="moderate",
    complexity="moderate",
    npc_personality="professional",
    feedback_style="balanced",
)

_MID_SCORES = OceanScores(
    openness=50, conscientiousness=50, extraversion=50,
    agreeableness=50, neuroticism=50,
)


def _baseline(**kwargs) -> BaselineSummary:
    return BaselineSummary(has_baseline=True, **kwargs)


# ---- Structure -----------------------------------------------------------------

def test_brief_has_all_required_fields():
    brief = generate_brief(_MID_SCORES, _MID_STRATEGY, None, 5)
    assert brief.summary
    assert isinstance(brief.drivers, list)
    assert isinstance(brief.strategy_highlights, list)
    assert brief.difficulty_rationale
    assert isinstance(brief.priority_skills, list)
    assert isinstance(brief.has_baseline_evidence, bool)


def test_strategy_highlights_has_five_entries():
    brief = generate_brief(_MID_SCORES, _MID_STRATEGY, None, 5)
    assert len(brief.strategy_highlights) == 5


# ---- has_baseline_evidence flag -----------------------------------------------

def test_no_baseline_sets_flag_false():
    brief = generate_brief(_MID_SCORES, _MID_STRATEGY, None, 5)
    assert brief.has_baseline_evidence is False


def test_with_baseline_sets_flag_true():
    brief = generate_brief(_MID_SCORES, _MID_STRATEGY, _baseline(), 5)
    assert brief.has_baseline_evidence is True


# ---- OCEAN driver detection ---------------------------------------------------

def test_high_neuroticism_driver_present():
    scores = OceanScores(
        openness=50, conscientiousness=50, extraversion=50,
        agreeableness=50, neuroticism=75,
    )
    brief = generate_brief(scores, _MID_STRATEGY, None, 3)
    assert any("stress-sensitivity" in d for d in brief.drivers)


def test_low_extraversion_driver_present():
    scores = OceanScores(
        openness=50, conscientiousness=50, extraversion=25,
        agreeableness=50, neuroticism=50,
    )
    brief = generate_brief(scores, _MID_STRATEGY, None, 4)
    assert any("Introvert" in d for d in brief.drivers)


def test_mid_range_produces_fallback_driver():
    brief = generate_brief(_MID_SCORES, _MID_STRATEGY, None, 5)
    assert any("mid-range" in d.lower() or "default" in d.lower() for d in brief.drivers)


# ---- Baseline driver detection ------------------------------------------------

def test_high_stress_indicator_adds_driver():
    brief = generate_brief(
        _MID_SCORES, _MID_STRATEGY, _baseline(stress_indicator=0.75), 5
    )
    assert any("stress" in d.lower() for d in brief.drivers)


def test_low_confidence_indicator_adds_driver():
    brief = generate_brief(
        _MID_SCORES, _MID_STRATEGY, _baseline(confidence_indicator=0.2), 5
    )
    assert any("confidence" in d.lower() for d in brief.drivers)


def test_baseline_weak_skills_add_driver():
    brief = generate_brief(
        _MID_SCORES,
        _MID_STRATEGY,
        _baseline(skill_scores={"assertiveness": 0.3}),
        5,
    )
    assert any("assertiveness" in d for d in brief.drivers)


# ---- Difficulty band ----------------------------------------------------------

def test_difficulty_rationale_beginner():
    brief = generate_brief(_MID_SCORES, _MID_STRATEGY, None, 3)
    assert "beginner" in brief.difficulty_rationale.lower()


def test_difficulty_rationale_advanced():
    brief = generate_brief(_MID_SCORES, _MID_STRATEGY, None, 9)
    assert "advanced" in brief.difficulty_rationale.lower()


# ---- Priority skills forwarded ------------------------------------------------

def test_priority_skills_forwarded_from_strategy():
    strategy = TeachingStrategy(
        tone="gentle",
        pacing="slow",
        complexity="simple",
        npc_personality="warm_supportive",
        feedback_style="encouraging",
        priority_skills=["assertiveness", "boundary_setting"],
    )
    brief = generate_brief(_MID_SCORES, strategy, None, 3)
    assert brief.priority_skills == ["assertiveness", "boundary_setting"]
