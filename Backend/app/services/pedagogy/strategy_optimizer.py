"""
Strategy Optimizer — PURE function from OCEAN scores to a TeachingStrategy.

No I/O, no LLM, no DB. Pydantic in, Pydantic out.

Conflict-resolution precedence
------------------------------
When traits push in opposite directions, **Neuroticism's safety/comfort
signal wins for tone and feedback_style**. Concretely: if Neuroticism is high,
even a low Agreeableness profile (which would normally pull tone toward blunt
and NPC toward demanding) keeps the gentle/encouraging axis. Agreeableness
may still influence NPC personality, but never overrides safety on tone or
feedback. This precedence is documented because it is the single most
load-bearing rule the thesis depends on.

Baseline rules (only active when baseline.has_baseline is True)
---------------------------------------------------------------
These fire AFTER all OCEAN rules, so they can soften an already-derived
strategy based on measured vocal/emotional evidence:
  stress_indicator > 0.6  → tone steps softer by one level
  confidence_indicator < 0.3 → npc overridden to warm_supportive
  skill_scores has any value < 0.4 → those skill names added to priority_skills
"""
from __future__ import annotations

from typing import Optional

from app.services.pedagogy.types import (
    COMPLEXITY_ORDER,
    TONE_ORDER,
    BaselineSummary,
    Complexity,
    FeedbackStyle,
    NpcPersonality,
    OceanScores,
    Pacing,
    TeachingStrategy,
    Tone,
)

LOW = 40
HIGH = 60


