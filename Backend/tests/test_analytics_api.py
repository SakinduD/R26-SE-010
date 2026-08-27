from pathlib import Path

import pytest


def test_create_and_get_session_metric(client):
    payload = {
        "user_id": "user-1",
        "session_id": "session-1",
        "scenario_id": "scenario-1",
        "skill_type": "conflict_resolution",
        "confidence_score": 82,
        "clarity_score": 76,
        "empathy_score": 70,
        "overall_score": 78,
    }

    create_response = client.post("/api/v1/analytics/session-metrics", json=payload)

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["id"] > 0
    assert created["user_id"] == payload["user_id"]
    assert created["overall_score"] == payload["overall_score"]

    get_response = client.get(f"/api/v1/analytics/session-metrics/{created['id']}")

    assert get_response.status_code == 200
    assert get_response.json()["session_id"] == payload["session_id"]


def test_list_session_metrics_by_user(client):
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "user-list",
            "session_id": "session-list",
            "confidence_score": 64,
        },
    )

    response = client.get("/api/v1/analytics/users/user-list/session-metrics")

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["confidence_score"] == 64


def test_create_and_list_feedback(client):
    payload = {
        "user_id": "user-2",
        "session_id": "session-2",
        "feedback_type": "peer",
        "skill_area": "active_listening",
        "rating": 72,
        "comment": "Good response, but interrupted too early.",
        "sentiment": "neutral",
    }

    create_response = client.post("/api/v1/analytics/feedback", json=payload)

    assert create_response.status_code == 201
    assert create_response.json()["feedback_type"] == "peer"

    list_response = client.get("/api/v1/analytics/sessions/session-2/feedback")

    assert list_response.status_code == 200
    assert len(list_response.json()) == 1
    assert list_response.json()[0]["skill_area"] == "active_listening"


def test_create_feedback_auto_detects_sentiment_when_missing(client, monkeypatch):
    from app.schemas.analytics import FeedbackSentimentResult
    from app.services import sentiment_analysis_service

    def fake_analyze_feedback_text(text: str):
        return FeedbackSentimentResult(
            text=text,
            cleaned_text="clear and professional",
            sentiment="positive",
            confidence=0.91,
            sentiment_score=0.91,
            class_probabilities={"negative": 0.09, "positive": 0.91},
            model_version="tfidf-sentiment-model-comparison-v1",
            model_type="TF-IDF + Logistic Regression",
            source="ml_model",
        )

    monkeypatch.setattr(
        sentiment_analysis_service,
        "analyze_feedback_text",
        fake_analyze_feedback_text,
    )

    response = client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "auto-sentiment-user",
            "session_id": "auto-sentiment-session",
            "feedback_type": "peer",
            "comment": "Clear and professional response.",
        },
    )

    assert response.status_code == 201
    assert response.json()["sentiment"] == "positive"


def test_a_supplied_sentiment_becomes_the_declared_one_and_the_model_still_reads_the_text(client):
    """The author's own view never suppresses the NLP reading.

    Previously a supplied sentiment stopped the model from running at all, which
    meant the sentiment module never executed on the production path. Both are
    now kept: what the author said, and what the model read.
    """
    response = client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "manual-sentiment-user",
            "session_id": "manual-sentiment-session",
            "feedback_type": "peer",
            "comment": "This is mixed feedback.",
            "sentiment": "neutral",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["declared_sentiment"] == "neutral"        # what the author said
    assert body["sentiment_source"] == "model"            # the model did run
    assert body["sentiment"] in {"positive", "neutral", "negative"}
    assert body["sentiment_model_version"]


def test_generated_feedback_is_not_put_through_the_model(client, monkeypatch):
    """System-written templates already carry a rule-derived label."""
    from app.services import sentiment_analysis_service

    def fail_if_called(text: str):
        raise AssertionError("generated text must not be classified")

    monkeypatch.setattr(sentiment_analysis_service, "analyze_feedback_text", fail_if_called)

    response = client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "generated-sentiment-user",
            "session_id": "generated-sentiment-session",
            "feedback_type": "system",
            "comment": "Adaptive pedagogy selected a personalized strategy.",
            "sentiment": "neutral",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["sentiment"] == "neutral"
    assert body["sentiment_source"] == "rule"
    assert body["declared_sentiment"] is None


def test_create_feedback_saves_when_sentiment_model_is_unavailable(client, monkeypatch):
    from app.services import sentiment_analysis_service

    def fake_analyze_feedback_text(text: str):
        raise sentiment_analysis_service.SentimentModelUnavailableError("model missing")

    monkeypatch.setattr(
        sentiment_analysis_service,
        "analyze_feedback_text",
        fake_analyze_feedback_text,
    )

    response = client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "missing-model-user",
            "session_id": "missing-model-session",
            "feedback_type": "peer",
            "comment": "Clear and professional response.",
        },
    )

    assert response.status_code == 201
    assert response.json()["sentiment"] is None


def test_analyze_feedback_sentiment_returns_model_prediction(client, monkeypatch):
    from app.schemas.analytics import FeedbackSentimentResult
    from app.services import sentiment_analysis_service

    def fake_analyze_feedback_text(text: str):
        return FeedbackSentimentResult(
            text=text,
            cleaned_text="your communication was clear",
            sentiment="positive",
            confidence=0.88,
            sentiment_score=0.88,
            class_probabilities={"negative": 0.12, "positive": 0.88},
            model_version="tfidf-sentiment-model-comparison-v1",
            model_type="TF-IDF + Logistic Regression",
            source="ml_model",
        )

    monkeypatch.setattr(
        sentiment_analysis_service,
        "analyze_feedback_text",
        fake_analyze_feedback_text,
    )

    response = client.post(
        "/api/v1/analytics/feedback/sentiment",
        json={"text": "Your communication was clear."},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["sentiment"] == "positive"
    assert data["confidence"] == 0.88
    assert data["model_type"] == "TF-IDF + Logistic Regression"


def test_analyze_feedback_sentiment_returns_503_when_model_missing(client, monkeypatch):
    from app.services import sentiment_analysis_service

    def fake_analyze_feedback_text(text: str):
        raise sentiment_analysis_service.SentimentModelUnavailableError("model missing")

    monkeypatch.setattr(
        sentiment_analysis_service,
        "analyze_feedback_text",
        fake_analyze_feedback_text,
    )

    response = client.post(
        "/api/v1/analytics/feedback/sentiment",
        json={"text": "Your communication was clear."},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "model missing"


def test_create_and_list_predictions(client):
    payload = {
        "user_id": "user-3",
        "session_id": "session-3",
        "predicted_skill": "confidence",
        "current_score": 68,
        "predicted_score": 74,
        "trend_label": "improving",
        "risk_level": "low",
        "recommendation": "Continue practicing concise responses.",
    }

    create_response = client.post("/api/v1/analytics/predictions", json=payload)

    assert create_response.status_code == 201
    assert create_response.json()["predicted_skill"] == "confidence"

    list_response = client.get("/api/v1/analytics/users/user-3/predictions")

    assert list_response.status_code == 200
    assert len(list_response.json()) == 1
    assert list_response.json()[0]["trend_label"] == "improving"


def test_score_validation_rejects_invalid_value(client):
    response = client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "user-4",
            "session_id": "session-4",
            "confidence_score": 101,
        },
    )

    assert response.status_code == 422


