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


def test_create_feedback_keeps_manual_sentiment(client, monkeypatch):
    from app.services import sentiment_analysis_service

    def fail_if_called(text: str):
        raise AssertionError("manual sentiment should not call NLP model")

    monkeypatch.setattr(
        sentiment_analysis_service,
        "analyze_feedback_text",
        fail_if_called,
    )

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
    assert response.json()["sentiment"] == "neutral"


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
            "skill_area": "confidence",
            "rating": 92,
            "sentiment": "positive",
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "report-user",
            "session_id": session_id,
            "feedback_type": "peer",
            "skill_area": "confidence",
            "rating": 60,
            "sentiment": "neutral",
        },
    )
    client.post(
        "/api/v1/analytics/predictions",
        json={
            "user_id": "report-user",
            "session_id": session_id,
            "predicted_skill": "confidence",
            "current_score": 58,
            "predicted_score": 52,
            "trend_label": "declining",
            "risk_level": "high",
            "recommendation": "Practice confidence with a shorter response script.",
        },
    )

    response = client.get(f"/api/v1/analytics/sessions/{session_id}/report")

    assert response.status_code == 200
    data = response.json()
    assert data["session_id"] == session_id
    assert data["user_id"] == "report-user"
    assert data["report_version"] == "rule-based-report-v1"
    assert data["summary"]["completion_status"] == "complete"
    assert "Empathy" in data["summary"]["strengths"]
    assert "Confidence" in data["summary"]["improvement_areas"]
    assert data["aggregate"]["scores"]["metric_count"] == 1
    assert data["skill_scores"]["skill_scores"]["confidence"] is not None
    assert data["feedback_analysis"]["summary"]["blind_spot_count"] == 1
    assert data["blind_spots"]["summary"]["total_count"] == 1
    assert data["action_items"][0]["skill_area"] == "confidence"


def test_post_session_report_returns_empty_report_for_unknown_session(client):
    response = client.get("/api/v1/analytics/sessions/missing-session/report")

    assert response.status_code == 200
    data = response.json()
    assert data["session_id"] == "missing-session"
    assert data["user_id"] is None
    assert data["summary"]["completion_status"] == "empty"
    assert data["summary"]["strengths"] == []
    assert data["summary"]["improvement_areas"] == []
    assert data["action_items"][0]["title"] == "Maintain current progress"


def test_user_aggregate_returns_empty_summary_for_unknown_user(client):
    response = client.get("/api/v1/analytics/users/unknown-user/aggregate")

    assert response.status_code == 200
    data = response.json()
    assert data["scope"] == "user"
    assert data["user_id"] == "unknown-user"
    assert data["scores"]["metric_count"] == 0
    assert data["scores"]["averages"] == {}
    assert data["feedback"]["total_count"] == 0
    assert data["predictions"]["total_count"] == 0
    assert data["data_completeness"] == {
        "has_session_metrics": False,
        "has_feedback": False,
        "has_predictions": False,
    }


def test_calculate_skill_scores_from_payload(client):
    response = client.post(
        "/api/v1/analytics/skill-scores/calculate",
        json={
            "user_id": "score-user",
            "session_id": "score-session",
            "inputs": {
                "confidence_score": 80,
                "eye_contact_score": 70,
                "speech_volume_score": 90,
                "clarity_score": 75,
                "speech_pace_score": 85,
                "response_quality_score": 80,
                "empathy_score": 65,
                "listening_score": 88,
                "adaptability_score": 72,
                "emotional_control_score": 78,
                "professionalism_score": 82,
                "self_rating": 90,
                "peer_rating": 70,
            },
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["user_id"] == "score-user"
    assert data["session_id"] == "score-session"
    assert data["skill_scores"]["confidence"] == 78.5
    assert data["skill_scores"]["communication_clarity"] == 77.75
    assert data["skill_scores"]["empathy"] == 70.25
    assert data["skill_scores"]["active_listening"] == 84.6
    assert data["skill_scores"]["adaptability"] == 73.3
    assert data["skill_scores"]["emotional_control"] == 80.85
    assert data["skill_scores"]["professionalism"] == 79.6
    assert data["overall_score"] == 77.84
    assert data["completeness"] == 1.0
    assert data["scoring_version"] == "rule-based-v1"
    assert "confidence_score" in data["breakdown"]["confidence"]["inputs_used"]


def test_session_skill_scores_use_saved_metrics_and_feedback(client):
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "stored-score-user",
            "session_id": "stored-score-session",
            "confidence_score": 80,
            "eye_contact_score": 70,
            "speech_volume_score": 90,
            "clarity_score": 75,
            "speech_pace_score": 85,
            "response_quality_score": 80,
            "empathy_score": 65,
            "listening_score": 88,
            "adaptability_score": 72,
            "emotional_control_score": 78,
            "professionalism_score": 82,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "stored-score-user",
            "session_id": "stored-score-session",
            "feedback_type": "self",
            "rating": 90,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "stored-score-user",
            "session_id": "stored-score-session",
            "feedback_type": "peer",
            "rating": 70,
        },
    )

    response = client.get("/api/v1/analytics/sessions/stored-score-session/skill-scores")

    assert response.status_code == 200
    data = response.json()
    assert data["user_id"] == "stored-score-user"
    assert data["session_id"] == "stored-score-session"
    assert data["skill_scores"]["confidence"] == 78.5
    assert data["skill_scores"]["empathy"] == 70.25
    assert data["overall_score"] == 77.84
    assert data["completeness"] == 1.0


