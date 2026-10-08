"""
Adapter — the SINGLE place where the 0-100 ↔ 0.0-1.0 scale conversion lives.

Never sprinkle /100 anywhere else in the codebase. If the unit-test
test_scale_conversion_100_to_1 fails, only this file should be patched.

Also defines `infer_weak_skills`, the OCEAN→skill-vocabulary mapping passed
to RPE for scenario recommendations. Skill names below are verified against
Backend/app/models/rpe/scenarios/scenario_*.json on 2026-10-04
(tests/pedagogy/test_adapter.py fails if the library drifts from this list).
"""
from __future__ import annotations

from typing import Optional

from app.contracts.rpe import ApaLearnerProfile, DifficultyLabel
from app.services.pedagogy.strategy_optimizer import weak_baseline_skills
from app.services.pedagogy.types import BaselineSummary, OceanScores, TeachingStrategy

# ---------------------------------------------------------------------------
# RPE skill vocabulary (citations to the scenario JSON files)
#
#   scenario_001.json  — assertiveness, emotional_regulation, boundary_setting
#   scenario_002.json  — assertiveness, conflict_resolution
#   scenario_003.json  — client_management, emotional_regulation, accountability, empathy
#   scenario_004.json  — political_awareness, assertiveness, trust_building
#   scenario_005.json  — boundary_setting, assertiveness, self_advocacy
#
# professional_communication and professional_assertiveness are no longer in
# any library scenario, but stay valid: RPE generates scenarios from a
# training-plan brief for any skill here.
# ---------------------------------------------------------------------------
RPE_SKILL_VOCABULARY: frozenset[str] = frozenset(
    {
        "assertiveness",
        "conflict_resolution",
        "professional_communication",
        "client_management",
        "emotional_regulation",
        "accountability",
        "political_awareness",
        "trust_building",
        "boundary_setting",
        "professional_assertiveness",
        "self_advocacy",
        "empathy",
    }
)

# ---------------------------------------------------------------------------
# MCA baseline skill → RPE skills it exercises. MCA scores four skills
# (app/api/v1/mca/scoring.py); only emotional_regulation shares a name with
# RPE, so without this a weak MCA skill could never steer scenario choice.
# Proposed mapping from the MCA/pedagogy integration review (task P5) —
# change it here only, together with the MCA team.
# ---------------------------------------------------------------------------
MCA_SKILL_TO_RPE_SKILLS: dict[str, tuple[str, ...]] = {
    "vocal_command": ("assertiveness", "professional_communication"),
    "speech_fluency": ("professional_communication",),
    "presence_engagement": ("trust_building",),
    "emotional_regulation": ("emotional_regulation",),
}

MAX_BASELINE_WEAK_SKILLS = 5

LOW = 40
HIGH = 60


def difficulty_int_to_label(difficulty: int) -> DifficultyLabel:
    """1-4 → beginner, 5-7 → intermediate, 8-10 → advanced."""
    if difficulty <= 4:
        return "beginner"
    if difficulty <= 7:
        return "intermediate"
    return "advanced"


def difficulty_label_to_int(label: str) -> int:
    """beginner → 3, intermediate → 6, advanced → 9 (mid of each band)."""
    return {"beginner": 3, "intermediate": 6, "advanced": 9}.get(label.lower(), 5)


def infer_weak_skills(
    profile: OceanScores,
    strategy: Optional[TeachingStrategy] = None,
    baseline: Optional[BaselineSummary] = None,
) -> list[str]:
    """
    Infer weak-skill hints that APM passes to RPE's scenario recommender.

    Returns only skill names from RPE_SKILL_VOCABULARY (which mirrors the 5
    scenario JSONs). If a teammate adds a new skill upstream, add a row here
    with a citation comment.

    Baseline precedence: when baseline.has_baseline is True and any measured
    skill scores < 0.4, the RPE skills it maps to (MCA_SKILL_TO_RPE_SKILLS;
    names already in RPE_SKILL_VOCABULARY map to themselves) take precedence
    over the OCEAN-derived list, weakest measured skill first. This reflects
    measured performance evidence over trait inference. Capped at 5 skills.

    OCEAN mapping (fallback when no baseline evidence):
      Neuroticism > 60        → emotional_regulation, boundary_setting
      Agreeableness < 40      → conflict_resolution, professional_communication
      Conscientiousness < 40  → accountability, professional_assertiveness
      Extraversion < 40       → assertiveness, self_advocacy
      Openness < 40           → political_awareness
      Agreeableness > 60 AND Neuroticism > 60
                              → trust_building, client_management
    """
    # Baseline evidence takes precedence over trait inference
    baseline_weak: list[str] = []
    for measured in weak_baseline_skills(baseline):
        mapped = MCA_SKILL_TO_RPE_SKILLS.get(
            measured, (measured,) if measured in RPE_SKILL_VOCABULARY else ()
        )
        baseline_weak += [s for s in mapped if s not in baseline_weak]
    if baseline_weak:
        return baseline_weak[:MAX_BASELINE_WEAK_SKILLS]

    # Fall back to OCEAN-derived inference
    skills: list[str] = []

    if profile.neuroticism > HIGH:
        skills += ["emotional_regulation", "boundary_setting"]
    if profile.agreeableness < LOW:
        skills += ["conflict_resolution", "professional_communication"]
    if profile.conscientiousness < LOW:
        skills += ["accountability", "professional_assertiveness"]
    if profile.extraversion < LOW:
        skills += ["assertiveness", "self_advocacy"]
    if profile.openness < LOW:
        skills.append("political_awareness")
    if profile.agreeableness > HIGH and profile.neuroticism > HIGH:
        skills += ["trust_building", "client_management"]

    seen: set[str] = set()
    out: list[str] = []
    for s in skills:
        if s in seen or s not in RPE_SKILL_VOCABULARY:
            continue
        seen.add(s)
        out.append(s)
    return out


def to_rpe_profile(
    profile: OceanScores,
    weak_skills: list[str],
    difficulty: int,
    *,
    user_id: str,
) -> ApaLearnerProfile:
    """
    THE single scale-conversion site.

    Validates input is 0-100 (rejects out-of-range with ValueError) and divides
    by 100 to produce RPE's 0.0-1.0 wire format. user_id is forwarded as-is
    (string-coerce UUIDs at the call site).
    """
    for name, val in (
        ("openness", profile.openness),
        ("conscientiousness", profile.conscientiousness),
        ("extraversion", profile.extraversion),
        ("agreeableness", profile.agreeableness),
        ("neuroticism", profile.neuroticism),
    ):
        if val < 0 or val > 100:
            raise ValueError(
                f"{name}={val} is outside the expected 0-100 range; "
                "scale conversion must happen here only"
            )

    return ApaLearnerProfile(
        user_id=user_id,
        openness=profile.openness / 100.0,
        conscientiousness=profile.conscientiousness / 100.0,
        extraversion=profile.extraversion / 100.0,
        agreeableness=profile.agreeableness / 100.0,
        neuroticism=profile.neuroticism / 100.0,
        weak_skills=weak_skills,
        recommended_difficulty=difficulty_int_to_label(difficulty),
    )
