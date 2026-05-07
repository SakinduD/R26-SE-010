"""Tests for dda_engine.initial_difficulty()."""
import pytest

from app.services.pedagogy.dda_engine import initial_difficulty
from app.services.pedagogy.types import OceanScores

INTROVERT = OceanScores(
    openness=40, conscientiousness=40, extraversion=25, agreeableness=55, neuroticism=70
)
EXTROVERT = OceanScores(
    openness=65, conscientiousness=70, extraversion=80, agreeableness=55, neuroticism=30
)
NEUTRAL = OceanScores(
    openness=50, conscientiousness=50, extraversion=50, agreeableness=50, neuroticism=50
)


def test_neutral_profile_returns_base_five():
    d, _ = initial_difficulty(NEUTRAL)
    assert d == 5


def test_high_neuroticism_lowers_difficulty():
    scores = OceanScores(
        openness=50, conscientiousness=50, extraversion=50, agreeableness=50, neuroticism=80
    )
    d, _ = initial_difficulty(scores)
    assert d < 5


def test_low_neuroticism_raises_difficulty():
    scores = OceanScores(
        openness=50, conscientiousness=50, extraversion=50, agreeableness=50, neuroticism=20
    )
    d, _ = initial_difficulty(scores)
    assert d >= 5


def test_low_extraversion_lowers_difficulty():
    scores = OceanScores(
        openness=50, conscientiousness=50, extraversion=20, agreeableness=50, neuroticism=50
    )
    d_low, _ = initial_difficulty(scores)
    d_base, _ = initial_difficulty(NEUTRAL)
    assert d_low < d_base


def test_high_openness_raises_difficulty():
    scores = OceanScores(
        openness=80, conscientiousness=50, extraversion=50, agreeableness=50, neuroticism=50
    )
    d, _ = initial_difficulty(scores)
    assert d > 5


def test_difficulty_always_in_bounds():
    for openness in (0, 50, 100):
        for neuroticism in (0, 50, 100):
            scores = OceanScores(
                openness=openness,
                conscientiousness=50,
                extraversion=50,
                agreeableness=50,
                neuroticism=neuroticism,
            )
            d, _ = initial_difficulty(scores)
            assert 1 <= d <= 10, f"difficulty {d} out of bounds for O={openness}, N={neuroticism}"


def test_rationale_is_not_empty():
    _, rationale = initial_difficulty(INTROVERT)
    assert len(rationale) >= 1


def test_introvert_starts_easier_than_extrovert():
    """THESIS support: introvert starts at lower difficulty than extrovert."""
    d_intro, _ = initial_difficulty(INTROVERT)
    d_extro, _ = initial_difficulty(EXTROVERT)
    assert d_intro < d_extro, (
        f"Introvert difficulty {d_intro} should be < extrovert difficulty {d_extro}"
    )