def test_calculate_skill_scores_rejects_invalid_input(client):
    response = client.post(
        "/api/v1/analytics/skill-scores/calculate",
        json={
            "inputs": {
                "confidence_score": 150,
            },
        },
    )

    assert response.status_code == 422


def test_session_feedback_analysis_detects_self_peer_and_observed_gaps(client):
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "feedback-analysis-user",
            "session_id": "feedback-analysis-session",
            "confidence_score": 60,
            "empathy_score": 82,
            "overall_score": 70,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "feedback-analysis-user",
            "session_id": "feedback-analysis-session",
            "feedback_type": "self",
            "skill_area": "confidence",
            "rating": 88,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "feedback-analysis-user",
            "session_id": "feedback-analysis-session",
            "feedback_type": "peer",
            "skill_area": "confidence",
            "rating": 62,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "feedback-analysis-user",
            "session_id": "feedback-analysis-session",
            "feedback_type": "self",
            "skill_area": "empathy",
            "rating": 84,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "feedback-analysis-user",
            "session_id": "feedback-analysis-session",
            "feedback_type": "peer",
            "skill_area": "empathy",
            "rating": 80,
        },
    )

    response = client.get("/api/v1/analytics/sessions/feedback-analysis-session/feedback-analysis")

    assert response.status_code == 200
    data = response.json()
    assert data["scope"] == "session"
    assert data["user_id"] == "feedback-analysis-user"
    assert data["session_id"] == "feedback-analysis-session"
    assert data["summary"]["self_feedback_count"] == 2
    assert data["summary"]["peer_feedback_count"] == 2
    assert data["summary"]["blind_spot_count"] == 1
    assert data["analysis_version"] == "rule-based-v1"

    items = {item["skill_area"]: item for item in data["items"]}
    assert items["confidence"]["alignment"] == "self_overestimation"
    assert items["confidence"]["severity"] == "medium"
    assert items["confidence"]["self_peer_gap"] == 26
    assert items["confidence"]["self_observed_gap"] == 28
    assert items["empathy"]["alignment"] == "aligned"
    assert items["empathy"]["severity"] == "none"


def test_user_feedback_analysis_returns_empty_summary_for_unknown_user(client):
    response = client.get("/api/v1/analytics/users/no-feedback-user/feedback-analysis")

    assert response.status_code == 200
    data = response.json()
    assert data["scope"] == "user"
    assert data["user_id"] == "no-feedback-user"
    assert data["summary"] == {
        "self_feedback_count": 0,
        "peer_feedback_count": 0,
        "analyzed_skill_count": 0,
        "aligned_count": 0,
        "blind_spot_count": 0,
        "average_self_rating": None,
        "average_peer_rating": None,
    }
    assert data["items"] == []


def test_session_blind_spots_detects_and_prioritizes_self_perception_gaps(client):
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "blind-user",
            "session_id": "blind-session",
            "confidence_score": 55,
            "empathy_score": 90,
            "clarity_score": 76,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "blind-user",
            "session_id": "blind-session",
            "feedback_type": "self",
            "skill_area": "confidence",
            "rating": 92,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "blind-user",
            "session_id": "blind-session",
            "feedback_type": "peer",
            "skill_area": "confidence",
            "rating": 58,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "blind-user",
            "session_id": "blind-session",
            "feedback_type": "self",
            "skill_area": "empathy",
            "rating": 64,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "blind-user",
            "session_id": "blind-session",
            "feedback_type": "peer",
            "skill_area": "empathy",
            "rating": 88,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "blind-user",
            "session_id": "blind-session",
            "feedback_type": "self",
            "skill_area": "clarity",
            "rating": 78,
        },
    )
    client.post(
        "/api/v1/analytics/feedback",
        json={
            "user_id": "blind-user",
            "session_id": "blind-session",
            "feedback_type": "peer",
            "skill_area": "clarity",
            "rating": 74,
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
    assert data["summary"]["strongest_blind_spot"]["skill_area"] == "confidence"
    assert data["detection_version"] == "rule-based-v1"

    blind_spots = {item["skill_area"]: item for item in data["blind_spots"]}
    assert blind_spots["confidence"]["blind_spot_type"] == "overestimation"
    assert blind_spots["confidence"]["severity"] == "high"
    assert blind_spots["confidence"]["comparison_source"] == "observed"
    assert blind_spots["confidence"]["gap"] == 37
    assert blind_spots["empathy"]["blind_spot_type"] == "underestimation"
    assert blind_spots["empathy"]["severity"] == "medium"
    assert blind_spots["empathy"]["gap"] == 26
    assert "clarity" not in blind_spots


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
    }
    assert data["blind_spots"] == []


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
            "overall_score": 60,
        },
    )
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "single-trend-user",
            "session_id": "single-trend-session-2",
            "overall_score": 68,
        },
    )

    response = client.get("/api/v1/analytics/users/single-trend-user/progress-trends/overall")

    assert response.status_code == 200
    data = response.json()
    assert data["skill_area"] == "overall"
    assert data["trend_label"] == "improving"
    assert data["delta"] == 8
    assert data["session_count"] == 2


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
            "overall_score": 60,
        },
    )
    client.post(
        "/api/v1/analytics/session-metrics",
        json={
            "user_id": "single-prediction-user",
            "session_id": "single-prediction-session-2",
            "overall_score": 68,
        },
    )

    response = client.get("/api/v1/analytics/users/single-prediction-user/predicted-outcomes/overall")

    assert response.status_code == 200
    data = response.json()
    assert data["predicted_skill"] == "overall"
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
