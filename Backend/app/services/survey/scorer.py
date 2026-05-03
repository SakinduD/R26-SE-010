"""BFI-44 scoring: pure functions, no I/O."""

from typing import Literal

from app.services.survey.questions import BFI44_QUESTIONS

_TRAIT_FULL_NAME: dict[str, str] = {
    "O": "openness",
    "C": "conscientiousness",
    "E": "extraversion",
    "A": "agreeableness",
    "N": "neuroticism",
}


def score_bfi44(answers: dict[int, int]) -> dict[str, float]:
    """Score a complete set of BFI-44 answers into OCEAN trait scores (0–100).

    Args:
        answers: Mapping of question_id (1–44) to Likert response (1–5).

    Returns:
        Dict with keys openness/conscientiousness/extraversion/agreeableness/neuroticism,
        each a float rounded to 1 decimal place in the range [0.0, 100.0].

    Raises:
        ValueError: If answers are missing, extra, or contain out-of-range values.
    """
    expected_ids = set(range(1, 45))
    if set(answers.keys()) != expected_ids:
        missing = expected_ids - set(answers.keys())
        extra = set(answers.keys()) - expected_ids
        msg_parts = []
        if missing:
            msg_parts.append(f"missing question ids: {sorted(missing)}")
        if extra:
            msg_parts.append(f"unexpected question ids: {sorted(extra)}")
        raise ValueError("; ".join(msg_parts))

    for q_id, val in answers.items():
        if val < 1 or val > 5:
            raise ValueError(
                f"answer for question {q_id} must be 1–5, got {val}"
            )

    trait_buckets: dict[str, list[float]] = {
        "openness": [], "conscientiousness": [], "extraversion": [],
        "agreeableness": [], "neuroticism": [],
    }

    for q in BFI44_QUESTIONS:
        raw = answers[q["id"]]
        adjusted = float(6 - raw if q["reverse"] else raw)
        trait_buckets[_TRAIT_FULL_NAME[q["trait"]]].append(adjusted)

    result: dict[str, float] = {}
    for trait, scores in trait_buckets.items():
        avg = sum(scores) / len(scores)
        result[trait] = round(((avg - 1) / 4) * 100, 1)

    return result


def interpret_score(score: float) -> Literal["low", "mid", "high"]:
    """Interpret a 0–100 OCEAN trait score into a qualitative level.

    low: score < 40
    mid: 40 <= score <= 60
    high: score > 60
    """
    if score < 40:
        return "low"
    if score <= 60:
        return "mid"
    return "high"
