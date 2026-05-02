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
