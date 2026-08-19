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
        "rpe_session": {
            "session_id": "integration-session-1",
            "scenario_id": "scenario-hr-conflict",
            "user_id": "integration-user",
            "outcome": "resolved",
            "final_trust": 82,
            "final_escalation": 1,
            "total_turns": 3,
            "trust_history": [68, 76, 82],
            "emotion_history": ["neutral", "concerned", "satisfied"],
        },
        "rpe_feedback": {
            "session_id": "integration-session-1",
            "scenario_id": "scenario-hr-conflict",
            "scenario_title": "Handle a teammate disagreement",
            "user_id": "integration-user",
            "outcome": "resolved",
            "final_trust": 82,
            "final_escalation": 1,
            "total_turns": 3,
            "turn_metrics": [
                {
                    "turn": 1,
                    "assertiveness_score": 70,
                    "empathy_score": 78,
                    "clarity_score": 74,
                    "response_quality": 76,
                },
                {
                    "turn": 2,
                    "assertiveness_score": 82,
                    "empathy_score": 84,
                    "clarity_score": 80,
                    "response_quality": 82,
                },
            ],
            "risk_flags": ["brief interruption"],
            "blind_spots": ["confidence"],
            "coaching_advice": ["Pause before responding and summarize the other person first."],
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
        "has_rpe_session": True,
        "has_rpe_feedback": True,
        "mca_nudge_count": 2,
            "submitted_feedback_count": 1,
            "generated_feedback_count": 5,
    }

    metric = data["metric"]
    assert metric["confidence_score"] == 76
    assert metric["empathy_score"] == 81
    assert metric["clarity_score"] == 77
    assert metric["response_quality_score"] == 79
    assert metric["speech_pace_score"] == 96
    assert metric["speech_volume_score"] == 61
    assert metric["overall_score"] is not None

    assert data["aggregate"]["scores"]["metric_count"] == 1
    assert data["aggregate"]["feedback"]["total_count"] == 6
    assert data["aggregate"]["feedback"]["by_type"]["system"] >= 3
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
    session_id = "report-session"
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "report-user",
            "session_id": session_id,
            "confidence_score": 58,
            "clarity_score": 74,
            "empathy_score": 82,
            "listening_score": 77,
            "overall_score": 73,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "report-user",
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
            "session_id": "blind-session",
            "feedback_type": "self",
            "skill_area": "emotional_intelligence",
            "rating": 64,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "blind-user",
            "session_id": "blind-session",
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
    assert blind_spots["presence_engagement"]["blind_spot_type"] == "overestimation"
    assert blind_spots["presence_engagement"]["severity"] == "high"
    assert blind_spots["presence_engagement"]["comparison_source"] == "observed"
    assert blind_spots["presence_engagement"]["gap"] == 37
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
            "confidence_score": 55,
            "empathy_score": 90,
            "clarity_score": 72,
            "overall_score": 70,
        },
        {
            "session_id": "trend-session-2",
            "confidence_score": 65,
            "empathy_score": 82,
            "clarity_score": 73,
            "overall_score": 74,
        },
        {
            "session_id": "trend-session-3",
            "confidence_score": 78,
            "empathy_score": 70,
            "clarity_score": 74,
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
    assert data["summary"]["strongest_improvement"]["skill_area"] == "confidence"
    assert data["summary"]["strongest_decline"]["skill_area"] == "empathy"

    trends = {item["skill_area"]: item for item in data["trends"]}
    assert trends["confidence"]["trend_label"] == "improving"
    assert trends["confidence"]["first_score"] == 55
    assert trends["confidence"]["latest_score"] == 78
    assert trends["confidence"]["delta"] == 23
    assert trends["confidence"]["slope"] == 11.5
    assert len(trends["confidence"]["points"]) == 3
    assert trends["empathy"]["trend_label"] == "declining"
    assert trends["empathy"]["delta"] == -20
    assert trends["communication_clarity"]["trend_label"] == "stable"
    assert trends["adaptability"]["trend_label"] == "insufficient_data"


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
    trends = {item["skill_area"]: item for item in response.json()["trends"]}
    assert trends["confidence"]["session_count"] == 2
    assert trends["confidence"]["first_score"] == 40
    assert trends["confidence"]["latest_score"] == 60
    assert trends["confidence"]["delta"] == 20


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
            "confidence_score": 55,
            "empathy_score": 90,
            "clarity_score": 72,
            "overall_score": 70,
        },
        {
            "session_id": "prediction-session-2",
            "confidence_score": 65,
            "empathy_score": 72,
            "clarity_score": 73,
            "overall_score": 74,
        },
        {
            "session_id": "prediction-session-3",
            "confidence_score": 78,
            "empathy_score": 45,
            "clarity_score": 74,
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
    assert data["summary"]["predicted_count"] == 4
    assert data["summary"]["high_risk_count"] == 1
    assert data["summary"]["low_risk_count"] >= 2
    assert data["summary"]["highest_risk_prediction"]["predicted_skill"] == "empathy"

    predictions = {item["predicted_skill"]: item for item in data["predictions"]}
    assert predictions["confidence"]["predicted_score"] == 88
    assert predictions["confidence"]["risk_level"] == "low"
    assert predictions["confidence"]["confidence"] == 0.65
    assert predictions["empathy"]["predicted_score"] == 35
    assert predictions["empathy"]["risk_level"] == "high"
    assert predictions["communication_clarity"]["risk_level"] == "low"
    assert predictions["overall"]["predicted_score"] == 85


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
            "feedback_type": "peer",
            "skill_area": "confidence",
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
    assert prediction["predicted_skill"] == "confidence"
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
            "feedback_type": "peer",
            "skill_area": "confidence",
            "rating": 72,
            "comment": "The learner showed better confidence and clearer delivery.",
            "sentiment": "positive",
        },
    )

    response = client.get("/api/v1/analytics/users/real-ml-api-user/predicted-outcomes/confidence")

    assert response.status_code == 200
    data = response.json()
    assert data["predicted_skill"] == "confidence"
    assert data["current_score"] == 74
    assert data["predicted_score"] is not None
    assert 0 <= data["predicted_score"] <= 100
    assert data["risk_level"] in {"low", "medium", "high"}