def test_session_aggregate_combines_metrics_feedback_and_predictions(client):
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "aggregate-user",
            "session_id": "aggregate-session",
            "confidence_score": 80,
            "clarity_score": 70,
            "overall_score": 75,
        },
    )
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "aggregate-user",
            "session_id": "aggregate-session",
            "confidence_score": 90,
            "clarity_score": 80,
            "overall_score": 85,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "aggregate-user",
            "session_id": "aggregate-session",
            "feedback_type": "self",
            "rating": 88,
            "sentiment": "positive",
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "aggregate-user",
            "session_id": "aggregate-session",
            "feedback_type": "peer",
            "rating": 72,
            "sentiment": "neutral",
        },
    )
    client.post(
        "/api/v1/analytics/predictions",
        json={
            "user_id": "aggregate-user",
            "session_id": "aggregate-session",
            "predicted_skill": "confidence",
            "current_score": 85,
            "predicted_score": 89,
            "trend_label": "improving",
            "risk_level": "low",
        },
    )

    response = client.get("/api/v1/analytics/sessions/aggregate-session/aggregate")

    assert response.status_code == 200
    data = response.json()
    assert data["scope"] == "session"
    assert data["user_id"] == "aggregate-user"
    assert data["session_id"] == "aggregate-session"
    assert data["scores"]["metric_count"] == 2
    assert data["scores"]["averages"]["confidence_score"] == 85
    assert data["scores"]["averages"]["overall_score"] == 80
    assert data["feedback"]["total_count"] == 2
    assert data["feedback"]["by_type"]["self"] == 1
    assert data["feedback"]["by_type"]["peer"] == 1
    assert data["feedback"]["sentiment_counts"]["positive"] == 1
    assert data["feedback"]["average_rating"] == 80
    assert data["predictions"]["total_count"] == 1
    assert data["predictions"]["risk_counts"]["low"] == 1
    assert data["predictions"]["trend_counts"]["improving"] == 1
    assert data["data_completeness"] == {
        "has_session_metrics": True,
        "has_feedback": True,
        "has_predictions": True,
    }


def test_component_integration_maps_real_session_data_into_analytics(client):
    payload = {
        "user_id": "integration-user",
        "session_id": "integration-session-1",
        "scenario_id": "scenario-hr-conflict",
        "skill_type": "communication",
        "survey_profile": {
            "ocean_scores": {"openness": 74, "conscientiousness": 68},
            "dominant_traits": ["openness", "conscientiousness"],
        },
        "adaptive_plan": {
            "skill": "communication",
            "strategy": "guided_reflection",
            "difficulty": "medium",
            "recommended_scenario_ids": ["scenario-hr-conflict"],
            "primary_scenario": "scenario-hr-conflict",
            "generation_source": "adaptive_pedagogy",
        },
        "mca_nudges": [
            {
                "emotion": "calm",
                "confidence": 0.8,
                "nudge": "Speech pace stayed clear.",
                "nudge_category": "pace",
                "nudge_severity": "info",
            },
            {
                "emotion": "uncertain",
                "confidence": 0.7,
                "nudge": "Volume dropped during disagreement.",
                "nudge_category": "volume",
                "nudge_severity": "warning",
            },
        ],
        "self_feedback": {
            "feedback_type": "self",
            "skill_area": "confidence",
            "rating": 86,
            "comment": "I felt confident during the final response.",
            "sentiment": "positive",
        },
        "peer_feedback": [
            {
                "feedback_type": "peer",
                "skill_area": "confidence",
                "rating": 72,
                "comment": "Legacy peer payload should not be imported by the integration flow.",
                "sentiment": "neutral",
            }
        ],
    }

    response = client.post("/api/v1/analytics/integrations/session-complete", json=payload)

    assert response.status_code == 201
    data = response.json()
    assert data["mapping_version"] == "component-contract-mapping-v1"
    assert data["user_id"] == "integration-user"
    assert data["session_id"] == "integration-session-1"
    assert data["scenario_id"] == "scenario-hr-conflict"
    assert data["source_summary"] == {
        "has_survey_profile": True,
        "has_adaptive_plan": True,
        "mca_nudge_count": 2,
            "submitted_feedback_count": 1,
            "generated_feedback_count": 4,
    }

    metric = data["metric"]
    # These four had no source but role-play turn scores. A multimodal session
    # fills them from its own per-skill scores (see the test below); this
    # payload carries only nudges, so they stay empty rather than defaulting.
    assert metric["confidence_score"] is None
    assert metric["empathy_score"] is None
    assert metric["clarity_score"] is None
    assert metric["response_quality_score"] is None
    assert metric["speech_pace_score"] == 96
    assert metric["speech_volume_score"] == 61
    assert metric["overall_score"] is not None

    assert data["aggregate"]["scores"]["metric_count"] == 1
    # 4 generated + 1 self. Was 6 while a role-play outcome added a fifth
    # generated entry.
    assert data["aggregate"]["feedback"]["total_count"] == 5
    # One of the three system entries came from the role-play outcome.
    assert data["aggregate"]["feedback"]["by_type"]["system"] >= 2
    assert data["aggregate"]["feedback"]["by_type"]["self"] == 1
    assert "peer" not in data["aggregate"]["feedback"]["by_type"]

    aggregate_response = client.get("/api/v1/analytics/sessions/integration-session-1/aggregate")
    assert aggregate_response.status_code == 200
    assert aggregate_response.json()["data_completeness"]["has_session_metrics"] is True


def test_component_integration_maps_mca_skill_scores_directly(client):
    """The MCA engine's own per-skill scores map straight onto the composite
    metric columns (MCA's `emotional_regulation` -> analytics emotional_intelligence)."""
    payload = {
        "user_id": "mca-skill-user",
        "session_id": "mca-skill-session-1",
        "skill_type": "communication",
        "mca_nudges": [
            {
                "emotion": "neutral",
                "confidence": 0.5,
                "nudge": "Speaking pace is a little fast.",
                "nudge_category": "pace",
                "nudge_severity": "warning",
            }
        ],
        "mca_skill_scores": {
            "vocal_command": 78,
            "speech_fluency": 71,
            "presence_engagement": 80,
            "emotional_regulation": 65,
        },
        "mca_overall_score": 74,
    }

    response = client.post("/api/v1/analytics/integrations/session-complete", json=payload)

    assert response.status_code == 201
    metric = response.json()["metric"]

    # vocal_command -> speech_volume_score
    assert metric["speech_volume_score"] == 78
    # speech_fluency -> speech_pace_score + clarity_score (composite avg == 71)
    assert metric["speech_pace_score"] == 71
    assert metric["clarity_score"] == 71
    # presence_engagement -> eye_contact_score + confidence_score (composite avg == 80)
    assert metric["eye_contact_score"] == 80
    assert metric["confidence_score"] == 80
    # emotional_regulation -> empathy_score + emotional_control_score (composite avg == 65)
    assert metric["empathy_score"] == 65
    assert metric["emotional_control_score"] == 65
    # Overall is the MCA session score.
    assert metric["overall_score"] == 74


