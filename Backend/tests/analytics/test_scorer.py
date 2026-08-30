"""Critical-path unit tests for the BFI-44 scorer."""

import pytest

from app.services.survey.scorer import interpret_score, score_bfi44


def _all_answers(value: int) -> dict[int, int]:
    return {i: value for i in range(1, 45)}


# ---------------------------------------------------------------------------
# score_bfi44
# ---------------------------------------------------------------------------


def test_all_neutral_threes_gives_50():
    """All 44 answers = 3 → every trait exactly 50.0.

    Reverse items: adjusted = 6 - 3 = 3 (same as non-reverse), so all adjusted
    scores are 3. avg=3, normalized=((3-1)/4)*100=50.0.
    """
    scores = score_bfi44(_all_answers(3))
    for trait, val in scores.items():
        assert val == pytest.approx(50.0), f"{trait} expected 50.0, got {val}"


def test_reverse_scoring_is_applied():
    """All answers = 5 → traits with reverse items are NOT 100.

    Non-reverse items get adjusted=5 (max), but reverse items get adjusted=1.
    Extraversion has 3 reverse (Q6, Q21, Q31) + 5 forward → avg=3.5 → 62.5.
    """
    scores = score_bfi44(_all_answers(5))
    # If reverse scoring were absent, every trait would be 100.0.
    # With reverse scoring, all traits are mixed → none reaches 100.
    for trait, val in scores.items():
        assert val != pytest.approx(100.0), (
            f"{trait}={val}: reverse scoring should prevent a score of 100"
        )
    # Spot-check Extraversion: (3*1 + 5*5)/8 = 3.5 → 62.5
    assert scores["extraversion"] == pytest.approx(62.5, abs=0.1)


def test_all_ones_with_all_reverse_would_be_100():
    """All answers = 1 → reverse items get adjusted=5, confirming 6-raw formula.

    Extraversion (3 reverse, 5 forward) with all answers=1:
      adjusted_reverse = 5, adjusted_forward = 1
      avg = (3*5 + 5*1)/8 = 2.5
      normalized = ((2.5-1)/4)*100 = 37.5
    If all 8 E items were reverse, avg would be 5 → normalized = 100.0.
    """
    scores = score_bfi44(_all_answers(1))
    # Analytically derived — confirms direction (6-raw, not raw-6)
    assert scores["extraversion"] == pytest.approx(37.5, abs=0.1)
    # Reverse items push scores above 0 (they contribute adjusted=5)
    for val in scores.values():
        assert val > 0.0


def test_invalid_likert_value_raises():
    answers = _all_answers(3)
    answers[1] = 6
    with pytest.raises(ValueError, match="1–5"):
        score_bfi44(answers)


def test_invalid_likert_value_zero_raises():
    answers = _all_answers(3)
    answers[5] = 0
    with pytest.raises(ValueError, match="1–5"):
        score_bfi44(answers)


def test_missing_question_raises():
    answers = _all_answers(3)
    del answers[44]
    with pytest.raises(ValueError, match="missing"):
        score_bfi44(answers)


def test_extra_question_raises():
    answers = _all_answers(3)
    answers[45] = 3
    with pytest.raises(ValueError, match="unexpected"):
        score_bfi44(answers)


# ---------------------------------------------------------------------------
# interpret_score
# ---------------------------------------------------------------------------


def test_interpret_score_boundaries():
    assert interpret_score(39.9) == "low"
    assert interpret_score(40.0) == "mid"
    assert interpret_score(60.0) == "mid"
    assert interpret_score(60.1) == "high"
