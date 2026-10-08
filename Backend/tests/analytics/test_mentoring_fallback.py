"""The path that runs when the LLM is unavailable has to actually run.

It did not. `_build_session_rule_based_recommendations` read
`blind_spot["observed_rating"]`, a key that does not exist on a blind spot -
the field is `comparison_score` - so the branch raised KeyError. Because it is
the fallback, it only executes once the LLM call has already failed, which meant
the bug was invisible for as long as OpenAI kept answering. The first time it
would ever have run was the first time a learner needed it.

These tests exercise both fallbacks directly with the LLM stubbed out, so the
safety net is checked without depending on a network call or an API key.
"""

import pytest

from app.services import llm_mentoring_service


@pytest.fixture
def no_llm(monkeypatch):
    """Force both scopes down the rule-based path."""
    monkeypatch.setattr(llm_mentoring_service, "_call_openai_mentoring", lambda bundle: None)
    monkeypatch.setattr(
        llm_mentoring_service, "_call_openai_session_mentoring", lambda bundle: None
    )


def _session_bundle() -> dict:
    return {
        "user_id": "fallback-user",
        "session_id": "fallback-session",
        "summary": {
            "session_id": "fallback-session",
            "user_id": "fallback-user",
            "feedback_count": 4,
            "average_feedback_rating": 62.0,
            "blind_spot_count": 1,
            "high_blind_spot_count": 1,
        },
        "scores": {"vocal_command": 58.0, "emotional_intelligence": 44.0},
        "latest_feedback": [],
        "feedback_alignment": [],
        "blind_spots": [
            {
                "skill_area": "emotional_intelligence",
                "blind_spot_type": "overestimation",
                "severity": "high",
                "self_rating": 82.0,
                "comparison_score": 44.0,
                "comparison_source": "observed",
                "gap": 38.0,
                "confidence": 0.8,
                "recommendation": "…",
            }
        ],
    }


def test_session_fallback_produces_recommendations(no_llm, db_session):
    """The exact shape that used to raise KeyError."""
    items = llm_mentoring_service._build_session_rule_based_recommendations(_session_bundle())

    assert items, "the fallback produced nothing at all"
    blind_spot_item = next(
        item for item in items if item.skill_area == "emotional_intelligence"
    )
    # The measured score has to reach the learner; reading the wrong key is what
    # broke this, so the number itself is asserted rather than just the shape.
    assert "44" in blind_spot_item.detail
    assert "82" in blind_spot_item.detail
    assert blind_spot_item.next_action


def test_session_fallback_survives_a_blind_spot_with_missing_fields(no_llm):
    """Evidence is assembled from several services; one of them may return less."""
    bundle = _session_bundle()
    bundle["blind_spots"][0].pop("comparison_score")

    items = llm_mentoring_service._build_session_rule_based_recommendations(bundle)

    assert items, "a missing optional field must not empty the fallback"


def test_user_fallback_produces_recommendations(no_llm):
    bundle = {
        "user_id": "fallback-user",
        "summary": {
            "session_count": 12,
            "feedback_count": 20,
            "average_feedback_rating": 61.0,
            "blind_spot_count": 1,
            "high_blind_spot_count": 1,
            "prediction_count": 1,
            "high_risk_prediction_count": 1,
            "medium_risk_prediction_count": 0,
            "improving_count": 0,
            "declining_count": 1,
            "sentiment_positive_count": 2,
            "sentiment_negative_count": 5,
        },
        "scores": {"emotional_intelligence": 44.0},
        "latest_feedback": [],
        "feedback_alignment": [],
        "blind_spots": [],
        "trends": [
            {
                "skill_area": "emotional_intelligence",
                "trend_label": "declining",
                "first_score": 78.0,
                "latest_score": 44.0,
                "delta": -34.0,
                "slope_per_session": -2.8,
                "session_count": 12,
                "recommendation": "…",
            }
        ],
        "predictions": [
            {
                "predicted_skill": "emotional_intelligence",
                "current_score": 44.0,
                "predicted_score": 40.0,
                "projected_delta": -4.0,
                "trend_label": "declining",
                "risk_level": "high",
                "confidence": 0.8,
                "evidence_points": 12,
                "recommendation": "…",
            }
        ],
    }

    items = llm_mentoring_service._build_rule_based_recommendations(bundle)

    assert items
    assert all(item.source == "rule_based" for item in items)


def test_fallback_only_names_tracked_skills(no_llm):
    """Same rule as the LLM path: no skill the learner cannot find on a screen."""
    tracked = set(llm_mentoring_service._TRACKED_SKILL_COLUMNS) | {"overall", None}

    items = llm_mentoring_service._build_session_rule_based_recommendations(_session_bundle())

    assert all(item.skill_area in tracked for item in items)