def optimize_strategy(
    scores: OceanScores,
    baseline: Optional[BaselineSummary] = None,
) -> TeachingStrategy:
    """
    Map OCEAN (0-100) to a TeachingStrategy via documented threshold rules.

    When baseline is None the output is byte-identical to the pre-baseline
    behaviour — existing tests must not be affected.

    Rules (per RESEARCH_BRIEF, with Neuroticism precedence on tone/feedback):
      Neuroticism > HIGH  → tone=gentle, feedback=encouraging  (overrides A-low)
      Neuroticism < LOW   → tone=challenging
      Extraversion < LOW  → pacing=slow, npc=warm_supportive
      Extraversion > HIGH → pacing=fast
      Openness > HIGH     → complexity=complex
      Openness < LOW      → complexity=simple
      Conscientiousness < LOW → complexity reduced one step (with floor)
      Agreeableness < LOW → npc demanding/analytical, feedback=blunt
                            (UNLESS Neuroticism > HIGH — N wins)
      Agreeableness > HIGH AND Neuroticism > HIGH → npc=warm_supportive (compounding)

    Additional baseline rules (fire only when baseline.has_baseline is True):
      stress_indicator > 0.6       → tone steps softer one level
      confidence_indicator < 0.3   → npc forced to warm_supportive
      skill_scores[k] < 0.4        → k added to priority_skills
    """
    # mid-range defaults
    tone: Tone = "direct"
    pacing: Pacing = "moderate"
    complexity: Complexity = "moderate"
    npc: NpcPersonality = "professional"
    feedback: FeedbackStyle = "balanced"
    rationale: list[str] = []
    priority_skills: list[str] = []

    n = scores.neuroticism
    e = scores.extraversion
    o = scores.openness
    c = scores.conscientiousness
    a = scores.agreeableness

    # --- Neuroticism: drives tone & feedback (precedence rule) ---
    if n > HIGH:
        tone = "gentle"
        feedback = "encouraging"
        rationale.append(
            f"Neuroticism={n:.0f} (high) → tone=gentle, feedback=encouraging "
            "(safety signal — wins over agreeableness for tone)"
        )
    elif n < LOW:
        tone = "challenging"
        rationale.append(f"Neuroticism={n:.0f} (low) → tone=challenging")

    # --- Extraversion: pacing & supportive NPC ---
    if e < LOW:
        pacing = "slow"
        npc = "warm_supportive"
        rationale.append(
            f"Extraversion={e:.0f} (low) → pacing=slow, npc=warm_supportive"
        )
    elif e > HIGH:
        pacing = "fast"
        rationale.append(f"Extraversion={e:.0f} (high) → pacing=fast")

    # --- Openness: complexity ---
    if o > HIGH:
        complexity = "complex"
        rationale.append(f"Openness={o:.0f} (high) → complexity=complex")
    elif o < LOW:
        complexity = "simple"
        rationale.append(f"Openness={o:.0f} (low) → complexity=simple")

    # --- Conscientiousness: reduce complexity by one step if low ---
    if c < LOW:
        idx = COMPLEXITY_ORDER.index(complexity)
        new_idx = max(0, idx - 1)
        new_complexity = COMPLEXITY_ORDER[new_idx]
        if new_complexity != complexity:
            rationale.append(
                f"Conscientiousness={c:.0f} (low) → "
                f"complexity reduced from {complexity} to {new_complexity}"
            )
            complexity = new_complexity
        else:
            rationale.append(
                f"Conscientiousness={c:.0f} (low) → complexity already at floor "
                f"({complexity})"
            )

    # --- Agreeableness: low → demanding/analytical NPC + blunt feedback ---
    # but Neuroticism precedence keeps tone/feedback safe
    if a < LOW:
        if n > HIGH:
            rationale.append(
                f"Agreeableness={a:.0f} (low) noted, but Neuroticism={n:.0f} "
                "(high) overrides for safety — keeping gentle tone and "
                "encouraging feedback"
            )
        else:
            npc = "analytical_probing" if c >= HIGH else "demanding_critical"
            feedback = "blunt"
            rationale.append(
                f"Agreeableness={a:.0f} (low) → npc={npc}, feedback=blunt"
            )

    # --- Agreeableness high AND Neuroticism high → reinforce warm_supportive ---
    if a > HIGH and n > HIGH:
        npc = "warm_supportive"
        rationale.append(
            f"Agreeableness={a:.0f} (high) + Neuroticism={n:.0f} (high) → "
            "npc=warm_supportive (compounding safety/affiliation signal)"
        )

    if not rationale:
        rationale.append(
            "All OCEAN traits in mid-range — using neutral defaults"
        )

    # -----------------------------------------------------------------------
    # Baseline rules — only active when measured vocal evidence is available.
    # These run AFTER all OCEAN rules and may tighten the strategy further.
    # -----------------------------------------------------------------------
    if baseline is not None and baseline.has_baseline:
        si = baseline.stress_indicator
        ci = baseline.confidence_indicator

        if si is not None and si > 0.6:
            # Soften tone one step (gentle is the floor — no-op if already there)
            idx = TONE_ORDER.index(tone)
            softer = TONE_ORDER[max(0, idx - 1)]
            if softer != tone:
                rationale.append(
                    f"baseline stress_indicator={si:.2f} > 0.6 → "
                    f"tone softened from {tone!r} to {softer!r} "
                    "(regardless of N score)"
                )
                tone = softer
            else:
                rationale.append(
                    f"baseline stress_indicator={si:.2f} > 0.6 → "
                    f"tone already at floor ({tone!r}), no change"
                )

        if ci is not None and ci < 0.3:
            rationale.append(
                f"baseline confidence_indicator={ci:.2f} < 0.3 → "
                "npc overridden to warm_supportive"
            )
            npc = "warm_supportive"

        if baseline.skill_scores:
            priority_skills = [
                k for k, v in baseline.skill_scores.items() if v < 0.4
            ]
            if priority_skills:
                rationale.append(
                    f"baseline skill_scores has weak areas "
                    f"({', '.join(priority_skills)}) → added to priority_skills"
                )

    return TeachingStrategy(
        tone=tone,
        pacing=pacing,
        complexity=complexity,
        npc_personality=npc,
        feedback_style=feedback,
        rationale=rationale,
        priority_skills=priority_skills,
    )
