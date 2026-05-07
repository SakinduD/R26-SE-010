"""
Tests for the APM API endpoints.

Focus areas:
  1. GET /apa/demo/strategy — stateless, no auth, directly proves the thesis
  2. Auth-required endpoints properly reject unauthenticated requests
  3. POST /apa/session-feedback accepts X-Service-Token

The demo endpoint is the primary thesis-proving surface in the API: it makes
the "two personas get different strategies" claim testable without any DB.
"""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app

# --------------------------------------------------------------------------
# Demo strategy endpoint — no auth, no DB
# --------------------------------------------------------------------------

def test_demo_strategy_defaults_to_mid_range():
    with TestClient(app) as c:
        resp = c.get("/api/v1/apa/demo/strategy")
    assert resp.status_code == 200
    data = resp.json()
    assert "strategy" in data
    assert "difficulty" in data
    assert "input" in data


def test_demo_strategy_introvert_profile():
    with TestClient(app) as c:
        resp = c.get(
            "/api/v1/apa/demo/strategy",
            params={"extraversion": 25, "neuroticism": 70},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["strategy"]["tone"] == "gentle"
    assert data["difficulty"] <= 4  # High N, low E → easier start


def test_demo_strategy_extrovert_profile():
    with TestClient(app) as c:
        resp = c.get(
            "/api/v1/apa/demo/strategy",
            params={"extraversion": 80, "neuroticism": 30},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["strategy"]["tone"] != "gentle"
    assert data["difficulty"] >= 5


def test_demo_strategy_two_personas_differ():
    """
    THESIS API TEST: two personas hit the same stateless endpoint and receive
    provably different strategies and difficulties.
    """
    with TestClient(app) as c:
        intro = c.get(
            "/api/v1/apa/demo/strategy",
            params={
                "extraversion": 25, "neuroticism": 70,
                "openness": 40, "conscientiousness": 40,
            },
        )
        extro = c.get(
            "/api/v1/apa/demo/strategy",
            params={
                "extraversion": 80, "neuroticism": 30,
                "openness": 65, "conscientiousness": 70,
            },
        )

    assert intro.status_code == 200
    assert extro.status_code == 200

    i, e = intro.json(), extro.json()
    assert i["strategy"]["tone"] != e["strategy"]["tone"], (
        "Introvert and extrovert must get different tones"
    )
    assert i["difficulty"] < e["difficulty"], (
        f"Introvert difficulty {i['difficulty']} must be less than "
        f"extrovert difficulty {e['difficulty']}"
    )


def test_demo_strategy_feedback_styles_differ():
    with TestClient(app) as c:
        intro = c.get("/api/v1/apa/demo/strategy?extraversion=25&neuroticism=70")
        extro = c.get("/api/v1/apa/demo/strategy?extraversion=80&neuroticism=30")
    assert intro.json()["strategy"]["feedback_style"] != extro.json()["strategy"]["feedback_style"]


# --------------------------------------------------------------------------
# Auth enforcement
# --------------------------------------------------------------------------

def test_generate_plan_requires_auth():
    with TestClient(app) as c:
        resp = c.post("/api/v1/apa/plan/generate")
    assert resp.status_code in (401, 403)


def test_get_my_plan_requires_auth():
    with TestClient(app) as c:
        resp = c.get("/api/v1/apa/plan/me")
    assert resp.status_code in (401, 403)


def test_history_requires_auth():
    with TestClient(app) as c:
        resp = c.get("/api/v1/apa/plan/history")
    assert resp.status_code in (401, 403)


def test_live_signals_requires_auth():
    with TestClient(app) as c:
        resp = c.post("/api/v1/apa/live-signals", json={"nudges": []})
    assert resp.status_code in (401, 403)


def test_session_feedback_no_auth_returns_401():
    payload = {
        "session_id": "s1",
        "scenario_id": "sc1",
        "scenario_title": "Test",
        "user_id": str(uuid.uuid4()),
        "total_turns": 3,
        "coaching_advice": {"overall_rating": "good", "summary": "Fine"},
    }
    with TestClient(app) as c:
        resp = c.post("/api/v1/apa/session-feedback", json=payload)
    assert resp.status_code == 401


def test_session_feedback_wrong_service_token_returns_401():
    payload = {
        "session_id": "s1",
        "scenario_id": "sc1",
        "scenario_title": "Test",
        "user_id": str(uuid.uuid4()),
        "total_turns": 3,
        "coaching_advice": {"overall_rating": "good", "summary": "Fine"},
    }
    with TestClient(app) as c:
        resp = c.post(
            "/api/v1/apa/session-feedback",
            json=payload,
            headers={"X-Service-Token": "wrong-token"},
        )
    assert resp.status_code == 401
