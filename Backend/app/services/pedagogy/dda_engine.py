"""
DDA Engine — PURE function from OCEAN scores to an initial difficulty (1-10).

No I/O, no LLM, no DB.
"""
from __future__ import annotations

from app.services.pedagogy.types import OceanScores

LOW = 40
HIGH = 60
BASE_DIFFICULTY = 5
MIN_DIFFICULTY = 1
MAX_DIFFICULTY = 10


def initial_difficulty(scores: OceanScores) -> tuple[int, list[str]]:
    """
    Compute initial scenario difficulty (1-10) from OCEAN.

    Rules:
        base = 5
        N > HIGH:   base -= 2   (high anxiety → ease in)
        N < LOW:    base += 1   (calm → can handle more)
        O > HIGH:   base += 1   (curious / novelty-tolerant)
        C < LOW:    base -= 1   (less self-organised)
        E < LOW:    base -= 1   (introverts ease in)
        clamp to [1, 10]
    """
    base = BASE_DIFFICULTY
    rationale: list[str] = []

    if scores.neuroticism > HIGH:
        base -= 2
        rationale.append(f"Neuroticism={scores.neuroticism:.0f} (high) → -2")
    elif scores.neuroticism < LOW:
        base += 1
        rationale.append(f"Neuroticism={scores.neuroticism:.0f} (low) → +1")

    if scores.openness > HIGH:
        base += 1
        rationale.append(f"Openness={scores.openness:.0f} (high) → +1")

    if scores.conscientiousness < LOW:
        base -= 1
        rationale.append(f"Conscientiousness={scores.conscientiousness:.0f} (low) → -1")

    if scores.extraversion < LOW:
        base -= 1
        rationale.append(f"Extraversion={scores.extraversion:.0f} (low) → -1")

    clamped = max(MIN_DIFFICULTY, min(MAX_DIFFICULTY, base))
    if clamped != base:
        rationale.append(f"Clamped from {base} to {clamped} (range 1-10)")
    if not rationale:
        rationale.append(f"Mid-range OCEAN profile — base difficulty {clamped}")

    return clamped, rationale
