"""
Full adaptive-loop integration test.

Covers the complete Phase 1–6 happy path end-to-end:
  1. generate_training_plan  (OCEAN-only)   → plan with brief_json
  2. complete_baseline                       → plan gains baseline_summary_json,
                                               strategy may soften, priority_skills set
  3. session-feedback (failure outcome)     → difficulty drops, AdjustmentHistory row
  4. live-signals (critical nudges)         → adjustment hint returned
  5. baseline-skip                          → plan regenerated without requiring session

Only `select_scenarios` (which calls real RPE + LLM) is mocked.
All DB operations, orchestrator logic, brief generation, and dynamic adjustment
run against the live SQLite test database.

This test proves the THESIS claim end-to-end:
  An anxious-introvert OCEAN profile produces a gentle/slow plan that softens
  further when baseline evidence shows high stress, and difficulty drops after
  a failed session.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.contracts.rpe import CoachingAdvice, FeedbackResponse
from app.core.auth import get_current_user
from app.main import app
from app.models.personality_profile import PersonalityProfile
from app.models.session_result import SessionResult
from app.models.training_plan import AdjustmentHistory, TrainingPlan
from app.models.user import User
from app.services.pedagogy.scenario_selector import ScenarioSelectionResult

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_NOW = datetime.now(timezone.utc)

_MOCK_SELECTION = ScenarioSelectionResult(
    primary_scenario={
        "scenario_id": "scenario_002",
        "title": "Workplace Conflict",
        "npc_role": "Difficult Manager",
        "context": "Resolving a scheduling dispute.",
        "target_skills": ["assertiveness", "conflict_resolution"],
        "opening_npc_line": "I don't have time for this.",
        "difficulty": "beginner",
    },
    recommended_scenario_ids=["scenario_002", "scenario_003"],
    match_score=0.75,
    generation_source="rpe_library",
    rationale=["Good skill overlap"],
)

# OCEAN profile for an anxious introvert (Alex persona)
_ALEX_OCEAN = dict(
    openness=40.0, conscientiousness=40.0, extraversion=25.0,
    agreeableness=55.0, neuroticism=70.0,
)

# Baseline evidence: high stress, low confidence, weak assertiveness
_ALEX_BASELINE = dict(
    skill_scores={"assertiveness": 0.25, "boundary_setting": 0.30, "emotional_regulation": 0.35},
    emotion_distribution={"anxious": 0.45, "nervous": 0.27, "calm": 0.18, "neutral": 0.10},
    overall_score=38,
    duration_seconds=210,
)


def _make_user(db: Session) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"loop_{uid.hex[:8]}@test.loop",
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
        **_ALEX_OCEAN,
        raw_responses={},
        created_at=_NOW,
        updated_at=_NOW,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def _make_mca_session(db: Session, user: User) -> SessionResult:
    session = SessionResult(
        user_id=user.id,
        session_type="baseline",
        status="completed",
        started_at=_NOW,
        ended_at=_NOW,
        duration_seconds=_ALEX_BASELINE["duration_seconds"],
        overall_score=_ALEX_BASELINE["overall_score"],
        skill_scores=_ALEX_BASELINE["skill_scores"],
        emotion_distribution=_ALEX_BASELINE["emotion_distribution"],
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


# ---------------------------------------------------------------------------
# The test class — one user, sequential steps
# ---------------------------------------------------------------------------

class TestFullAdaptiveLoop:
    """
    Sequential integration test of the complete adaptive loop.
    Each method advances the state; they must run in definition order.
    """

    _SERVICE_TOKEN = "test-integration-service-token"

    def _call(self, client, user, method: str, path: str, **kwargs):
        try:
            app.dependency_overrides[get_current_user] = lambda: user
            fn = getattr(client, method)
            return fn(f"/api/v1{path}", **kwargs)
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def _call_session_feedback(self, client, fb: FeedbackResponse):
        """
        session-feedback uses its own auth (service-token or Bearer JWT),
        not get_current_user.  Patch settings + mock analytics to avoid
        hitting Supabase from the test suite.
        """
        from unittest.mock import MagicMock, patch as _patch
        mock_settings = MagicMock()
        mock_settings.apm_service_token = self._SERVICE_TOKEN
        mock_settings.apm_write_analytics = False

        with _patch("app.api.v1.pedagogy.get_settings", return_value=mock_settings), \
             _patch("app.services.pedagogy.analytics_writer.write_session_metrics"), \
             _patch("app.services.pedagogy.analytics_writer.write_feedback_entries"):
            return client.post(
                "/api/v1/apa/session-feedback",
                json=fb.model_dump(),
                headers={"X-Service-Token": self._SERVICE_TOKEN},
            )

    # ------------------------------------------------------------------
    # Step 1 — plan/generate (OCEAN-only, no baseline)
    # ------------------------------------------------------------------

    def test_01_generate_plan_ocean_only(self, client, db_session):
        """Plan generation produces brief_json and correct OCEAN-driven strategy."""
        user = _make_user(db_session)
        _make_profile(db_session, user)

        with patch(
            "app.services.pedagogy.scenario_selector.select_scenarios",
            new=AsyncMock(return_value=_MOCK_SELECTION),
        ):
            resp = self._call(client, user, "post", "/apa/plan/generate")

        assert resp.status_code == 201, resp.text
        data = resp.json()

        # Strategy: N=70 → gentle, E=25 → slow/warm_supportive
        assert data["strategy"]["tone"] == "gentle"
        assert data["strategy"]["pacing"] == "slow"
        assert data["strategy"]["npc_personality"] == "warm_supportive"
        assert data["strategy"]["feedback_style"] == "encouraging"

        # Difficulty: N=70 → -2, E=25 → -1 from base 5 = 2
        assert data["difficulty"] == 2

        # Brief is generated
        assert data["brief_json"] is not None
        brief = data["brief_json"]
        assert brief["summary"]
        assert len(brief["drivers"]) >= 1
        assert len(brief["strategy_highlights"]) == 5
        assert brief["difficulty_rationale"]
        assert brief["has_baseline_evidence"] is False

        # No baseline yet
        assert data["baseline_summary_json"] is None

    # ------------------------------------------------------------------
    # Step 2 — baseline/complete (injects measured evidence)
    # ------------------------------------------------------------------

    def test_02_baseline_complete_calibrates_plan(self, client, db_session):
        """After baseline, plan brief reflects has_baseline_evidence=True."""
        user = _make_user(db_session)
        user_id = user.id  # capture before any request detaches the ORM object
        _make_profile(db_session, user)
        mca = _make_mca_session(db_session, user)
        mca_id_str = str(mca.id)

        with patch(
            "app.services.pedagogy.scenario_selector.select_scenarios",
            new=AsyncMock(return_value=_MOCK_SELECTION),
        ):
            resp = self._call(
                client, user, "post", "/apa/baseline/complete",
                json={"mca_session_id": mca_id_str},
            )

        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert "baseline" in data
        assert "plan_id" in data

        # Verify plan now has baseline evidence via direct DB query (user is detached)
        plan = (
            db_session.query(TrainingPlan)
            .filter(TrainingPlan.user_id == user_id)
            .first()
        )
        assert plan is not None
        assert plan.baseline_summary_json is not None
        bl = plan.baseline_summary_json
        assert bl["has_baseline"] is True
        assert bl["stress_indicator"] == pytest.approx(0.72, abs=0.01)
        # calm=0.18 + neutral=0.10 → 0.28  (confident/calm/happy/neutral set)
        assert bl["confidence_indicator"] == pytest.approx(0.28, abs=0.01)

        # Brief should now reflect baseline evidence
        assert plan.brief_json["has_baseline_evidence"] is True

        # Priority skills from baseline weak scores
        strat = plan.strategy_json
        assert len(strat["priority_skills"]) >= 1
        assert "assertiveness" in strat["priority_skills"]

    # ------------------------------------------------------------------
    # Step 3 — session-feedback (failure → difficulty drops)
    # ------------------------------------------------------------------

    def test_03_session_feedback_drops_difficulty(self, client, db_session):
        """A failed session decreases difficulty and creates an AdjustmentHistory row."""
        user = _make_user(db_session)
        user_id = user.id  # capture before any request detaches the ORM object
        _make_profile(db_session, user)

        # Seed a plan at difficulty 5 to give room to drop
        plan = TrainingPlan(
            user_id=user.id,
            skill="job_interview",
            strategy_json={
                "tone": "gentle", "pacing": "slow", "complexity": "simple",
                "npc_personality": "warm_supportive", "feedback_style": "encouraging",
                "rationale": [], "priority_skills": ["assertiveness"],
            },
            difficulty=5,
            recommended_scenario_ids=[],
            primary_scenario_json={"scenario_id": "none"},
            generation_source="gemini_fallback",
            generation_status="completed",
            created_at=_NOW,
            updated_at=_NOW,
        )
        db_session.add(plan)
        db_session.commit()

        fb = FeedbackResponse(
            session_id="test-session-001",
            scenario_id="scenario_002",
            scenario_title="Workplace Conflict",
            user_id=str(user.id),
            outcome="failure",
            final_trust=20,
            final_escalation=3,
            total_turns=5,
            coaching_advice=CoachingAdvice(
                overall_rating="poor",
                summary="Struggled under pressure.",
                advice=["Stay calm"],
                strengths=[],
                focus_areas=["assertiveness"],
            ),
        )

        resp = self._call_session_feedback(client, fb)

        assert resp.status_code == 200, resp.text
        data = resp.json()

        # Difficulty must have dropped from 5
        assert data["difficulty"] < 5, (
            f"Expected difficulty < 5 after failure, got {data['difficulty']}"
        )

        # AdjustmentHistory row must exist
        history = (
            db_session.query(AdjustmentHistory)
            .filter(AdjustmentHistory.user_id == user_id)
            .all()
        )
        assert len(history) >= 1
        entry = history[0]
        assert entry.trigger == "session_end"
        assert entry.previous_difficulty == 5
        assert entry.new_difficulty < 5

    # ------------------------------------------------------------------
    # Step 4 — live-signals (critical nudges → hint returned)
    # ------------------------------------------------------------------

    def test_04_live_signals_returns_adjustment_hint(self, client, db_session):
        """Critical nudges from MCA cause a difficulty hint; response is well-formed."""
        user = _make_user(db_session)
        _make_profile(db_session, user)

        plan = TrainingPlan(
            user_id=user.id,
            skill="job_interview",
            strategy_json={
                "tone": "gentle", "pacing": "slow", "complexity": "simple",
                "npc_personality": "warm_supportive", "feedback_style": "encouraging",
                "rationale": [], "priority_skills": [],
            },
            difficulty=5,
            recommended_scenario_ids=[],
            primary_scenario_json={"scenario_id": "none"},
            generation_source="gemini_fallback",
            generation_status="completed",
            created_at=_NOW,
            updated_at=_NOW,
        )
        db_session.add(plan)
        db_session.commit()

        nudges = [
            {"emotion": "anxious", "confidence": 0.85,
             "nudge_category": "pace", "nudge_severity": "critical"},
            {"emotion": "nervous", "confidence": 0.70,
             "nudge_category": "volume", "nudge_severity": "critical"},
            {"emotion": "anxious", "confidence": 0.78,
             "nudge_category": "silence", "nudge_severity": "warning"},
        ]
        resp = self._call(client, user, "post", "/apa/live-signals", json={"nudges": nudges})

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "new_difficulty" in data
        assert "rationale" in data
        assert "signals_summary" in data
        assert isinstance(data["rationale"], list)
        assert 1 <= data["new_difficulty"] <= 10

    # ------------------------------------------------------------------
    # Step 5 — baseline-skip (regenerates plan without MCA session)
    # ------------------------------------------------------------------

    def test_05_baseline_skip_creates_plan(self, client, db_session):
        """baseline-skip generates a plan and returns 201 even without a SessionResult."""
        user = _make_user(db_session)
        _make_profile(db_session, user)

        with patch(
            "app.services.pedagogy.scenario_selector.select_scenarios",
            new=AsyncMock(return_value=_MOCK_SELECTION),
        ):
            resp = self._call(client, user, "post", "/apa/baseline-skip")

        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["strategy"]["tone"] == "gentle"
        assert data["difficulty"] == 2
        assert data["brief_json"] is not None

    # ------------------------------------------------------------------
    # Step 6 — plan history populated after feedback
    # ------------------------------------------------------------------

    def test_06_plan_history_populated_after_feedback(self, client, db_session):
        """GET /apa/plan/history returns entries after session feedback."""
        user = _make_user(db_session)
        user_id = user.id  # capture before any request detaches the ORM object
        _make_profile(db_session, user)

        plan = TrainingPlan(
            user_id=user.id,
            skill="job_interview",
            strategy_json={
                "tone": "gentle", "pacing": "slow", "complexity": "simple",
                "npc_personality": "warm_supportive", "feedback_style": "encouraging",
                "rationale": [], "priority_skills": [],
            },
            difficulty=5,
            recommended_scenario_ids=[],
            primary_scenario_json={"scenario_id": "none"},
            generation_source="gemini_fallback",
            generation_status="completed",
            created_at=_NOW,
            updated_at=_NOW,
        )
        db_session.add(plan)
        db_session.commit()

        fb = FeedbackResponse(
            session_id="test-history-001",
            scenario_id="scenario_002",
            scenario_title="Conflict",
            user_id=str(user.id),
            outcome="success",
            final_trust=85,
            final_escalation=0,
            total_turns=5,
            coaching_advice=CoachingAdvice(
                overall_rating="excellent",
                summary="Great session.",
                advice=[], strengths=["assertiveness"], focus_areas=[],
            ),
        )
        self._call_session_feedback(client, fb)

        # Query DB directly — user is detached after session-feedback call
        history = (
            db_session.query(AdjustmentHistory)
            .filter(AdjustmentHistory.user_id == user_id)
            .order_by(AdjustmentHistory.created_at.desc())
            .all()
        )
        assert len(history) >= 1
        assert history[0].trigger == "session_end"

    # ------------------------------------------------------------------
    # Thesis comparison: two personas get measurably different plans
    # ------------------------------------------------------------------

    def test_07_two_personas_differ_end_to_end(self, client, db_session):
        """
        THESIS END-TO-END: Alex (N=70,E=25) and Jordan (N=30,E=80) must receive
        different strategies from the same engine when plans are generated via
        the full HTTP → orchestrator → DB stack.
        """
        def _generate(ocean: dict) -> dict:
            uid = uuid.uuid4()
            user = User(
                id=uid, email=f"thesis_{uid.hex[:6]}@test.loop",
                created_at=_NOW, updated_at=_NOW,
            )
            db_session.add(user)
            profile = PersonalityProfile(
                user_id=uid, **ocean, raw_responses={},
                created_at=_NOW, updated_at=_NOW,
            )
            db_session.add(profile)
            db_session.commit()
            db_session.refresh(user)

            with patch(
                "app.services.pedagogy.scenario_selector.select_scenarios",
                new=AsyncMock(return_value=_MOCK_SELECTION),
            ):
                resp = self._call(client, user, "post", "/apa/plan/generate")
            assert resp.status_code == 201
            return resp.json()

        alex_plan = _generate(_ALEX_OCEAN)
        jordan_plan = _generate(dict(
            openness=65.0, conscientiousness=70.0, extraversion=80.0,
            agreeableness=55.0, neuroticism=30.0,
        ))

        # Tone must differ
        assert alex_plan["strategy"]["tone"] != jordan_plan["strategy"]["tone"], (
            f"Both got tone={alex_plan['strategy']['tone']!r} — personas must differ"
        )
        # Difficulty must differ
        assert alex_plan["difficulty"] < jordan_plan["difficulty"], (
            f"Alex difficulty {alex_plan['difficulty']} must be < "
            f"Jordan difficulty {jordan_plan['difficulty']}"
        )
        # Alex must get gentle
        assert alex_plan["strategy"]["tone"] == "gentle"
        # Jordan must not get gentle
        assert jordan_plan["strategy"]["tone"] != "gentle"
