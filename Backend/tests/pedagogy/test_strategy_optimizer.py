"""
Tests for strategy_optimizer.optimize_strategy().

The KEY THESIS TEST is test_two_personas_produce_different_strategies — it proves
that an introvert (high N, low E) and an extrovert (low N, high E) receive
meaningfully different teaching strategies from the same engine.
"""
import pytest

from app.services.pedagogy.strategy_optimizer import optimize_strategy
from app.services.pedagogy.types import BaselineSummary, OceanScores

# Two demo personas for the May-08 presentation
INTROVERT = OceanScores(
    openness=40, conscientiousness=40, extraversion=25, agreeableness=55, neuroticism=70
)
EXTROVERT = OceanScores(
    openness=65, conscientiousness=70, extraversion=80, agreeableness=55, neuroticism=30
)


def test_high_neuroticism_yields_gentle_tone():
    strategy = optimize_strategy(INTROVERT)
    assert strategy.tone == "gentle"


def test_high_neuroticism_yields_encouraging_feedback():
    strategy = optimize_strategy(INTROVERT)
    assert strategy.feedback_style == "encouraging"


def test_high_extraversion_yields_non_gentle_tone():
    strategy = optimize_strategy(EXTROVERT)
    assert strategy.tone != "gentle"


def test_high_conscientiousness_yields_faster_pacing():
    scores = OceanScores(
        openness=50, conscientiousness=80, extraversion=50, agreeableness=50, neuroticism=30
    )
    strategy = optimize_strategy(scores)
    assert strategy.pacing in ("moderate", "fast")


def test_neuroticism_overrides_low_agreeableness():
    """Safety > debate: high N must override the debate-friendly strategy for low A."""
    scores = OceanScores(
        openness=50, conscientiousness=50, extraversion=50, agreeableness=20, neuroticism=80
    )
    strategy = optimize_strategy(scores)
    assert strategy.tone == "gentle"
    assert strategy.feedback_style == "encouraging"


def test_rationale_is_not_empty():
    strategy = optimize_strategy(EXTROVERT)
    assert len(strategy.rationale) >= 1


# ---- THESIS TEST -----------------------------------------------------------

def test_two_personas_produce_different_strategies():
    """
    THESIS: Introvert and extrovert must receive different strategies.

    Introvert (E=25, N=70) should get a gentler, slower, simpler plan than
    Extrovert (E=80, N=30). At minimum tone and feedback_style must differ.
    """
    intro_s = optimize_strategy(INTROVERT)
    extro_s = optimize_strategy(EXTROVERT)

    assert intro_s.tone != extro_s.tone, (
        f"Expected different tones; both got {intro_s.tone!r}"
    )
    assert intro_s.feedback_style != extro_s.feedback_style, (
        f"Expected different feedback styles; both got {intro_s.feedback_style!r}"
    )
    # Intro NPC should be gentler than extro NPC
    from app.services.pedagogy.types import NPC_ORDER
    assert NPC_ORDER.index(intro_s.npc_personality) < NPC_ORDER.index(
        extro_s.npc_personality
    ), "Introvert NPC must be gentler (lower index) than extrovert NPC"


# ---- BASELINE TESTS --------------------------------------------------------

_MID_RANGE = OceanScores(
    openness=50, conscientiousness=50, extraversion=50, agreeableness=50, neuroticism=50
)


def _baseline(**kwargs) -> BaselineSummary:
    return BaselineSummary(has_baseline=True, **kwargs)


def test_baseline_high_stress_softens_tone_regardless_of_N():
    """stress_indicator > 0.6 must soften tone one step even when N is low."""
    scores = OceanScores(
        openness=50, conscientiousness=50, extraversion=50, agreeableness=50, neuroticism=25
    )
    no_baseline = optimize_strategy(scores)
    assert no_baseline.tone == "challenging"  # confirm baseline-free result

    with_baseline = optimize_strategy(scores, baseline=_baseline(stress_indicator=0.7))
    from app.services.pedagogy.types import TONE_ORDER
    assert TONE_ORDER.index(with_baseline.tone) < TONE_ORDER.index(no_baseline.tone), (
        f"Expected softer tone than {no_baseline.tone!r}, got {with_baseline.tone!r}"
    )


def test_baseline_low_confidence_overrides_npc_choice():
    """confidence_indicator < 0.3 must force npc to warm_supportive."""
    scores = OceanScores(
        openness=50, conscientiousness=75, extraversion=75, agreeableness=20, neuroticism=25
    )
    no_baseline = optimize_strategy(scores)
    assert no_baseline.npc_personality != "warm_supportive"  # confirm OCEAN drives demanding NPC

    with_baseline = optimize_strategy(scores, baseline=_baseline(confidence_indicator=0.2))
    assert with_baseline.npc_personality == "warm_supportive"


def test_baseline_low_skill_score_appears_in_priority_skills():
    """skill_scores with a value < 0.4 must populate priority_skills."""
    result = optimize_strategy(
        _MID_RANGE,
        baseline=_baseline(skill_scores={"assertiveness": 0.3, "accountability": 0.8}),
    )
    assert "assertiveness" in result.priority_skills
    assert "accountability" not in result.priority_skills


def test_no_baseline_produces_identical_strategy_to_before():
    """Passing baseline=None must be byte-identical to calling without the arg."""
    without = optimize_strategy(_MID_RANGE)
    with_none = optimize_strategy(_MID_RANGE, baseline=None)
    assert without.model_dump() == with_none.model_dump()