def test_post_session_report_combines_session_analytics(client):
    """A self-rating far from the observed score is a blind spot.

    Metrics and feedback must belong to the same learner and session: a blind
    spot is the distance between what someone thought and what was measured, so
    with no measurement there is nothing to be distant from.
    """
    session_id = "blind-session"
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "blind-user",
            "session_id": session_id,
            # presence_engagement reads eye_contact and confidence together
            "eye_contact_score": 55,
            "confidence_score": 55,
            # emotional_intelligence reads empathy and emotional_control together
            "empathy_score": 82,
            "emotional_control_score": 82,
            # speech_fluency reads pace and clarity together
            "speech_pace_score": 74,
            "clarity_score": 74,
            "overall_score": 70,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "blind-user",
            "session_id": session_id,
            "feedback_type": "self",
            "skill_area": "presence_engagement",
            "rating": 92,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "blind-user",
            "session_id": session_id,
            "feedback_type": "self",
            "skill_area": "emotional_intelligence",
            "rating": 56,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "blind-user",
            "session_id": session_id,
            "feedback_type": "self",
            "skill_area": "speech_fluency",
            "rating": 78,
        },
    )

    response = client.get("/api/v1/analytics/sessions/blind-session/blind-spots")

    assert response.status_code == 200
    data = response.json()
    assert data["scope"] == "session"
    assert data["user_id"] == "blind-user"
    assert data["session_id"] == "blind-session"
    assert data["summary"]["total_count"] == 2
    assert data["summary"]["high_count"] == 1
    assert data["summary"]["medium_count"] == 1
    assert data["summary"]["low_count"] == 0
    assert data["summary"]["strongest_blind_spot"]["skill_area"] == "presence_engagement"
    assert data["detection_version"] == "rule-based-v1"

    blind_spots = {item["skill_area"]: item for item in data["blind_spots"]}
    # rated 92, measured 55
    assert blind_spots["presence_engagement"]["blind_spot_type"] == "overestimation"
    assert blind_spots["presence_engagement"]["severity"] == "high"
    assert blind_spots["presence_engagement"]["comparison_source"] == "observed"
    assert blind_spots["presence_engagement"]["gap"] == 37
    # rated 56, measured 82
    assert blind_spots["emotional_intelligence"]["blind_spot_type"] == "underestimation"
    assert blind_spots["emotional_intelligence"]["severity"] == "medium"
    assert blind_spots["emotional_intelligence"]["gap"] == 26
    # Self-rating within the tolerance of observed performance is not a blind spot.
    assert "speech_fluency" not in blind_spots


def test_user_blind_spots_returns_empty_result_for_unknown_user(client):
    response = client.get("/api/v1/analytics/users/no-blind-user/blind-spots")

    assert response.status_code == 200
    data = response.json()
    assert data["scope"] == "user"
    assert data["user_id"] == "no-blind-user"
    assert data["summary"] == {
        "total_count": 0,
        "high_count": 0,
        "medium_count": 0,
        "low_count": 0,
        "strongest_blind_spot": None,
        "sentiment_gap_count": 0,
    }
    assert data["blind_spots"] == []
    assert data["sentiment_gaps"] == []


def test_user_progress_trends_detects_improving_declining_and_stable_skills(client):
    session_payloads = [
        {
            "session_id": "trend-session-1",
            # Each tracked skill is a composite of two metric columns, so both
            # halves are written; the trend value is their mean.
            "speech_volume_score": 60,                                  # vocal_command
            "speech_pace_score": 72, "clarity_score": 72,               # speech_fluency
            "eye_contact_score": 55, "confidence_score": 55,            # presence_engagement
            "empathy_score": 90, "emotional_control_score": 90,         # emotional_intelligence
            "overall_score": 70,
        },
        {
            "session_id": "trend-session-2",
            "speech_volume_score": 68,
            "speech_pace_score": 73, "clarity_score": 73,
            "eye_contact_score": 65, "confidence_score": 65,
            "empathy_score": 82, "emotional_control_score": 82,
            "overall_score": 74,
        },
        {
            "session_id": "trend-session-3",
            "speech_volume_score": 74,
            "speech_pace_score": 74, "clarity_score": 74,
            "eye_contact_score": 78, "confidence_score": 78,
            "empathy_score": 70, "emotional_control_score": 70,
            "overall_score": 80,
        },
    ]

    for payload in session_payloads:
        client.post(
            "/api/v1/analytics/session-metrics",
            json={
                "user_id": "trend-user",
                **payload,
            },
        )

    response = client.get("/api/v1/analytics/users/trend-user/progress-trends")

    assert response.status_code == 200
    data = response.json()
    assert data["user_id"] == "trend-user"
    assert data["trend_version"] == "rule-based-v1"
    assert data["summary"]["improving_count"] >= 2
    assert data["summary"]["declining_count"] == 1
    assert data["summary"]["stable_count"] == 1
    assert data["summary"]["strongest_improvement"]["skill_area"] == "presence_engagement"
    assert data["summary"]["strongest_decline"]["skill_area"] == "emotional_intelligence"

    trends = {item["skill_area"]: item for item in data["trends"]}
    assert trends["presence_engagement"]["trend_label"] == "improving"
    assert trends["presence_engagement"]["first_score"] == 55
    assert trends["presence_engagement"]["latest_score"] == 78
    assert trends["presence_engagement"]["delta"] == 23
    assert trends["presence_engagement"]["slope"] == 11.5
    assert len(trends["presence_engagement"]["points"]) == 3
    assert trends["emotional_intelligence"]["trend_label"] == "declining"
    assert trends["emotional_intelligence"]["delta"] == -20
    assert trends["speech_fluency"]["trend_label"] == "stable"
    # Every tracked skill has data here, so none falls back to insufficient_data.
    assert trends["vocal_command"]["trend_label"] == "improving"


def test_user_skill_progress_trend_returns_single_skill(client):
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "single-trend-user",
            "session_id": "single-trend-session-1",
            "speech_volume_score": 60,
        },
    )
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "single-trend-user",
            "session_id": "single-trend-session-2",
            "speech_volume_score": 68,
        },
    )

    response = client.get(
        "/api/v1/analytics/users/single-trend-user/progress-trends/vocal_command"
    )

    assert response.status_code == 200
    data = response.json()
    assert data["skill_area"] == "vocal_command"
    assert data["trend_label"] == "improving"
    assert data["delta"] == 8
    assert data["session_count"] == 2


def test_user_skill_progress_trend_rejects_overall_as_a_skill(client):
    """Overall is a summary of the four skills, not a skill, so it has no trend."""
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "no-overall-trend-user",
            "session_id": "no-overall-trend-session-1",
            "overall_score": 60,
        },
    )

    response = client.get(
        "/api/v1/analytics/users/no-overall-trend-user/progress-trends/overall"
    )

    assert response.status_code == 200
    data = response.json()
    assert data["skill_area"] == "overall"
    assert data["trend_label"] == "insufficient_data"


def test_user_progress_trends_can_filter_history_up_to_selected_session(client):
    for session_id, confidence_score in [
        ("trend-cutoff-session-1", 40),
        ("trend-cutoff-session-2", 60),
        ("trend-cutoff-session-3", 90),
    ]:
        response = client.post(
            "/api/v1/analytics/session-metrics",
            json={
                "user_id": "trend-cutoff-user",
                "session_id": session_id,
                "confidence_score": confidence_score,
            },
        )
        assert response.status_code == 201

    response = client.get(
        "/api/v1/analytics/users/trend-cutoff-user/progress-trends",
        params={"session_id": "trend-cutoff-session-2"},
    )

    assert response.status_code == 200
    # confidence_score is one half of presence_engagement; with no eye_contact
    # score recorded the composite is the confidence figure alone.
    trends = {item["skill_area"]: item for item in response.json()["trends"]}
    assert trends["presence_engagement"]["session_count"] == 2
    assert trends["presence_engagement"]["first_score"] == 40
    assert trends["presence_engagement"]["latest_score"] == 60
    assert trends["presence_engagement"]["delta"] == 20


