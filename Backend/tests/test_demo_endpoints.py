"""
Tests for the APM demo endpoints.

GET  /api/v1/apa/demo/personas
POST /api/v1/apa/demo/inject-persona
POST /api/v1/apa/demo/simulate-session

All tests run with apm_demo_mode=True (patched on the settings object).
orchestrator calls are mocked so no real Gemini/RPE credentials are needed.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.main import app
from app.models.baseline_snapshot import BaselineSnapshot
from app.models.personality_profile import PersonalityProfile
from app.models.training_plan import TrainingPlan
from app.models.user import User

_NOW = datetime.now(timezone.utc)


def _make_user(db: Session, email: str | None = None) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=email or f"demo_{uid.hex[:8]}@test.demo",
        created_at=_NOW,
        updated_at=_NOW,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_plan(db: Session, user: User) -> TrainingPlan:
    plan = TrainingPlan(
        user_id=user.id,
        skill="job_interview",
        strategy_json={
            "tone": "gentle",
            "pacing": "slow",
            "complexity": "simple",
            "npc_personality": "warm_supportive",
            "feedback_style": "encouraging",
            "rationale": [],
            "priority_skills": [],
        },
        difficulty=3,
        recommended_scenario_ids=[],
        primary_scenario_json={"scenario_id": "none"},
        generation_source="gemini_fallback",
        generation_status="completed",
        created_at=_NOW,
        updated_at=_NOW,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def _mock_plan(user: User, db: Session) -> TrainingPlan:
    return _make_plan(db, user)


class TestDemoGate:
    """Endpoints return 403 when apm_demo_mode is False."""

    def test_personas_blocked_without_demo_mode(self, client):
        resp = client.get("/api/v1/apa/demo/personas")
        assert resp.status_code == 403

    def test_inject_blocked_without_demo_mode(self, client, db_session):
        user = _make_user(db_session)
        try:
            app.dependency_overrides[get_current_user] = lambda: user
            resp = client.post(
                "/api/v1/apa/demo/inject-persona", json={"persona_id": "alex"}
            )
        finally:
            app.dependency_overrides.pop(get_current_user, None)
        assert resp.status_code == 403

    def test_simulate_blocked_without_demo_mode(self, client, db_session):
        user = _make_user(db_session)
        try:
            app.dependency_overrides[get_current_user] = lambda: user
            resp = client.post(
                "/api/v1/apa/demo/simulate-session", json={"outcome": "success"}
            )
        finally:
            app.dependency_overrides.pop(get_current_user, None)
        assert resp.status_code == 403


class TestDemoPersonas:
    """GET /apa/demo/personas — returns the built-in persona list."""

    def test_returns_two_personas(self, client):
        with patch("app.api.v1.pedagogy_dev.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(apm_demo_mode=True)
            resp = client.get("/api/v1/apa/demo/personas")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        ids = {p["id"] for p in data}
        assert ids == {"alex", "jordan"}

    def test_persona_has_required_fields(self, client):
        with patch("app.api.v1.pedagogy_dev.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(apm_demo_mode=True)
            resp = client.get("/api/v1/apa/demo/personas")
        assert resp.status_code == 200
        alex = next(p for p in resp.json() if p["id"] == "alex")
        assert "label" in alex
        assert "description" in alex
        assert "ocean" in alex
        assert set(alex["ocean"]) == {
            "openness", "conscientiousness", "extraversion",
            "agreeableness", "neuroticism",
        }


class TestInjectPersona:
    """POST /apa/demo/inject-persona."""

    def _run(self, client, db: Session, persona_id: str):
        user = _make_user(db)
        user_id_str = str(user.id)
        mock_plan = _mock_plan(user, db)

        try:
            app.dependency_overrides[get_current_user] = lambda: user
            with patch("app.api.v1.pedagogy_dev.get_settings") as mock_settings, \
                 patch("app.services.pedagogy.orchestrator.generate_training_plan",
                        new=AsyncMock(return_value=mock_plan)):
                mock_settings.return_value = MagicMock(apm_demo_mode=True)
                resp = client.post(
                    "/api/v1/apa/demo/inject-persona",
                    json={"persona_id": persona_id},
                )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        return resp, user_id_str

    def test_unknown_persona_returns_422(self, client, db_session):
        user = _make_user(db_session)
        try:
            app.dependency_overrides[get_current_user] = lambda: user
            with patch("app.api.v1.pedagogy_dev.get_settings") as mock_settings:
                mock_settings.return_value = MagicMock(apm_demo_mode=True)
                resp = client.post(
                    "/api/v1/apa/demo/inject-persona",
                    json={"persona_id": "unknown_persona"},
                )
        finally:
            app.dependency_overrides.pop(get_current_user, None)
        assert resp.status_code == 422

    def test_inject_alex_returns_201(self, client, db_session):
        resp, _ = self._run(client, db_session, "alex")
        assert resp.status_code == 201

    def test_inject_creates_personality_profile(self, client, db_session):
        resp, user_id_str = self._run(client, db_session, "alex")
        assert resp.status_code == 201
        profile = (
            db_session.query(PersonalityProfile)
            .filter(PersonalityProfile.user_id == uuid.UUID(user_id_str))
            .first()
        )
        assert profile is not None
        assert profile.neuroticism == 70.0
        assert profile.extraversion == 25.0

    def test_inject_creates_baseline_snapshot(self, client, db_session):
        resp, user_id_str = self._run(client, db_session, "alex")
        assert resp.status_code == 201
        snap = (
            db_session.query(BaselineSnapshot)
            .filter(BaselineSnapshot.user_id == uuid.UUID(user_id_str))
            .first()
        )
        assert snap is not None
        assert snap.overall_score == 38.0

    def test_inject_jordan_creates_different_profile(self, client, db_session):
        resp, user_id_str = self._run(client, db_session, "jordan")
        assert resp.status_code == 201
        profile = (
            db_session.query(PersonalityProfile)
            .filter(PersonalityProfile.user_id == uuid.UUID(user_id_str))
            .first()
        )
        assert profile is not None
        assert profile.neuroticism == 30.0
        assert profile.extraversion == 80.0

    def test_inject_returns_plan_response(self, client, db_session):
        resp, _ = self._run(client, db_session, "alex")
        data = resp.json()
        assert "id" in data
        assert "strategy" in data
        assert "difficulty" in data


class TestSimulateSession:
    """POST /apa/demo/simulate-session."""

    def _run(self, client, db: Session, outcome: str):
        user = _make_user(db)
        plan = _make_plan(db, user)
        plan_id_str = str(plan.id)

        try:
            app.dependency_overrides[get_current_user] = lambda: user
            with patch("app.api.v1.pedagogy_dev.get_settings") as mock_settings, \
                 patch("app.services.pedagogy.orchestrator.apply_session_feedback",
                        new=AsyncMock(return_value=plan)):
                mock_settings.return_value = MagicMock(apm_demo_mode=True)
                resp = client.post(
                    "/api/v1/apa/demo/simulate-session",
                    json={"outcome": outcome},
                )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        return resp, plan_id_str

    def test_unknown_outcome_returns_422(self, client, db_session):
        user = _make_user(db_session)
        try:
            app.dependency_overrides[get_current_user] = lambda: user
            with patch("app.api.v1.pedagogy_dev.get_settings") as mock_settings:
                mock_settings.return_value = MagicMock(apm_demo_mode=True)
                resp = client.post(
                    "/api/v1/apa/demo/simulate-session",
                    json={"outcome": "perfect"},
                )
        finally:
            app.dependency_overrides.pop(get_current_user, None)
        assert resp.status_code == 422

    def test_simulate_success_returns_200(self, client, db_session):
        resp, _ = self._run(client, db_session, "success")
        assert resp.status_code == 200

    def test_simulate_partial_returns_200(self, client, db_session):
        resp, _ = self._run(client, db_session, "partial")
        assert resp.status_code == 200

    def test_simulate_failure_returns_200(self, client, db_session):
        resp, _ = self._run(client, db_session, "failure")
        assert resp.status_code == 200

    def test_simulate_returns_plan_structure(self, client, db_session):
        resp, _ = self._run(client, db_session, "success")
        data = resp.json()
        assert "strategy" in data
        assert "difficulty" in data
