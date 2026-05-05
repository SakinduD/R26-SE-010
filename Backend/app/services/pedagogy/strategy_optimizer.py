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
"""
from __future__ import annotations

from app.services.pedagogy.types import (
    COMPLEXITY_ORDER,
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


def optimize_strategy(scores: OceanScores) -> TeachingStrategy:
    """
    Map OCEAN (0-100) to a TeachingStrategy via documented threshold rules.

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
    """
    # mid-range defaults
    tone: Tone = "direct"
    pacing: Pacing = "moderate"
    complexity: Complexity = "moderate"
    npc: NpcPersonality = "professional"
    feedback: FeedbackStyle = "balanced"
    rationale: list[str] = []

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

    return TeachingStrategy(
        tone=tone,
        pacing=pacing,
        complexity=complexity,
        npc_personality=npc,
        feedback_style=feedback,
        rationale=rationale,
    )