def test_user_progress_trends_returns_insufficient_data_for_unknown_user(client):
    response = client.get("/api/v1/analytics/users/no-trend-user/progress-trends")

    assert response.status_code == 200
    data = response.json()
    assert data["user_id"] == "no-trend-user"
    assert data["summary"]["improving_count"] == 0
    assert data["summary"]["declining_count"] == 0
    assert data["summary"]["stable_count"] == 0
    assert data["summary"]["insufficient_data_count"] == data["summary"]["analyzed_skill_count"]
    assert all(item["trend_label"] == "insufficient_data" for item in data["trends"])


def test_user_predicted_outcomes_generates_baseline_risk_predictions(client):
    session_payloads = [
        {
            "session_id": "prediction-session-1",
            "speech_volume_score": 60,
            "speech_pace_score": 72, "clarity_score": 72,
            "eye_contact_score": 55, "confidence_score": 55,
            "empathy_score": 90, "emotional_control_score": 90,
            "overall_score": 70,
        },
        {
            "session_id": "prediction-session-2",
            "speech_volume_score": 68,
            "speech_pace_score": 73, "clarity_score": 73,
            "eye_contact_score": 65, "confidence_score": 65,
            "empathy_score": 72, "emotional_control_score": 72,
            "overall_score": 74,
        },
        {
            "session_id": "prediction-session-3",
            "speech_volume_score": 74,
            "speech_pace_score": 74, "clarity_score": 74,
            "eye_contact_score": 78, "confidence_score": 78,
            "empathy_score": 45, "emotional_control_score": 45,
            "overall_score": 80,
        },
    ]

    for payload in session_payloads:
        client.post(
            "/api/v1/analytics/session-metrics",
            json={
                "user_id": "prediction-user",
                **payload,
            },
        )

    response = client.get("/api/v1/analytics/users/prediction-user/predicted-outcomes")

    assert response.status_code == 200
    data = response.json()
    assert data["user_id"] == "prediction-user"
    assert data["model_version"] == "rule-based-baseline-v1"
    # One prediction per tracked skill. "Overall" is a summary of the four, not
    # a fifth skill, so it is not predicted separately.
    assert data["summary"]["predicted_count"] == 4
    assert data["summary"]["high_risk_count"] == 1
    assert data["summary"]["low_risk_count"] >= 2
    assert (
        data["summary"]["highest_risk_prediction"]["predicted_skill"]
        == "emotional_intelligence"
    )

    predictions = {item["predicted_skill"]: item for item in data["predictions"]}
    assert predictions["presence_engagement"]["risk_level"] == "low"
    assert predictions["speech_fluency"]["risk_level"] == "low"
    assert predictions["emotional_intelligence"]["risk_level"] == "high"
    # A falling skill is projected to keep falling, a rising one to keep rising.
    assert (
        predictions["emotional_intelligence"]["predicted_score"]
        < predictions["emotional_intelligence"]["current_score"]
    )
    assert (
        predictions["presence_engagement"]["predicted_score"]
        > predictions["presence_engagement"]["current_score"]
    )


def test_user_predicted_outcomes_uses_ml_model_when_feedback_evidence_exists(client, monkeypatch):
    from app.services import ml_predictive_model_service

    def fake_ml_prediction(features):
        assert features["current_score"] == 62
        assert features["previous_score"] == 72
        assert features["trend_slope"] == -10
        assert features["average_feedback_rating"] == 58
        assert features["sentiment_score"] == -1
        return {
            "predicted_score": 44.5,
            "risk_level": "high",
            "confidence": 0.91,
            "model_version": "ml-predictive-behavioral-analytics-v1",
            "model_type": {
                "regressor": "linear_regression",
                "classifier": "gradient_boosting_classifier",
            },
        }

    monkeypatch.setattr(ml_predictive_model_service, "predict_behavioral_outcome", fake_ml_prediction)

    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "ml-prediction-user",
            "session_id": "ml-prediction-session-1",
            "confidence_score": 72,
        },
    )
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "ml-prediction-user",
            "session_id": "ml-prediction-session-2",
            "confidence_score": 62,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "ml-prediction-user",
            "session_id": "ml-prediction-session-2",
            "feedback_type": "self",
            "skill_area": "presence_engagement",
            "rating": 58,
            "comment": "The answer was unclear and needs stronger confidence.",
            "sentiment": "negative",
        },
    )

    response = client.get("/api/v1/analytics/users/ml-prediction-user/predicted-outcomes")

    assert response.status_code == 200
    data = response.json()
    assert data["model_version"] == "ml-predictive-behavioral-analytics-v1"
    prediction = data["predictions"][0]
    assert prediction["predicted_skill"] == "presence_engagement"
    assert prediction["predicted_score"] == 52
    assert prediction["risk_level"] == "high"
    assert prediction["confidence"] == 0.91


def test_user_predicted_outcomes_can_use_trained_model_artifact(client):
    model_path = (
        Path(__file__).resolve().parents[2]
        / "training"
        / "feedback_analytics"
        / "models"
        / "predictive_behavior_model.joblib"
    )
    if not model_path.exists():
        pytest.skip("Train predictive_behavior_model.joblib before running the real model API smoke test.")

    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "real-ml-api-user",
            "session_id": "real-ml-api-session-1",
            "confidence_score": 68,
        },
    )
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "real-ml-api-user",
            "session_id": "real-ml-api-session-2",
            "confidence_score": 74,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "real-ml-api-user",
            "session_id": "real-ml-api-session-2",
            "feedback_type": "self",
            "skill_area": "presence_engagement",
            "rating": 72,
            "comment": "The learner showed better confidence and clearer delivery.",
            "sentiment": "positive",
        },
    )

    response = client.get("/api/v1/analytics/users/real-ml-api-user/predicted-outcomes/presence_engagement")

    assert response.status_code == 200
    data = response.json()
    assert data["predicted_skill"] == "presence_engagement"
    assert data["current_score"] == 74
    assert data["predicted_score"] is not None
    assert 0 <= data["predicted_score"] <= 100
    assert data["risk_level"] in {"low", "medium", "high"}


def test_user_predicted_outcomes_calibrates_extreme_ml_prediction(client, monkeypatch):
    """A high but informative prediction is pulled back toward the evidence.

    95 is extreme for a learner sitting at 40, and it is still a reading: the
    model distinguished this input from others. It gets blended and bounded
    rather than discarded. Contrast with the saturation test below, where the
    model returns the very top of its range and has stopped distinguishing
    anything at all.
    """
    from app.services import ml_predictive_model_service

    user_id = "calibrated-ml-user"
    feedback_payloads = [
        {
            "user_id": user_id,
            "session_id": "calibrated-session-1",
            "feedback_type": "self",
            "skill_area": "presence_engagement",
            "rating": 84,
            "sentiment": "positive",
        },
        {
            "user_id": user_id,
            "session_id": "calibrated-session-2",
            "feedback_type": "self",
            "skill_area": "presence_engagement",
            "rating": 58,
            "sentiment": "neutral",
        },
        {
            "user_id": user_id,
            "session_id": "calibrated-session-3",
            "feedback_type": "self",
            "skill_area": "presence_engagement",
            "rating": 40,
            "sentiment": "negative",
        },
    ]
    for payload in feedback_payloads:
        response = client.post("/api/v1/analytics/feedback", json=payload)
        assert response.status_code == 201

    def fake_extreme_ml_prediction(_features):
        return {
            "predicted_score": 95,
            "risk_level": "high",
            "confidence": 0.91,
            "model_version": "fake-extreme-model",
        }

    monkeypatch.setattr(
        ml_predictive_model_service,
        "predict_behavioral_outcome",
        fake_extreme_ml_prediction,
    )

    response = client.get(f"/api/v1/analytics/users/{user_id}/predicted-outcomes/presence_engagement")
    assert response.status_code == 200

    data = response.json()
    assert data["current_score"] == 40
    # The raw 95 is pulled most of the way back to the evidence, and never
    # further from the current score than the allowed step for this little
    # history. The exact landing point depends on the blend weight; that it
    # cannot run away from the evidence is the property worth pinning.
    assert data["predicted_score"] < 95
    assert data["predicted_score"] - data["current_score"] <= 10
    assert data["risk_level"] == "high"
    assert 0 <= data["confidence"] <= 1
    assert data["evidence_points"] == 3



