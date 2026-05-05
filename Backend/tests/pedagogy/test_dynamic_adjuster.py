"""
Tests for dynamic_adjuster.adjust().

The KEY THESIS TEST is test_same_signal_different_starting_plans — it proves
that two different starting plans (introvert vs extrovert) given the same
signal end up at different endpoints, demonstrating genuine adaptation.
"""
import pytest

from app.services.pedagogy.dynamic_adjuster import adjust
from app.services.pedagogy.types import OceanScores, PerformanceSignal, TeachingStrategy

# Two starting plans representing the two demo personas
INTROVERT_PLAN = TeachingStrategy(
    tone="gentle",
    pacing="slow",
    complexity="simple",
    npc_personality="warm_supportive",
    feedback_style="encouraging",
)
EXTROVERT_PLAN = TeachingStrategy(
    tone="challenging",
    pacing="fast",
    complexity="complex",
    npc_personality="demanding_critical",
    feedback_style="blunt",
)

FAILURE_HIGH_STRESS = PerformanceSignal(
    engagement_score=0.4,
    confidence_score=0.3,
    objective_completion_rate=0.0,
    stress_level=0.8,
    outcome="failure",
)
SUCCESS_LOW_STRESS = PerformanceSignal(
    engagement_score=0.9,
    confidence_score=0.9,
    objective_completion_rate=0.9,
    stress_level=0.1,
    outcome="success",
)
NEUTRAL = PerformanceSignal(
    engagement_score=0.5,
    confidence_score=0.6,
    objective_completion_rate=0.5,
    stress_level=0.4,
    outcome="partial",
)


def test_failure_high_stress_lowers_difficulty():
    result = adjust(EXTROVERT_PLAN, 7, FAILURE_HIGH_STRESS)
    assert result.new_difficulty < 7


def test_failure_high_stress_softens_tone():
    result = adjust(EXTROVERT_PLAN, 7, FAILURE_HIGH_STRESS)
    assert result.new_strategy.feedback_style == "encouraging"


def test_strong_success_raises_difficulty():
    result = adjust(INTROVERT_PLAN, 3, SUCCESS_LOW_STRESS)
    assert result.new_difficulty > 3


def test_strong_success_increases_complexity():
    from app.services.pedagogy.types import COMPLEXITY_ORDER
    result = adjust(INTROVERT_PLAN, 3, SUCCESS_LOW_STRESS)
    old_idx = COMPLEXITY_ORDER.index(INTROVERT_PLAN.complexity)
    new_idx = COMPLEXITY_ORDER.index(result.new_strategy.complexity)
    assert new_idx >= old_idx


def test_low_confidence_yields_warm_npc():
    low_conf = PerformanceSignal(
        engagement_score=0.5, confidence_score=0.2,
        objective_completion_rate=0.5, stress_level=0.3, outcome="partial"
    )
    result = adjust(EXTROVERT_PLAN, 5, low_conf)
    assert result.new_strategy.npc_personality == "warm_supportive"
    assert result.new_strategy.feedback_style == "encouraging"


def test_neutral_signal_no_change():
    result = adjust(INTROVERT_PLAN, 5, NEUTRAL)
    assert result.new_difficulty == 5
    assert "No adjustment criteria met" in result.rationale[0]


def test_lightweight_preserves_strategy():
    result = adjust(EXTROVERT_PLAN, 7, FAILURE_HIGH_STRESS, mode="lightweight")
    assert result.new_strategy.tone == EXTROVERT_PLAN.tone
    assert result.new_strategy.pacing == EXTROVERT_PLAN.pacing
    assert result.new_strategy.complexity == EXTROVERT_PLAN.complexity


def test_lightweight_caps_difficulty_delta_at_one():
    result = adjust(INTROVERT_PLAN, 5, SUCCESS_LOW_STRESS, mode="lightweight")
    assert abs(result.new_difficulty - 5) <= 1


def test_difficulty_always_clamped():
    # Even if multiple rules fire, difficulty stays in [1, 10]
    result = adjust(EXTROVERT_PLAN, 1, FAILURE_HIGH_STRESS)
    assert result.new_difficulty >= 1
    result2 = adjust(INTROVERT_PLAN, 10, SUCCESS_LOW_STRESS)
    assert result2.new_difficulty <= 10


def test_rationale_mentions_trigger():
    result = adjust(EXTROVERT_PLAN, 7, FAILURE_HIGH_STRESS)
    assert any("failure" in r.lower() for r in result.rationale)


# ---- THESIS TEST -----------------------------------------------------------

def test_same_signal_different_starting_plans():
    """
    THESIS: Same failure signal applied to two different starting plans yields
    different outcomes, because adjustment is anchored to the current state.

    Introvert starts at difficulty 3; extrovert at 7.
    Both receive FAILURE_HIGH_STRESS.
    Both drop by 1 (Rule 1), but end at different absolute values — proving
    the loop is adaptive, not a one-size-fits-all reset.
    """
    intro_result = adjust(INTROVERT_PLAN, 3, FAILURE_HIGH_STRESS)
    extro_result = adjust(EXTROVERT_PLAN, 7, FAILURE_HIGH_STRESS)

    # Both soften, but from different baselines
    assert intro_result.new_difficulty < 3
    assert extro_result.new_difficulty < 7

    # Extrovert ends at a higher difficulty than introvert — they're still different
    assert extro_result.new_difficulty > intro_result.new_difficulty, (
        f"Expected extrovert difficulty {extro_result.new_difficulty} > "
        f"introvert difficulty {intro_result.new_difficulty}"
    )
