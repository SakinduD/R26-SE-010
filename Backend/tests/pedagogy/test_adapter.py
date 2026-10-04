"""Tests for adapter.py — OCEAN/difficulty conversions and skill inference."""
import pytest

from app.services.pedagogy.adapter import (
    MCA_SKILL_TO_RPE_SKILLS,
    RPE_SKILL_VOCABULARY,
    difficulty_int_to_label,
    difficulty_label_to_int,
    infer_weak_skills,
    to_rpe_profile,
)
from app.services.pedagogy.types import BaselineSummary, OceanScores

INTROVERT = OceanScores(
    openness=40, conscientiousness=40, extraversion=25, agreeableness=55, neuroticism=70
)
EXTROVERT = OceanScores(
    openness=65, conscientiousness=70, extraversion=80, agreeableness=55, neuroticism=30
)


# --- difficulty conversion ---

def test_difficulty_int_to_label_beginner():
    assert difficulty_int_to_label(1) == "beginner"
    assert difficulty_int_to_label(3) == "beginner"


def test_difficulty_int_to_label_intermediate():
    assert difficulty_int_to_label(4) == "intermediate"
    assert difficulty_int_to_label(6) == "intermediate"


def test_difficulty_int_to_label_advanced():
    assert difficulty_int_to_label(7) == "advanced"
    assert difficulty_int_to_label(10) == "advanced"


def test_difficulty_label_to_int_beginner():
    assert difficulty_label_to_int("beginner") == 3


def test_difficulty_label_to_int_intermediate():
    assert difficulty_label_to_int("intermediate") == 6


def test_difficulty_label_to_int_advanced():
    assert difficulty_label_to_int("advanced") == 9


# --- to_rpe_profile scaling ---

def test_to_rpe_profile_scales_extraversion_correctly():
    profile = to_rpe_profile(INTROVERT, [], 5, user_id="test")
    assert abs(profile.extraversion - 0.25) < 0.01


def test_to_rpe_profile_scales_neuroticism_correctly():
    profile = to_rpe_profile(INTROVERT, [], 5, user_id="test")
    assert abs(profile.neuroticism - 0.70) < 0.01


def test_to_rpe_profile_all_values_0_to_1():
    for scores in (INTROVERT, EXTROVERT):
        profile = to_rpe_profile(scores, [], 5, user_id="u")
        for attr in ("openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"):
            v = getattr(profile, attr)
            assert 0.0 <= v <= 1.0, f"{attr}={v} out of [0, 1]"


def test_to_rpe_profile_preserves_user_id():
    profile = to_rpe_profile(INTROVERT, [], 5, user_id="my-uuid")
    assert profile.user_id == "my-uuid"


def test_to_rpe_profile_sets_difficulty_label():
    profile = to_rpe_profile(INTROVERT, [], 3, user_id="u")
    assert profile.recommended_difficulty == "beginner"

    profile2 = to_rpe_profile(INTROVERT, [], 8, user_id="u")
    assert profile2.recommended_difficulty == "advanced"


def test_to_rpe_profile_passes_weak_skills():
    skills = ["assertiveness", "boundary_setting"]
    profile = to_rpe_profile(INTROVERT, skills, 5, user_id="u")
    assert profile.weak_skills == skills


# --- infer_weak_skills ---

def test_infer_weak_skills_returns_vocabulary_items():
    skills = infer_weak_skills(INTROVERT, None)
    for skill in skills:
        assert skill in RPE_SKILL_VOCABULARY, (
            f"Inferred skill {skill!r} not in RPE_SKILL_VOCABULARY"
        )


def test_infer_weak_skills_no_duplicates():
    skills = infer_weak_skills(INTROVERT, None)
    assert len(skills) == len(set(skills))


def test_introvert_extrovert_produce_different_skills():
    """High-N/low-E introvert and low-N/high-E extrovert should have distinct weak skill sets."""
    intro_skills = set(infer_weak_skills(INTROVERT, None))
    extro_skills = set(infer_weak_skills(EXTROVERT, None))
    assert intro_skills != extro_skills, (
        "Introvert and extrovert should have at least some different inferred weak skills"
    )


def test_rpe_skill_vocabulary_non_empty():
    assert len(RPE_SKILL_VOCABULARY) >= 5


# --- MCA baseline skills → RPE vocabulary (issue 3) ---


def _mca_baseline(**skill_scores) -> BaselineSummary:
    return BaselineSummary(has_baseline=True, skill_scores=skill_scores)


def test_every_mca_skill_maps_into_rpe_vocabulary():
    for mca_skill, rpe_skills in MCA_SKILL_TO_RPE_SKILLS.items():
        assert rpe_skills, mca_skill
        assert set(rpe_skills) <= RPE_SKILL_VOCABULARY, mca_skill


def test_weak_mca_skill_steers_weak_skills():
    baseline = _mca_baseline(vocal_command=0.25, speech_fluency=0.8, presence_engagement=0.9)
    assert infer_weak_skills(EXTROVERT, None, baseline) == [
        "assertiveness", "professional_communication",
    ]


def test_weakest_mca_skill_comes_first_and_duplicates_collapse():
    baseline = _mca_baseline(speech_fluency=0.35, presence_engagement=0.1, vocal_command=0.2)
    assert infer_weak_skills(EXTROVERT, None, baseline) == [
        "trust_building", "assertiveness", "professional_communication",
    ]


def test_no_weak_mca_skill_falls_back_to_ocean():
    baseline = _mca_baseline(vocal_command=0.8, speech_fluency=0.9)
    assert infer_weak_skills(INTROVERT, None, baseline) == infer_weak_skills(INTROVERT, None)


def test_unknown_measured_skill_is_ignored():
    baseline = _mca_baseline(made_up_skill=0.1)
    assert infer_weak_skills(INTROVERT, None, baseline) == infer_weak_skills(INTROVERT, None)


# --- drift guard: APM's vocabulary must cover RPE's scenario library ---

def test_vocabulary_covers_every_library_scenario_skill():
    """A skill RPE adds to a hand-authored scenario must be added to RPE_SKILL_VOCABULARY."""
    import json
    from pathlib import Path

    scenarios = Path(__file__).resolve().parents[2] / "app" / "models" / "rpe" / "scenarios"
    library_skills: set[str] = set()
    for path in scenarios.glob("scenario_*.json"):
        meta = json.loads(path.read_text(encoding="utf-8")).get("apa_metadata") or {}
        library_skills.update(meta.get("target_skills", []))

    assert library_skills, "no library scenarios found"
    assert library_skills <= RPE_SKILL_VOCABULARY, sorted(library_skills - RPE_SKILL_VOCABULARY)