def test_a_saturated_ml_prediction_is_discarded(client, monkeypatch):
    """A model pinned to the top of its range is not predicting anything.

    On real learner histories the trained regressor returns exactly 100.0 for
    every skill. Blended at 55% that made every visible prediction "current score
    + 15", shown beside a declining trend and a recommendation warning about
    decline - three parts of one screen contradicting each other. A reading at
    the boundary is treated as no reading, and the trend projection is used.
    """
    from app.services import ml_predictive_model_service

    user_id = "saturated-ml-user"
    for index, value in enumerate([80, 70, 60], start=1):
        client.post(
            "/api/v1/analytics/session-metrics",
            json={
                "user_id": user_id,
                "session_id": f"saturated-session-{index}",
                "eye_contact_score": value,
                "confidence_score": value,
            },
        )
        client.post(
            "/api/v1/analytics/feedback",
            json={
                "user_id": user_id,
                "session_id": f"saturated-session-{index}",
                "feedback_type": "self",
                "skill_area": "presence_engagement",
                "rating": value,
            },
        )

    monkeypatch.setattr(
        ml_predictive_model_service,
        "predict_behavioral_outcome",
        lambda _features: {
            "predicted_score": 100.0,
            "risk_level": "low",
            "confidence": 0.95,
            "model_version": "saturated-model",
            "model_type": {"regressor": "linear_regression"},
        },
    )

    response = client.get(f"/api/v1/analytics/users/{user_id}/predicted-outcomes")

    assert response.status_code == 200
    data = response.json()
    assert data["model_version"] == "rule-based-baseline-v1"

    prediction = {
        item["predicted_skill"]: item for item in data["predictions"]
    }["presence_engagement"]
    # Falling, so the projection falls too - not "+15 and a warning".
    assert prediction["predicted_score"] <= prediction["current_score"]

def test_user_skill_predicted_outcome_returns_single_prediction(client):
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "single-prediction-user",
            "session_id": "single-prediction-session-1",
            "speech_volume_score": 60,
        },
    )
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "single-prediction-user",
            "session_id": "single-prediction-session-2",
            "speech_volume_score": 68,
        },
    )

    response = client.get(
        "/api/v1/analytics/users/single-prediction-user/predicted-outcomes/vocal_command"
    )

    assert response.status_code == 200
    data = response.json()
    assert data["predicted_skill"] == "vocal_command"
    assert data["current_score"] == 68
    assert data["predicted_score"] == 76
    assert data["trend_label"] == "improving"
    assert data["risk_level"] == "low"
    assert data["evidence_points"] == 2


def test_user_skill_predicted_outcome_handles_insufficient_data(client):
    response = client.get("/api/v1/analytics/users/no-prediction-user/predicted-outcomes/confidence")

    assert response.status_code == 200
    data = response.json()
    assert data["predicted_skill"] == "confidence"
    assert data["predicted_score"] is None
    assert data["risk_level"] == "medium"
    assert data["confidence"] == 0.2
    assert data["evidence_points"] == 0


def test_user_mentoring_recommendations_returns_rule_based_fallback(client, monkeypatch):
    from app.services import llm_mentoring_service

    monkeypatch.setattr(llm_mentoring_service, "_call_openai_mentoring", lambda evidence: None)

    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "mentor-user",
            "session_id": "mentor-session-1",
            "confidence_score": 74,
            "empathy_score": 88,
        },
    )
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "mentor-user",
            "session_id": "mentor-session-2",
            "confidence_score": 58,
            "empathy_score": 80,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "mentor-user",
            "session_id": "mentor-session-2",
            "feedback_type": "self",
            "skill_area": "confidence",
            "rating": 92,
            "sentiment": "positive",
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "mentor-user",
            "session_id": "mentor-session-2",
            "feedback_type": "peer",
            "skill_area": "confidence",
            "rating": 60,
            "sentiment": "neutral",
        },
    )

    response = client.get("/api/v1/analytics/users/mentor-user/mentoring-recommendations")

    assert response.status_code == 200
    data = response.json()
    assert data["user_id"] == "mentor-user"
    assert data["source"] == "rule_based"
    assert data["model_version"] == "rule-based-mentoring-v1"
    assert data["evidence"]["session_count"] == 2
    # feedback_count is now the number of sessions the learner rated themselves
    # on, not the number of rows in the feedback table. The row count showed 392
    # on the development account - two thirds of it notes this codebase wrote
    # itself - beside "Sessions 118", which read as "you gave 392 pieces of
    # feedback". Only one of these two sessions was self-assessed.
    assert data["evidence"]["feedback_count"] == 1
    assert data["evidence"]["feedback_entry_count"] == 2
    assert data["recommendations"]
    assert data["recommendations"][0]["priority"] in {"high", "medium"}
    assert data["recommendations"][0]["next_action"]


def test_user_mentoring_recommendations_can_use_llm_output(client, monkeypatch):
    from app.schemas.analytics import MentoringRecommendationItem
    from app.services import llm_mentoring_service

    def fake_llm(evidence):
        assert evidence["summary"]["session_count"] == 2
        return [
            MentoringRecommendationItem(
                priority="high",
                skill_area="confidence",
                title="Practice confident delivery",
                reason="Confidence evidence is below the target benchmark.",
                detail="Use shorter answers with clear opening and closing statements.",
                next_action="Record one response and compare it with peer feedback.",
                source="llm",
                evidence_sources=["skill_twin_scores", "feedback_analysis"],
            )
        ]

    class FakeSettings:
        openai_api_key = "test-key"
        openai_base_url = "https://api.openai.com/v1"
        openai_mentoring_model = "gpt-test-mentoring"
        llm_mentoring_timeout_s = 1.0

    monkeypatch.setattr(llm_mentoring_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(llm_mentoring_service, "_call_openai_mentoring", fake_llm)

    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "llm-mentor-user",
            "session_id": "llm-mentor-session-1",
            "confidence_score": 62,
        },
    )
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "llm-mentor-user",
            "session_id": "llm-mentor-session-2",
            "confidence_score": 66,
        },
    )

    response = client.get("/api/v1/analytics/users/llm-mentor-user/mentoring-recommendations")

    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "llm"
    assert data["model_version"]
    assert data["recommendations"][0]["source"] == "llm"
    assert data["recommendations"][0]["title"] == "Practice confident delivery"


# ---------------------------------------------------------------------------
# Sentiment blind spots — the gap between what a learner rated and what they wrote
# ---------------------------------------------------------------------------

def _self_entry(client, user_id, session_id, comment, declared, skill="presence_engagement"):
    return client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": user_id,
            "session_id": session_id,
            "feedback_type": "self",
            "skill_area": skill,
            "rating": 70,
            "comment": comment,
            "sentiment": declared,
        },
    )


