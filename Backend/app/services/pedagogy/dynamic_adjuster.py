"""
Dynamic Adjuster — PURE function that turns a PerformanceSignal into an
AdjustmentResult (new strategy + new difficulty + rationale).

This is the second thesis-defensible piece of logic. It proves the adaptive
loop: same external signal applied to two different starting plans produces
two different adjustments, because the *step* on each enum is anchored to the
current value, not to the signal alone.

No I/O, no LLM, no DB.
"""
from __future__ import annotations

from typing import TypeVar

from app.services.pedagogy.types import (
    COMPLEXITY_ORDER,
    PACING_ORDER,
    TONE_ORDER,
    AdjustmentResult,
    PerformanceSignal,
    TeachingStrategy,
)

# --- adjustment thresholds (named constants — every magic number has a name) -

STRESS_HIGH_THRESHOLD = 0.6
STRESS_LOW_THRESHOLD = 0.3
ENGAGEMENT_HIGH_THRESHOLD = 0.7
COMPLETION_HIGH_THRESHOLD = 0.8
CONFIDENCE_LOW_THRESHOLD = 0.4

MIN_DIFFICULTY = 1
MAX_DIFFICULTY = 10
LIVE_MAX_DIFFICULTY_DELTA = 1

T = TypeVar("T")


def _step(value: T, order: list[T], delta: int) -> T:
    """Move along an ordered enum list, clamping at the edges."""
    idx = order.index(value)
    new_idx = max(0, min(len(order) - 1, idx + delta))
    return order[new_idx]


def adjust(
    current_strategy: TeachingStrategy,
    current_difficulty: int,
    signal: PerformanceSignal,
    *,
    mode: str = "full",
) -> AdjustmentResult:
    """
    Adjust strategy and difficulty given a normalised performance signal.

    Modes:
        "full"        — full re-plan (called on session_end)
        "lightweight" — strategy is held constant, only ±1 difficulty hint
                        (called from live MCA-shaped signals)

    Adjustment rules (each rule independent; a single signal may trigger many):
        outcome=failure AND stress > 0.6
            → difficulty -1, tone softer one step, feedback=encouraging
        outcome=success AND completion > 0.8 AND engagement > 0.7
            → difficulty +1, complexity up one step
        outcome=success AND stress < 0.3
            → pacing up one step (no-op if already fast)
        confidence < 0.4
            → npc=warm_supportive, feedback=encouraging  (sustained low confidence)
    """
    new_tone = current_strategy.tone
    new_pacing = current_strategy.pacing
    new_complexity = current_strategy.complexity
    new_npc = current_strategy.npc_personality
    new_feedback = current_strategy.feedback_style
    new_difficulty = current_difficulty
    rationale: list[str] = []

    # Rule 1: failure + high stress → soften
    if (
        signal.outcome == "failure"
        and signal.stress_level > STRESS_HIGH_THRESHOLD
    ):
        new_difficulty -= 1
        new_tone = _step(new_tone, TONE_ORDER, -1)
        new_feedback = "encouraging"
        rationale.append(
            f"failure with stress={signal.stress_level:.2f} > "
            f"{STRESS_HIGH_THRESHOLD}: difficulty -1, tone softened to "
            f"{new_tone}, feedback=encouraging"
        )

    # Rule 2: strong success → push harder
    if (
        signal.outcome == "success"
        and signal.objective_completion_rate > COMPLETION_HIGH_THRESHOLD
        and signal.engagement_score > ENGAGEMENT_HIGH_THRESHOLD
    ):
        new_difficulty += 1
        old_complexity = new_complexity
        new_complexity = _step(new_complexity, COMPLEXITY_ORDER, 1)
        rationale.append(
            f"success with completion={signal.objective_completion_rate:.2f}, "
            f"engagement={signal.engagement_score:.2f}: difficulty +1, "
            f"complexity {old_complexity}→{new_complexity}"
        )

    # Rule 3: relaxed success → faster pacing
    if (
        signal.outcome == "success"
        and signal.stress_level < STRESS_LOW_THRESHOLD
    ):
        old_pacing = new_pacing
        new_pacing = _step(new_pacing, PACING_ORDER, 1)
        if new_pacing != old_pacing:
            rationale.append(
                f"success with low stress={signal.stress_level:.2f}: "
                f"pacing {old_pacing}→{new_pacing}"
            )

    # Rule 4: low confidence → warm and encouraging
    if signal.confidence_score < CONFIDENCE_LOW_THRESHOLD:
        new_npc = "warm_supportive"
        new_feedback = "encouraging"
        rationale.append(
            f"confidence={signal.confidence_score:.2f} < "
            f"{CONFIDENCE_LOW_THRESHOLD}: npc=warm_supportive, "
            "feedback=encouraging"
        )

    # Clamp difficulty to legal range
    new_difficulty = max(MIN_DIFFICULTY, min(MAX_DIFFICULTY, new_difficulty))

    # Lightweight mode: revert strategy mutations, cap difficulty delta
    if mode == "lightweight":
        new_tone = current_strategy.tone
        new_pacing = current_strategy.pacing
        new_complexity = current_strategy.complexity
        new_npc = current_strategy.npc_personality
        new_feedback = current_strategy.feedback_style
        delta = new_difficulty - current_difficulty
        if abs(delta) > LIVE_MAX_DIFFICULTY_DELTA:
            new_difficulty = current_difficulty + (
                LIVE_MAX_DIFFICULTY_DELTA if delta > 0 else -LIVE_MAX_DIFFICULTY_DELTA
            )
        rationale.insert(
            0, "lightweight mode: strategy unchanged, only ±1 difficulty hint"
        )

    if not rationale:
        rationale.append("No adjustment criteria met — plan unchanged")

    new_strategy = TeachingStrategy(
        tone=new_tone,
        pacing=new_pacing,
        complexity=new_complexity,
        npc_personality=new_npc,
        feedback_style=new_feedback,
        rationale=rationale,
    )

    return AdjustmentResult(
        new_strategy=new_strategy,
        new_difficulty=new_difficulty,
        rationale=rationale,
        signals_summary=signal.model_dump(),
    )
