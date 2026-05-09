"""
Tests for the baseline voice-snapshot endpoints.

POST /api/v1/apa/baseline/complete
GET  /api/v1/apa/baseline/me

Auth is bypassed by overriding the get_current_user FastAPI dependency.
orchestrator.generate_training_plan is mocked wherever it would be called,
so this test file does not require real Gemini or RPE credentials.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.main import app
from app.models.baseline_snapshot import BaselineSnapshot
from app.models.personality_profile import PersonalityProfile
from app.models.session_result import SessionResult
from app.models.training_plan import TrainingPlan
from app.models.user import User

# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------

_NOW = datetime.now(timezone.utc)


def _make_user(db: Session, email: str | None = None) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=email or f"test_{uid.hex[:8]}@baseline.test",
        created_at=_NOW,
        updated_at=_NOW,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_profile(db: Session, user: User) -> PersonalityProfile:
    profile = PersonalityProfile(
        user_id=user.id,
        openness=60.0,
        conscientiousness=55.0,
        extraversion=40.0,
        agreeableness=65.0,
        neuroticism=70.0,
        raw_responses={},
        created_at=_NOW,
        updated_at=_NOW,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def _make_mca_session(
    db: Session,
    user: User,
    status: str = "completed",
) -> SessionResult:
    session = SessionResult(
        user_id=user.id,
        session_type="live",
        status=status,
        started_at=_NOW,
        ended_at=_NOW,
        duration_seconds=62,
        overall_score=74,
        skill_scores={"vocal_command": 0.68, "presence_engagement": 0.79},
        emotion_distribution={"calm": 0.55, "confident": 0.30, "anxious": 0.15},
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


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
            "rationale": ["neuroticism high"],
        },
        difficulty=4,
        recommended_scenario_ids=[],
        primary_scenario_json=None,
        generation_source="gemini_fallback",
        generation_status="completed",
        created_at=_NOW,
        updated_at=_NOW,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


# ---------------------------------------------------------------------------
# POST /api/v1/apa/baseline/complete
# ---------------------------------------------------------------------------


class TestBaselineComplete:
    def test_baseline_complete_without_survey_returns_404(
        self, client: TestClient, db_session: Session
    ):
        """User who hasn't submitted the BFI-44 survey cannot set a baseline."""
        user = _make_user(db_session)
        mca = _make_mca_session(db_session, user)

        app.dependency_overrides[get_current_user] = lambda: user
        try:
            resp = client.post(
                "/api/v1/apa/baseline/complete",
                json={"mca_session_id": str(mca.id)},
            )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 404
        assert "survey" in resp.json()["detail"].lower()

    def test_baseline_complete_with_invalid_session_returns_404(
        self, client: TestClient, db_session: Session
    ):
        """Non-existent mca_session_id must return 404."""
        user = _make_user(db_session)
        _make_profile(db_session, user)

        app.dependency_overrides[get_current_user] = lambda: user
        try:
            resp = client.post(
                "/api/v1/apa/baseline/complete",
                json={"mca_session_id": str(uuid.uuid4())},
            )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 404

    def test_baseline_complete_with_other_users_session_returns_403(
        self, client: TestClient, db_session: Session
    ):
        """Session belonging to a different user must return 403."""
        owner = _make_user(db_session)
        requester = _make_user(db_session)
        _make_profile(db_session, requester)
        owner_session = _make_mca_session(db_session, owner)

        app.dependency_overrides[get_current_user] = lambda: requester
        try:
            resp = client.post(
                "/api/v1/apa/baseline/complete",
                json={"mca_session_id": str(owner_session.id)},
            )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 403

    def test_baseline_complete_with_non_completed_session_returns_400(
        self, client: TestClient, db_session: Session
    ):
        """Session with status != 'completed' must return 400."""
        user = _make_user(db_session)
        _make_profile(db_session, user)
        active_session = _make_mca_session(db_session, user, status="active")

        app.dependency_overrides[get_current_user] = lambda: user
        try:
            resp = client.post(
                "/api/v1/apa/baseline/complete",
                json={"mca_session_id": str(active_session.id)},
            )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 400
        assert "active" in resp.json()["detail"]

    def test_baseline_complete_persists_snapshot(
        self, client: TestClient, db_session: Session
    ):
        """Happy path — BaselineSnapshot row is created and response is correct."""
        user = _make_user(db_session)
        _make_profile(db_session, user)
        mca = _make_mca_session(db_session, user)
        mock_plan = _make_plan(db_session, user)

        # Capture ids as strings before requests detach the ORM instances.
        mca_id_str = str(mca.id)
        user_id_str = str(user.id)
        plan_id_str = str(mock_plan.id)

        app.dependency_overrides[get_current_user] = lambda: user
        try:
            with patch(
                "app.services.pedagogy.orchestrator.generate_training_plan",
                new=AsyncMock(return_value=mock_plan),
            ):
                resp = client.post(
                    "/api/v1/apa/baseline/complete",
                    json={"mca_session_id": mca_id_str},
                )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 201
        data = resp.json()
        assert data["baseline"]["mca_session_id"] == mca_id_str
        assert data["baseline"]["user_id"] == user_id_str
        assert data["baseline"]["overall_score"] == pytest.approx(74.0)
        assert data["baseline"]["duration_seconds"] == 62
        assert "plan_id" in data
        assert data["plan_id"] == plan_id_str

        # Verify persistence in DB (use UUID object, not the detached model attribute)
        user_uuid = uuid.UUID(user_id_str)
        snap = (
            db_session.query(BaselineSnapshot)
            .filter(BaselineSnapshot.user_id == user_uuid)
            .first()
        )
        assert snap is not None
        assert snap.mca_session_id == mca_id_str
        assert snap.skill_scores == {"vocal_command": 0.68, "presence_engagement": 0.79}

    def test_baseline_complete_triggers_plan_regeneration(
        self, client: TestClient, db_session: Session
    ):
        """Endpoint must call orchestrator.generate_training_plan exactly once."""
        user = _make_user(db_session)
        _make_profile(db_session, user)
        mca = _make_mca_session(db_session, user)
        mock_plan = _make_plan(db_session, user)

        generate_calls: list = []

        async def _mock_generate(*args, **kwargs):
            generate_calls.append(args)
            return mock_plan

        app.dependency_overrides[get_current_user] = lambda: user
        try:
            with patch(
                "app.services.pedagogy.orchestrator.generate_training_plan",
                side_effect=_mock_generate,
            ):
                resp = client.post(
                    "/api/v1/apa/baseline/complete",
                    json={"mca_session_id": str(mca.id)},
                )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 201
        assert len(generate_calls) == 1

    def test_baseline_complete_upserts_on_retry(
        self, client: TestClient, db_session: Session
    ):
        """Calling the endpoint twice for the same user must UPDATE the existing row."""
        user = _make_user(db_session)
        _make_profile(db_session, user)
        mca1 = _make_mca_session(db_session, user)
        mca2 = _make_mca_session(db_session, user)
        mock_plan = _make_plan(db_session, user)

        # Capture ids before requests detach the ORM instances.
        mca1_id = str(mca1.id)
        mca2_id = str(mca2.id)
        user_uuid = uuid.UUID(str(user.id))

        app.dependency_overrides[get_current_user] = lambda: user
        try:
            with patch(
                "app.services.pedagogy.orchestrator.generate_training_plan",
                new=AsyncMock(return_value=mock_plan),
            ):
                client.post(
                    "/api/v1/apa/baseline/complete",
                    json={"mca_session_id": mca1_id},
                )
                resp = client.post(
                    "/api/v1/apa/baseline/complete",
                    json={"mca_session_id": mca2_id},
                )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 201

        rows = (
            db_session.query(BaselineSnapshot)
            .filter(BaselineSnapshot.user_id == user_uuid)
            .all()
        )
        assert len(rows) == 1, "upsert must not create a second row"
        assert rows[0].mca_session_id == mca2_id