def test_a_negative_rating_over_positive_words_is_reported_as_a_gap(client):
    """The text-based counterpart of a rating blind spot.

    Only this direction is reported. The reverse - a positive rating over words
    the model reads as negative - was measured at 43% precision on workplace text
    and is suppressed; see TRUSTED_DETECTED_SENTIMENTS in blind_spot_service.
    """
    created = _self_entry(
        client,
        "sent-gap-user",
        "sent-gap-session",
        "I am proud of how I handled that and I listened properly before replying.",
        "negative",
    )
    assert created.status_code == 201
    entry = created.json()
    assert entry["sentiment_source"] == "model"

    response = client.get("/api/v1/analytics/sessions/sent-gap-session/blind-spots")
    assert response.status_code == 200
    data = response.json()

    if entry["sentiment"] != "positive":
        pytest.skip("model did not read this wording as positive")

    gaps = data["sentiment_gaps"]
    assert len(gaps) == 1
    gap = gaps[0]
    assert gap["declared_sentiment"] == "negative"
    assert gap["detected_sentiment"] == "positive"
    assert gap["severity"] in {"medium", "high"}
    assert gap["comment_excerpt"].startswith("I am proud of how I handled that")
    assert gap["recommendation"]
    assert data["summary"]["sentiment_gap_count"] == 1


def test_a_positive_rating_over_negative_words_is_not_reported(client):
    """The direction the model has not earned stays out of the findings."""
    created = _self_entry(
        client,
        "sent-suppressed-user",
        "sent-suppressed-session",
        "I kept losing my train of thought and the whole thing felt awkward and rushed.",
        "positive",
    )
    assert created.status_code == 201
    entry = created.json()
    if entry["sentiment"] != "negative":
        pytest.skip("model did not read this wording as negative")

    response = client.get(
        "/api/v1/analytics/sessions/sent-suppressed-session/blind-spots"
    )
    assert response.status_code == 200
    data = response.json()

    # The reading is still stored on the entry and still shown to the learner as
    # a reading. It simply is not promoted into a finding about them.
    assert data["sentiment_gaps"] == []
    assert data["summary"]["sentiment_gap_count"] == 0


def test_agreement_produces_no_gap(client):
    created = _self_entry(
        client,
        "sent-agree-user",
        "sent-agree-session",
        "Great session, I felt confident and the conversation flowed really well.",
        "positive",
    )
    entry = created.json()
    if entry["sentiment"] != "positive":
        pytest.skip("model disagreed with the learner on this wording")

    data = client.get("/api/v1/analytics/sessions/sent-agree-session/blind-spots").json()
    assert data["sentiment_gaps"] == []
    assert data["summary"]["sentiment_gap_count"] == 0


def test_a_low_confidence_reading_is_not_reported_as_a_gap(db_session):
    """The classifier is general-domain; a near-coin-toss must not become a finding."""
    from app.models.analytics import FeedbackEntry
    from app.services import blind_spot_service

    db_session.add(
        FeedbackEntry(
            user_id="sent-lowconf-user",
            session_id="sent-lowconf-session",
            feedback_type="self",
            skill_area="presence_engagement",
            rating=70,
            comment="It went about as well as I expected it to.",
            sentiment="negative",
            declared_sentiment="positive",
            sentiment_confidence=0.51,        # below MIN_SENTIMENT_CONFIDENCE
            sentiment_source="model",
            sentiment_model_version="test-model",
        )
    )
    db_session.commit()

    result = blind_spot_service.detect_session_blind_spots(db_session, "sent-lowconf-session")

    assert result.sentiment_gaps == []
    assert result.summary.sentiment_gap_count == 0


def test_opposite_poles_are_more_severe_than_a_neutral_disagreement(db_session):
    from app.models.analytics import FeedbackEntry
    from app.services import blind_spot_service

    # Both use a detected "positive": that is the only reading trusted to
    # produce a finding, so severity has to be compared within it.
    for session_id, declared, detected in [
        ("sent-sev-opposite", "negative", "positive"),
        ("sent-sev-neutral", "neutral", "positive"),
    ]:
        db_session.add(
            FeedbackEntry(
                user_id="sent-sev-user",
                session_id=session_id,
                feedback_type="self",
                skill_area="presence_engagement",
                rating=70,
                comment="A reflection written by the learner.",
                sentiment=detected,
                declared_sentiment=declared,
                sentiment_confidence=0.82,
                sentiment_source="model",
                sentiment_model_version="test-model",
            )
        )
    db_session.commit()

    opposite = blind_spot_service.detect_session_blind_spots(db_session, "sent-sev-opposite")
    neutral = blind_spot_service.detect_session_blind_spots(db_session, "sent-sev-neutral")

    assert opposite.sentiment_gaps[0].severity == "high"
    assert neutral.sentiment_gaps[0].severity == "medium"


def test_rule_labelled_entries_are_never_treated_as_disagreement(db_session):
    """System templates carry no independent reading, so they cannot disagree."""
    from app.models.analytics import FeedbackEntry
    from app.services import blind_spot_service

    db_session.add(
        FeedbackEntry(
            user_id="sent-rule-user",
            session_id="sent-rule-session",
            feedback_type="system",
            skill_area="presence_engagement",
            comment="Adaptive pedagogy selected a personalized strategy.",
            sentiment="negative",
            declared_sentiment="positive",
            sentiment_confidence=0.95,
            sentiment_source="rule",          # not the model
            sentiment_model_version=None,
        )
    )
    db_session.commit()

    result = blind_spot_service.detect_session_blind_spots(db_session, "sent-rule-session")

    assert result.sentiment_gaps == []


def test_rating_blind_spots_and_sentiment_gaps_are_counted_separately(client):
    """Different evidence, so the learner is not shown one merged number."""
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "sent-mixed-user",
            "session_id": "sent-mixed-session",
            "eye_contact_score": 50,
            "confidence_score": 50,
        },
    )
    _self_entry(
        client,
        "sent-mixed-user",
        "sent-mixed-session",
        "I kept losing my train of thought and the whole thing felt awkward and rushed.",
        "positive",
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "sent-mixed-user",
            "session_id": "sent-mixed-session",
            "feedback_type": "self",
            "skill_area": "presence_engagement",
            "rating": 95,
        },
    )

    data = client.get("/api/v1/analytics/sessions/sent-mixed-session/blind-spots").json()

    # The rating gap — self 95 against 50 observed — is reported as a skill blind spot.
    assert data["summary"]["total_count"] >= 1
    assert any(item["skill_area"] == "presence_engagement" for item in data["blind_spots"])

    # The wording gap is reported separately, carrying the learner's own words
    # rather than a score. Neither list contains the other kind of evidence.
    assert data["summary"]["sentiment_gap_count"] == len(data["sentiment_gaps"])
    assert all("comment_excerpt" in gap for gap in data["sentiment_gaps"])
    assert all("skill_area" not in gap for gap in data["sentiment_gaps"])


# ------------------------------------- overall is the engine's, never a mean

# Deliberately inconsistent: the four composites average to 80, the engine
# recorded 61. Every screen that names this session's overall score has to say
# 61. Real sessions disagree by this much - across the development account the
# two differ on 37 of 99 sessions, by up to 13.5 points - because the engine
# weights its dimensions its own way rather than taking a flat mean.
_MIXED_SESSION = {
    "user_id": "overall-source-user",
    "session_id": "overall-source-session",
    "speech_volume_score": 80,
    "speech_pace_score": 80,
    "clarity_score": 80,
    "eye_contact_score": 80,
    "confidence_score": 80,
    "empathy_score": 80,
    "emotional_control_score": 80,
    "overall_score": 61,
}
_MEAN_OF_THE_FOUR = 80
_ENGINE_OVERALL = 61