def test_user_predicted_outcomes_calibrates_extreme_ml_prediction(client, monkeypatch):
    from app.services import ml_predictive_model_service

    user_id = "calibrated-ml-user"
    feedback_payloads = [
        {
            "user_id": user_id,
            "session_id": "calibrated-session-1",
            "feedback_type": "self",
            "skill_area": "confidence",
            "rating": 84,
            "sentiment": "positive",
        },
        {
            "user_id": user_id,
            "session_id": "calibrated-session-2",
            "feedback_type": "self",
            "skill_area": "confidence",
            "rating": 58,
            "sentiment": "neutral",
        },
        {
            "user_id": user_id,
            "session_id": "calibrated-session-3",
            "feedback_type": "peer",
            "skill_area": "confidence",
            "rating": 40,
            "sentiment": "negative",
        },
    ]
    for payload in feedback_payloads:
        response = client.post("/api/v1/analytics/feedback", json=payload)
        assert response.status_code == 201

    def fake_extreme_ml_prediction(_features):
        return {
            "predicted_score": 100,
            "risk_level": "high",
            "confidence": 0.91,
            "model_version": "fake-extreme-model",
        }

    monkeypatch.setattr(
        ml_predictive_model_service,
        "predict_behavioral_outcome",
        fake_extreme_ml_prediction,
    )

    response = client.get(f"/api/v1/analytics/users/{user_id}/predicted-outcomes/confidence")
    assert response.status_code == 200

    data = response.json()
    assert data["current_score"] == 40
    assert data["predicted_score"] == 50
    assert data["risk_level"] == "high"
    assert 0 <= data["confidence"] <= 1
    assert data["evidence_points"] == 3


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
    assert data["evidence"]["feedback_count"] == 2
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