# ---------------------------------------------------------------------------
# GET /api/v1/apa/baseline/me
# ---------------------------------------------------------------------------


class TestGetMyBaseline:
    def test_get_baseline_returns_404_when_none(
        self, client: TestClient, db_session: Session
    ):
        """User with no snapshot must get 404."""
        user = _make_user(db_session)

        app.dependency_overrides[get_current_user] = lambda: user
        try:
            resp = client.get("/api/v1/apa/baseline/me")
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 404

    def test_get_baseline_returns_snapshot_when_exists(
        self, client: TestClient, db_session: Session
    ):
        """User with an existing snapshot gets the full payload."""
        user = _make_user(db_session)
        snap = BaselineSnapshot(
            user_id=user.id,
            mca_session_id=str(uuid.uuid4()),
            skill_scores={"vocal_command": 0.72},
            emotion_distribution={"calm": 0.80, "anxious": 0.20},
            overall_score=81.0,
            duration_seconds=70,
            created_at=_NOW,
            updated_at=_NOW,
        )
        db_session.add(snap)
        db_session.commit()

        app.dependency_overrides[get_current_user] = lambda: user
        try:
            resp = client.get("/api/v1/apa/baseline/me")
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == str(user.id)
        assert data["overall_score"] == pytest.approx(81.0)
        assert data["duration_seconds"] == 70
        assert data["skill_scores"] == {"vocal_command": 0.72}