def _store_mixed_session(client):
    assert client.post("/api/v1/analytics/session-metrics", json=_MIXED_SESSION).status_code == 201


def test_the_session_aggregate_reports_the_stored_overall(client):
    _store_mixed_session(client)

    response = client.get(f"/api/v1/analytics/sessions/{_MIXED_SESSION['session_id']}/aggregate")

    assert response.status_code == 200
    assert response.json()["scores"]["averages"]["overall_score"] == _ENGINE_OVERALL


def test_the_post_session_report_reports_the_stored_overall(client):
    """This was the mean, which made the report tidy and made it disagree with
    the session. The four skill boxes beside it still read 80."""
    _store_mixed_session(client)

    response = client.get(f"/api/v1/analytics/sessions/{_MIXED_SESSION['session_id']}/report")

    assert response.status_code == 200
    scores = response.json()["skill_scores"]
    assert scores["overall_score"] == _ENGINE_OVERALL
    assert scores["overall_score"] != _MEAN_OF_THE_FOUR


def test_the_skill_score_endpoint_reports_the_stored_overall(client):
    """Its own weighting stands only where the session stored nothing."""
    _store_mixed_session(client)

    response = client.get(f"/api/v1/analytics/sessions/{_MIXED_SESSION['session_id']}/skill-scores")

    assert response.status_code == 200
    assert response.json()["overall_score"] == _ENGINE_OVERALL


def test_the_learner_history_carries_the_stored_overall_separately(client):
    """The dashboard's "All Sessions" headline reads this, not the four skills.

    It is not a fifth entry in `skills`: overall must never get a trend line, a
    prediction or a blind-spot comparison of its own. It is also not derivable
    from the four, so it cannot simply be left out.
    """
    _store_mixed_session(client)

    response = client.get(f"/api/v1/analytics/users/{_MIXED_SESSION['user_id']}/skill-history")

    assert response.status_code == 200
    body = response.json()
    assert body["overall"]["latest_score"] == _ENGINE_OVERALL
    assert body["overall"]["average_score"] == _ENGINE_OVERALL
    assert body["overall"]["skill_area"] == "overall"
    assert "overall" not in {item["skill_area"] for item in body["skills"]}


# ------------------------------------- counting assessments, not rows

# One learner, two sessions, four skills rated in each: eight rows, two
# assessments. The row count and the assessment count are different numbers and
# the screens ask for different ones.
#
# Each test seeds its own user and session ids. The suite shares one SQLite file,
# so a fixed id accumulates rows across tests and the second test to run sees
# eight rows where it wrote four.
_RATED_SKILLS = ("vocal_command", "speech_fluency", "presence_engagement", "emotional_intelligence")


def _rate_every_skill(client, tag):
    """Two sessions, every skill rated 60 and measured 90, plus one generated row."""
    user_id = f"rating-count-{tag}"
    sessions = (f"count-{tag}-a", f"count-{tag}-b")
    for session_id in sessions:
        client.post(
            "/api/v1/analytics/session-metrics",
            json={
                "user_id": user_id,
                "session_id": session_id,
                "speech_volume_score": 90,
                "speech_pace_score": 90,
                "clarity_score": 90,
                "eye_contact_score": 90,
                "confidence_score": 90,
                "empathy_score": 90,
                "emotional_control_score": 90,
                "overall_score": 90,
            },
        )
        # A note the codebase writes itself. Not something the learner rated.
        client.post(
            "/api/v1/analytics/feedback",
            json={
                "user_id": user_id, "session_id": session_id,
                "feedback_type": "system", "skill_area": "vocal_command", "rating": 50,
            },
        )
        for skill in _RATED_SKILLS:
            client.post(
                "/api/v1/analytics/feedback",
                json={
                    "user_id": user_id, "session_id": session_id,
                    "feedback_type": "self", "skill_area": skill, "rating": 60,
                },
            )
    return user_id, sessions


def test_times_you_rated_yourself_counts_assessments_not_rows(client):
    """Across a history the row count answers the wrong question.

    A self-assessment is stored one row per skill. Eight rows here are two
    assessments, and the screen reading this says "Times you rated yourself" -
    on the development account it read 230 for 42 assessments.
    """
    user_id, sessions = _rate_every_skill(client, "history")

    response = client.get(f"/api/v1/analytics/users/{user_id}/feedback-analysis")

    assert response.status_code == 200
    assert response.json()["summary"]["self_feedback_count"] == len(sessions)


def test_within_one_session_the_same_field_counts_skills(client):
    """Same field, different scope, different question - and the screen labels it
    "Skills you rated" here. Inside one session the rows are the skills, so the
    row count is the right answer and must not be collapsed to sessions."""
    _, sessions = _rate_every_skill(client, "session")

    response = client.get(f"/api/v1/analytics/sessions/{sessions[0]}/feedback-analysis")

    assert response.status_code == 200
    assert response.json()["summary"]["self_feedback_count"] == len(_RATED_SKILLS)


def test_the_generated_note_is_not_counted_as_something_the_learner_rated(client):
    """Each session also carries a generated row. It is not a self-rating."""
    _, sessions = _rate_every_skill(client, "generated")

    summary = client.get(
        f"/api/v1/analytics/sessions/{sessions[0]}/feedback-analysis"
    ).json()["summary"]

    assert summary["self_feedback_count"] == 4  # the four skills, not the five rows


def test_the_two_averages_are_weighted_the_same_way(client):
    """They sit side by side to be subtracted, so they have to be one operation.

    The self average was a mean over rows, weighted by how often each skill
    happened to be rated; the observed average gives each skill one vote. Here
    every skill is rated 60 and measured 90, so any weighting gives 60 and 90 -
    what this pins is that the self side reads the per-skill values, which is
    what makes the two comparable once the counts are uneven.
    """
    user_id, _ = _rate_every_skill(client, "weighting")

    summary = client.get(f"/api/v1/analytics/users/{user_id}/feedback-analysis").json()["summary"]

    assert summary["average_self_rating"] == 60
    assert summary["average_observed_score"] == 90


def test_a_reflection_that_was_read_is_reported_as_read(client, monkeypatch):
    """An empty sentiment_gaps list means two different things.

    A learner wrote "I think I don't perform well because I was nervous", chose
    "positive" in the dropdown, and the model read the text as negative at 0.996 -
    correctly. That reading is not promoted into a finding, because the negative
    direction is measured unreliable and stays closed. The panel then said "no
    gaps ... write a reflection after a session to have this checked", to someone
    who had just written one, about a reflection the model had disagreed with.

    The count of reflections read is what lets the screen tell the two apart.
    """
    from app.services import sentiment_analysis_service
    from app.schemas.analytics import FeedbackSentimentResult

    def _read_as_negative(text, model_path=None):
        return FeedbackSentimentResult(
            text=text, cleaned_text=text, sentiment="negative", confidence=0.996,
            sentiment_score=-0.996, class_probabilities={"negative": 0.996},
            model_version="test-model", model_type="test", source="ml_model",
        )

    monkeypatch.setattr(sentiment_analysis_service, "analyze_feedback_text", _read_as_negative)

    session_id = "reflection-read-session"
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "reflection-read-user", "session_id": session_id,
            "feedback_type": "self", "skill_area": "vocal_command", "rating": 75,
            "declared_sentiment": "positive",
            "comment": "I think I don't perform well because I was nervous.",
        },
    )

    body = client.get(f"/api/v1/analytics/sessions/{session_id}/blind-spots").json()

    assert body["sentiment_gaps"] == []       # negative is not promoted
    assert body["reflections_examined"] == 1  # but it was read, and the screen must say so


