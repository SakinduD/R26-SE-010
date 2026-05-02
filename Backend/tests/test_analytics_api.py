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
