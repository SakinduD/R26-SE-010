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

# What MCA stores for a finished session: 0-100 integer skill scores, MCA's SER labels.
_MCA_SKILL_SCORES = {
    "vocal_command": 68,
    "speech_fluency": 72,
    "presence_engagement": 79,
    "emotional_regulation": 61,
}
_MCA_EMOTIONS = {"neutral": 0.55, "happy": 0.30, "fearful": 0.15}


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
    skill_scores: dict | None = None,
    emotion_distribution: dict | None = None,
    overall_score: int = 74,
) -> SessionResult:
    session = SessionResult(
        user_id=user.id,
        session_type="live",
        status=status,
        started_at=_NOW,
        ended_at=_NOW,
        duration_seconds=62,
        overall_score=overall_score,
        skill_scores=dict(_MCA_SKILL_SCORES) if skill_scores is None else skill_scores,
        emotion_distribution=dict(_MCA_EMOTIONS) if emotion_distribution is None else emotion_distribution,
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
        assert snap.skill_scores == _MCA_SKILL_SCORES

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
            skill_scores={"vocal_command": 72},
            emotion_distribution={"neutral": 0.80, "fearful": 0.20},
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
        assert data["skill_scores"] == {"vocal_command": 72}


# ---------------------------------------------------------------------------
# Redo, session quality, history and the stored learner profile
# ---------------------------------------------------------------------------


def _call(client: TestClient, user: User, method: str, path: str, **kwargs):
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        return getattr(client, method)(f"/api/v1/apa{path}", **kwargs)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


class TestBaselineRedoAndProfile:
    def test_redo_keeps_existing_plan(self, client: TestClient, db_session: Session):
        """A redo recalculates the profile only; the plan is not regenerated."""
        user = _make_user(db_session)
        _make_profile(db_session, user)
        first, second = _make_mca_session(db_session, user), _make_mca_session(db_session, user)
        plan = _make_plan(db_session, user)
        first_id, second_id, plan_id = str(first.id), str(second.id), str(plan.id)

        mock = AsyncMock(return_value=plan)
        with patch("app.services.pedagogy.orchestrator.generate_training_plan", new=mock):
            first_resp = _call(client, user, "post", "/baseline/complete", json={"mca_session_id": first_id})
            redo_resp = _call(client, user, "post", "/baseline/complete", json={"mca_session_id": second_id})

        assert first_resp.json()["plan_regenerated"] is True
        assert redo_resp.status_code == 201
        assert redo_resp.json()["plan_regenerated"] is False
        assert redo_resp.json()["plan_id"] == plan_id
        mock.assert_awaited_once()

    def test_first_real_baseline_after_skip_builds_plan(self, client: TestClient, db_session: Session):
        """A skipped baseline is not a baseline: the first real one still builds the plan."""
        user = _make_user(db_session)
        _make_profile(db_session, user)
        db_session.add(BaselineSnapshot(
            user_id=user.id, mca_session_id="skipped", created_at=_NOW, updated_at=_NOW,
        ))
        db_session.commit()
        mca_id = str(_make_mca_session(db_session, user).id)
        plan = _make_plan(db_session, user)

        mock = AsyncMock(return_value=plan)
        with patch("app.services.pedagogy.orchestrator.generate_training_plan", new=mock):
            resp = _call(client, user, "post", "/baseline/complete", json={"mca_session_id": mca_id})

        assert resp.status_code == 201
        assert resp.json()["plan_regenerated"] is True
        mock.assert_awaited_once()

    def test_session_that_observed_nothing_is_rejected_with_reason(
        self, client: TestClient, db_session: Session
    ):
        """Every skill at the neutral 50, no emotion, no nudges → 422 the learner can read."""
        user = _make_user(db_session)
        _make_profile(db_session, user)
        empty = _make_mca_session(
            db_session, user,
            skill_scores={k: 50 for k in _MCA_SKILL_SCORES}, emotion_distribution={}, overall_score=50,
        )

        resp = _call(client, user, "post", "/baseline/complete", json={"mca_session_id": str(empty.id)})

        assert resp.status_code == 422
        assert resp.json()["detail"].startswith("This session ran 62 seconds")
        assert _call(client, user, "get", "/baseline/history").json() == []
        assert _call(client, user, "get", "/baseline/me").status_code == 404

    def test_history_is_empty_before_any_baseline(self, client: TestClient, db_session: Session):
        user = _make_user(db_session)
        resp = _call(client, user, "get", "/baseline/history")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_learner_profile_requires_survey(self, client: TestClient, db_session: Session):
        user = _make_user(db_session)
        assert _call(client, user, "get", "/learner-profile/me").status_code == 404

    def test_learner_profile_without_baseline_comes_from_ocean(
        self, client: TestClient, db_session: Session
    ):
        user = _make_user(db_session)
        _make_profile(db_session, user)

        data = _call(client, user, "get", "/learner-profile/me").json()

        assert data["source_mca_session_id"] is None
        assert data["baseline"]["has_baseline"] is False
        assert data["ocean"]["neuroticism"] == pytest.approx(70.0)

    def test_learner_profile_follows_survey_retake(self, client: TestClient, db_session: Session):
        """A stored profile computed from old OCEAN scores is recalculated on read."""
        user = _make_user(db_session)
        user_id = user.id
        _make_profile(db_session, user)
        before = _call(client, user, "get", "/learner-profile/me").json()

        # The request closed the session, so re-load the row before editing it.
        db_session.query(PersonalityProfile).filter(
            PersonalityProfile.user_id == user_id
        ).one().neuroticism = 20.0
        db_session.commit()
        after = _call(client, user, "get", "/learner-profile/me").json()

        assert before["strategy"]["tone"] == "gentle"
        assert after["ocean"]["neuroticism"] == pytest.approx(20.0)
        assert after["strategy"]["tone"] == "challenging"