def test_nothing_written_reports_nothing_examined(client):
    """The other half of the same distinction."""
    session_id = "no-reflection-session"
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "no-reflection-user", "session_id": session_id,
            "feedback_type": "self", "skill_area": "vocal_command", "rating": 75,
        },
    )

    body = client.get(f"/api/v1/analytics/sessions/{session_id}/blind-spots").json()

    assert body["reflections_examined"] == 0


def test_a_resubmitted_rating_does_not_count_twice(client):
    """The form can be submitted again and the rows accumulate rather than replace.

    Averaging every row keeps a rating the learner corrected alive, and gives a
    session that was submitted twice double the weight. Only the latest stands.
    """
    session_id = "resubmit-session"
    for rating in (30, 90):  # they changed their mind; 90 is the answer
        client.post(
            "/api/v1/analytics/feedback",
            json={
                "user_id": "resubmit-user", "session_id": session_id,
                "feedback_type": "self", "skill_area": "vocal_command", "rating": rating,
            },
        )

    summary = client.get(
        f"/api/v1/analytics/sessions/{session_id}/feedback-analysis"
    ).json()["summary"]

    assert summary["average_self_rating"] == 90  # not 60, the mean of both rows
    assert summary["self_feedback_count"] == 1   # one skill rated, not two rows


def test_a_skill_the_learner_never_rated_is_not_counted_as_checked(client):
    """The screen puts "Skills checked" beside "Spot on" and "Gaps", and those
    three have to reconcile.

    A session can measure a skill the learner did not rate. There is nothing to
    be close to, so it is not checked - it was counted anyway, and the panel read
    "Skills checked 4 · Spot on 0 · Gaps 3".
    """
    session_id = "unrated-skill-session"
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "unrated-skill-user", "session_id": session_id,
            "speech_volume_score": 60,      # vocal_command, measured but never rated
            "empathy_score": 35, "emotional_control_score": 35,
            "eye_contact_score": 40, "confidence_score": 40,
            "overall_score": 45,
        },
    )
    for skill, rating in (("emotional_intelligence", 90), ("presence_engagement", 65)):
        client.post(
            "/api/v1/analytics/feedback",
            json={
                "user_id": "unrated-skill-user", "session_id": session_id,
                "feedback_type": "self", "skill_area": skill, "rating": rating,
            },
        )

    summary = client.get(
        f"/api/v1/analytics/sessions/{session_id}/feedback-analysis"
    ).json()["summary"]

    assert summary["analyzed_skill_count"] == 2  # not 3
    assert summary["aligned_count"] + summary["blind_spot_count"] == summary["analyzed_skill_count"]


def test_both_averages_cover_the_same_skills(client):
    """They sit beside each other to be subtracted.

    The measured average used to include the unrated skill and the self average
    could not, so the two described different sets: 82 against 48, where the 48
    carried a skill the 82 knew nothing about. Over the two compared skills the
    measured mean is (35 + 40) / 2 = 37.5; the unrated 60 must not lift it.
    """
    session_id = "same-skills-session"
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "same-skills-user", "session_id": session_id,
            "speech_volume_score": 60,
            "empathy_score": 35, "emotional_control_score": 35,
            "eye_contact_score": 40, "confidence_score": 40,
            "overall_score": 45,
        },
    )
    for skill, rating in (("emotional_intelligence", 90), ("presence_engagement", 70)):
        client.post(
            "/api/v1/analytics/feedback",
            json={
                "user_id": "same-skills-user", "session_id": session_id,
                "feedback_type": "self", "skill_area": skill, "rating": rating,
            },
        )

    summary = client.get(
        f"/api/v1/analytics/sessions/{session_id}/feedback-analysis"
    ).json()["summary"]

    assert summary["average_self_rating"] == 80      # (90 + 70) / 2
    assert summary["average_observed_score"] == 37.5  # (35 + 40) / 2, without the unrated 60


def test_a_reading_that_agrees_is_returned_with_its_label(client, monkeypatch):
    """The panel had only findings to show, so it stood empty on a session where
    the learner wrote something and the model agreed with them. Their own words
    are the evidence behind everything else on that page."""
    from app.services import sentiment_analysis_service
    from app.schemas.analytics import FeedbackSentimentResult

    monkeypatch.setattr(
        sentiment_analysis_service, "analyze_feedback_text",
        lambda text, model_path=None: FeedbackSentimentResult(
            text=text, cleaned_text=text, sentiment="positive", confidence=0.97,
            sentiment_score=0.97, class_probabilities={"positive": 0.97},
            model_version="test-model", model_type="test", source="ml_model",
        ),
    )
    session_id = "reading-agrees-session"
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "reading-agrees-user", "session_id": session_id,
            "feedback_type": "self", "skill_area": "vocal_command", "rating": 80,
            "declared_sentiment": "positive", "comment": "I kept my voice steady the whole way through.",
        },
    )

    body = client.get(f"/api/v1/analytics/sessions/{session_id}/blind-spots").json()

    assert body["sentiment_gaps"] == []
    reading = body["reflection_readings"][0]
    assert reading["outcome"] == "agrees"
    assert reading["detected_sentiment"] == "positive"
    assert reading["confidence"] == 0.97
    assert reading["comment_excerpt"].startswith("I kept my voice steady")


def test_a_reading_that_was_not_acted_on_still_reports_what_it_read(client, monkeypatch):
    """Not acting on a reading is not the same as hiding it.

    The label was withheld here at first. That produced a worse screen than
    either alternative: the learner's own sentence sat beside the sentiment they
    chose, so the disagreement was plain to read, under a heading that announced
    "0 gaps" and a note that would not say what had happened. The reading is
    published with its confidence and the panel explains why it is not raised.
    """
    from app.services import sentiment_analysis_service
    from app.schemas.analytics import FeedbackSentimentResult

    monkeypatch.setattr(
        sentiment_analysis_service, "analyze_feedback_text",
        lambda text, model_path=None: FeedbackSentimentResult(
            text=text, cleaned_text=text, sentiment="negative", confidence=0.996,
            sentiment_score=-0.996, class_probabilities={"negative": 0.996},
            model_version="test-model", model_type="test", source="ml_model",
        ),
    )
    session_id = "reading-untrusted-session"
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "reading-untrusted-user", "session_id": session_id,
            "feedback_type": "self", "skill_area": "vocal_command", "rating": 75,
            "declared_sentiment": "positive",
            "comment": "I think I don't perform well because I was nervous.",
        },
    )

    body = client.get(f"/api/v1/analytics/sessions/{session_id}/blind-spots").json()

    assert body["sentiment_gaps"] == []
    reading = body["reflection_readings"][0]
    assert reading["outcome"] == "not_acted_on"
    assert reading["declared_sentiment"] == "positive"    # their own choice
    assert reading["comment_excerpt"].startswith("I think I don't perform well")
    assert reading["detected_sentiment"] == "negative"    # what it read, shown
    assert reading["confidence"] == 0.996
    # It is reported, and still not a finding.
    assert body["sentiment_gaps"] == []
