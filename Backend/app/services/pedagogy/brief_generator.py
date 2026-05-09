"""
Personalization Brief generator — PURE function, no I/O, no DB, no LLM.

Produces a PersonalizationBrief that explains, in plain English, why the
user received the training plan they did. Intended for UI display.
"""
from __future__ import annotations

from typing import Optional

from app.services.pedagogy.types import (
    BaselineSummary,
    OceanScores,
    PersonalizationBrief,
    TeachingStrategy,
)

LOW = 40
HIGH = 60

# ---------------------------------------------------------------------------
# Readable labels for strategy fields
# ---------------------------------------------------------------------------
_TONE_LABEL: dict[str, str] = {
    "gentle": "Supportive, low-pressure tone throughout",
    "direct": "Clear, balanced delivery with honest feedback",
    "challenging": "High-challenge delivery that pushes comfort boundaries",
}
_PACING_LABEL: dict[str, str] = {
    "slow": "Gradual pacing — time to process and reflect between turns",
    "moderate": "Steady pacing matched to a typical learning curve",
    "fast": "Accelerated pacing to maintain high engagement",
}
_COMPLEXITY_LABEL: dict[str, str] = {
    "simple": "Scenarios start straightforward and build incrementally",
    "moderate": "Moderate scenario complexity with layered challenges",
    "complex": "Rich, multi-layered scenarios for high cognitive engagement",
}
_NPC_LABEL: dict[str, str] = {
    "warm_supportive": "NPC partner is warm and empathetic",
    "professional": "NPC partner maintains a neutral, professional demeanour",
    "demanding_critical": "NPC partner is assertive and raises the stakes",
    "analytical_probing": "NPC partner asks probing questions to stress-test reasoning",
}
_FEEDBACK_LABEL: dict[str, str] = {
    "encouraging": "Feedback highlights strengths and frames growth positively",
    "balanced": "Feedback is balanced — strengths and improvement areas equally weighted",
    "blunt": "Direct, unvarnished feedback focused on concrete improvements",
}
_DIFFICULTY_BAND: dict[str, str] = {
    "beginner": "beginner",
    "intermediate": "intermediate",
    "advanced": "advanced",
}


def _difficulty_band(difficulty: int) -> str:
    if difficulty <= 4:
        return "beginner"
    if difficulty <= 7:
        return "intermediate"
    return "advanced"


def _ocean_drivers(scores: OceanScores) -> list[str]:
    drivers: list[str] = []
    n, e, o, c, a = (
        scores.neuroticism, scores.extraversion, scores.openness,
        scores.conscientiousness, scores.agreeableness,
    )
    if n > HIGH:
        drivers.append(
            f"High stress-sensitivity (N={n:.0f}) → plan prioritises comfort and safety"
        )
    elif n < LOW:
        drivers.append(
            f"Low stress-sensitivity (N={n:.0f}) → plan can stretch challenge boundaries"
        )

    if e < LOW:
        drivers.append(
            f"Introverted tendency (E={e:.0f}) → slower pacing and supportive NPC selected"
        )
    elif e > HIGH:
        drivers.append(
            f"Extraverted tendency (E={e:.0f}) → faster pacing to sustain engagement"
        )

    if o > HIGH:
        drivers.append(
            f"High curiosity (O={o:.0f}) → complex, varied scenarios selected"
        )
    elif o < LOW:
        drivers.append(
            f"Preference for structure (O={o:.0f}) → predictable, well-defined scenarios"
        )

    if c < LOW:
        drivers.append(
            f"Lower self-organisation score (C={c:.0f}) → complexity reduced one step"
        )

    if a < LOW:
        drivers.append(
            f"Low agreeableness (A={a:.0f}) → direct, analytical NPC challenge style"
        )

    return drivers


def _baseline_drivers(baseline: BaselineSummary) -> list[str]:
    drivers: list[str] = []

    if baseline.stress_indicator is not None and baseline.stress_indicator > 0.6:
        pct = int(baseline.stress_indicator * 100)
        drivers.append(
            f"Measured baseline stress ({pct}%) → tone softened an additional step"
        )

    if baseline.confidence_indicator is not None and baseline.confidence_indicator < 0.3:
        pct = int(baseline.confidence_indicator * 100)
        drivers.append(
            f"Low measured confidence ({pct}%) → NPC set to warm/supportive"
        )

    if baseline.skill_scores:
        weak = [k for k, v in baseline.skill_scores.items() if v < 0.4]
        if weak:
            drivers.append(
                f"Baseline session identified weak areas: {', '.join(weak)}"
            )

    return drivers


def _pick_summary(
    scores: OceanScores,
    strategy: TeachingStrategy,
    has_baseline: bool,
) -> str:
    n, e = scores.neuroticism, scores.extraversion
    if n > HIGH and e < LOW:
        return (
            "Your training starts gently and builds gradually — "
            "designed to build comfort before raising the challenge."
        )
    if n < LOW and e > HIGH:
        return (
            "Your training is calibrated for high engagement at an accelerated pace, "
            "matching your confident, outgoing profile."
        )
    if strategy.tone == "gentle":
        return (
            "Your plan prioritises a supportive environment so you can "
            "focus on skill-building without added pressure."
        )
    if strategy.tone == "challenging":
        return (
            "Your plan is designed to push boundaries — "
            "challenging scenarios that sharpen your edge."
        )
    base = "Your training plan is personalised to your OCEAN profile"
    if has_baseline:
        base += " and calibrated with evidence from your baseline session"
    return base + "."


def generate_brief(
    scores: OceanScores,
    strategy: TeachingStrategy,
    baseline: Optional[BaselineSummary],
    difficulty: int,
) -> PersonalizationBrief:
    """
    Produce a PersonalizationBrief explaining why the user got this plan.

    All inputs are already-computed — this function only translates them into
    human-readable form. No I/O, no side effects.
    """
    has_baseline = baseline is not None and baseline.has_baseline

    drivers = _ocean_drivers(scores)
    if has_baseline and baseline is not None:
        drivers += _baseline_drivers(baseline)

    if not drivers:
        drivers = ["OCEAN profile in the mid-range — default balanced plan applied"]

    strategy_highlights = [
        _TONE_LABEL.get(strategy.tone, strategy.tone),
        _PACING_LABEL.get(strategy.pacing, strategy.pacing),
        _COMPLEXITY_LABEL.get(strategy.complexity, strategy.complexity),
        _NPC_LABEL.get(strategy.npc_personality, strategy.npc_personality),
        _FEEDBACK_LABEL.get(strategy.feedback_style, strategy.feedback_style),
    ]

    band = _difficulty_band(difficulty)
    difficulty_rationale = (
        f"Starting difficulty: {band} ({difficulty}/10). "
        + {
            "beginner": "Easing in with foundational scenarios to build confidence.",
            "intermediate": "Balanced challenge to develop skills without overwhelming.",
            "advanced": "High-stakes scenarios for a candidate ready to be stretched.",
        }[band]
    )

    summary = _pick_summary(scores, strategy, has_baseline)

    return PersonalizationBrief(
        summary=summary,
        drivers=drivers,
        strategy_highlights=strategy_highlights,
        difficulty_rationale=difficulty_rationale,
        priority_skills=strategy.priority_skills,
        has_baseline_evidence=has_baseline,
    )
