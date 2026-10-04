"""Recommendations are written for one learner, so the pedagogy profile has to
reach the prompt and has to steer the fallback.

The profile lives in adaptive pedagogy's tables; analytics reads it, never
writes it. These tests cover the reading, the shape that reaches the model, and
the one thing the rule-based fallback can personalise on its own - ordering.
"""

import uuid

import pytest

from app.models.personality_profile import PersonalityProfile
from app.models.training_plan import TrainingPlan
from app.services import llm_mentoring_service as mentoring


STRATEGY = {
    "tone": "gentle",
    "pacing": "slow",
    "complexity": "simple",
    "npc_personality": "warm_supportive",
    "feedback_style": "encouraging",
    "rationale": ["high neuroticism"],
    "priority_skills": ["presence_engagement", "speech_fluency"],
}


class TestReadingTheProfile:
    def test_a_learner_with_no_plan_gets_no_profile(self, db_session):
        assert mentoring._pedagogy_profile(db_session, str(uuid.uuid4())) is None

    def test_a_non_uuid_user_is_not_a_database_error(self, db_session):
        # The analytics tables key on strings, the pedagogy ones on UUIDs. A
        # legacy string id must return nothing rather than raise.
        assert mentoring._pedagogy_profile(db_session, "demo-user") is None

    def test_the_plan_and_the_traits_are_both_read(self, db_session, seeded_learner):
        profile = mentoring._pedagogy_profile(db_session, seeded_learner)

        # The plan's own skill column is a scenario domain, not a tracked skill.
        assert profile["practice_domain"] == "job_interview"
        assert profile["difficulty"] == 3
        assert profile["feedback_style"] == "encouraging"
        assert profile["tone"] == "gentle"
        assert profile["complexity"] == "simple"
        assert profile["priority_skills"] == ["presence_engagement", "speech_fluency"]
        assert profile["traits"]["neuroticism"] == 71

    def test_trait_scores_are_rounded(self, db_session, seeded_learner):
        # The model is picking a register, not doing arithmetic.
        traits = mentoring._pedagogy_profile(db_session, seeded_learner)["traits"]
        assert all(isinstance(value, int) for value in traits.values())


class TestWhatReachesTheModel:
    def test_the_prompt_explains_the_pedagogy_block(self):
        rules = mentoring._SHARED_PROMPT_RULES
        assert "feedback_style" in rules
        assert "priority_skills" in rules

    def test_the_prompt_forbids_naming_the_profile_back_to_the_learner(self):
        # It changes how advice is written, not what the learner is told about
        # themselves. A recommendation that reads "because you score 71 on
        # neuroticism" is a personality verdict, which this product does not give.
        assert "Never name the pedagogy fields" in mentoring._SHARED_PROMPT_RULES


class TestFallbackOrdering:
    """The fallback cannot change its register, but it can change its order -
    and the list is truncated before display, so order decides what is seen."""

    def test_the_first_priority_skill_outranks_the_second(self):
        ordered = mentoring._pedagogy_focus_order(
            {"priority_skills": ["speech_fluency", "presence_engagement"]}
        )
        assert ordered["speech_fluency"] < ordered["presence_engagement"]

    def test_a_skill_named_twice_keeps_its_best_rank(self):
        ordered = mentoring._pedagogy_focus_order(
            {"priority_skills": ["speech_fluency", "speech_fluency"]}
        )
        assert ordered == {"speech_fluency": 0}

    def test_the_practice_domain_never_orders_anything(self):
        # Every plan on this database carries skill="job_interview". Ranking by
        # it would compare a scenario against a skill name and match nothing,
        # so it is excluded rather than left to fail quietly.
        assert mentoring._pedagogy_focus_order(
            {"practice_domain": "job_interview", "priority_skills": []}
        ) == {}

    def test_no_profile_means_no_reordering(self):
        assert mentoring._pedagogy_focus_order(None) == {}
        assert mentoring._pedagogy_focus_order({}) == {}

    def test_priority_still_beats_the_plan(self):
        # A high-severity finding on an unrelated skill must not be pushed below
        # a low one just because the plan names the other skill.
        bundle = {
            "blind_spots": [
                {
                    "skill_area": "emotional_intelligence",
                    "severity": "high",
                    "blind_spot_type": "overestimation",
                    "gap": 22,
                    "recommendation": "Check one reaction against the recording.",
                }
            ],
            "predictions": [],
            "trends": [],
            "scores": {"speech_fluency": 55.0},
            "summary": {"session_count": 4},
            "pedagogy": {"practice_domain": "job_interview", "priority_skills": ["speech_fluency"]},
        }

        items = mentoring._build_rule_based_recommendations(bundle)

        assert items[0].skill_area == "emotional_intelligence"
        assert items[0].priority == "high"


@pytest.fixture
def seeded_learner(db_session):
    """A learner with a pedagogy plan and a personality profile.

    Ids are generated per test because the suite shares one database session and
    does not clear between tests.
    """
    from app.models.user import User

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email=f"pedagogy-{user_id.hex[:8]}@example.test",
            display_name="Pedagogy Fixture",
        )
    )
    db_session.flush()

    db_session.add(
        TrainingPlan(
            user_id=user_id,
            skill="job_interview",
            strategy_json=STRATEGY,
            difficulty=3,
            recommended_scenario_ids=[],
            generation_source="rpe_library",
        )
    )
    db_session.add(
        PersonalityProfile(
            user_id=user_id,
            openness=52.0,
            conscientiousness=64.4,
            extraversion=38.0,
            agreeableness=70.0,
            neuroticism=71.2,
            raw_responses={},
        )
    )
    db_session.commit()

    yield str(user_id)

    db_session.query(TrainingPlan).filter(TrainingPlan.user_id == user_id).delete()
    db_session.query(PersonalityProfile).filter(
        PersonalityProfile.user_id == user_id
    ).delete()
    db_session.query(User).filter(User.id == user_id).delete()
    db_session.commit()
