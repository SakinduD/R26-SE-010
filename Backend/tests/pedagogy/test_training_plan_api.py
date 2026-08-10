"""
Tests for the Personalised Training Plan API — /api/v1/apa/training-plan/*.

Every request goes through conftest's `client` fixture, which overrides get_db
with the SQLite test session — so `db_session` writes and API reads share one
transaction.

Gemini is never called for real: the APM LLM client factory is replaced with an
AsyncMock, so each test exercises either the mocked LLM parse or the
rule-based fallback.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.contracts.training_plan import SCHEMA_VERSION, ScenarioGenerationBrief
from app.core.auth import get_current_user
from app.main import app
from app.models.personality_profile import PersonalityProfile
from app.models.training_plan import PersonalisedTrainingPlan
from app.models.user import User
from app.services.pedagogy.adapter import RPE_SKILL_VOCABULARY

BASE = "/api/v1/apa/training-plan"

GOAL = "practise pushing back on my manager when scope creeps mid-sprint"

# Anxious introvert — the persona the worked example in the docs uses.
ANXIOUS_INTROVERT = {
    "openness": 40.0,
    "conscientiousness": 40.0,
    "extraversion": 25.0,
    "agreeableness": 55.0,
    "neuroticism": 70.0,
}

_LLM_INTENT = {
    "domain": "conflict_resolution",
    "workplace_context": "sprint retro on a 6-person dev team",
    "learner_role": "senior engineer",
    "counterpart_role": "engineering manager",
    "counterpart_disposition": "resistant",
    "desired_focus_skills": ["boundary_setting", "assertiveness"],
    "intensity_preference": "balanced",
    "session_length": "standard",
    "parse_confidence": 0.88,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user(db_session, *, tag: str) -> uuid.UUID:
    """Insert a user and return its id.

    The id (not the ORM object) is what tests hold: conftest's get_db override
    closes the session after every request, which would detach a live User.
    """
    now = datetime.now(timezone.utc)
    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"{tag}_{uid.hex[:6]}@test.plan",
            created_at=now,
            updated_at=now,
        )
    )
    db_session.commit()
    return uid


def _give_profile(db_session, uid: uuid.UUID, ocean: dict | None = None) -> None:
    now = datetime.now(timezone.utc)
    db_session.add(
        PersonalityProfile(
            user_id=uid,
            raw_responses={},
            version="test-v1",
            created_at=now,
            updated_at=now,
            **(ocean or ANXIOUS_INTROVERT),
        )
    )
    db_session.commit()


@pytest.fixture
def llm_mock():
    """Patch the APM Gemini client factory used by the API layer."""
    mock = AsyncMock()
    mock.generate_json.return_value = dict(_LLM_INTENT)
    with patch("app.api.v1.training_plan.get_apm_llm_client", return_value=mock):
        yield mock


def _as(uid: uuid.UUID) -> None:
    """Authenticate as this user id, using a transient (session-free) User."""
    principal = User(id=uid, email="override@test.plan")
    app.dependency_overrides[get_current_user] = lambda: principal


def _clear_auth() -> None:
    app.dependency_overrides.pop(get_current_user, None)


def _generate(client, **body) -> dict:
    payload = {"goal_text": GOAL}
    payload.update(body)
    resp = client.post(f"{BASE}/generate", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def test_all_learner_routes_require_auth(client):
    assert client.post(
        f"{BASE}/generate", json={"goal_text": GOAL}
    ).status_code in (401, 403)
    assert client.get(f"{BASE}/active").status_code in (401, 403)
    assert client.get(BASE).status_code in (401, 403)
    assert client.get(f"{BASE}/skill-vocabulary").status_code in (401, 403)
    assert client.get(f"{BASE}/{uuid.uuid4()}").status_code in (401, 403)


# ---------------------------------------------------------------------------
# Generate — happy path
# ---------------------------------------------------------------------------


def test_generate_happy_path(client, db_session, llm_mock):
    uid = _make_user(db_session, tag="happy")
    _give_profile(db_session, uid)

    try:
        _as(uid)
        data = _generate(client)
    finally:
        _clear_auth()

    assert data["schema_version"] == SCHEMA_VERSION
    assert data["plan_version"] == 1
    assert data["status"] == "active"
    assert data["user_id"] == str(uid)

    # Intent came from the mocked LLM
    assert data["intent"]["parse_source"] == "llm"
    assert data["intent"]["domain"] == "conflict_resolution"
    assert data["generation_sources"]["intent"] == "llm"

    # Blueprint is a build spec, not scenario content
    blueprint = data["blueprint"]
    assert blueprint["title_hint"]
    assert 3 <= len(blueprint["required_beats"]) <= 5
    assert blueprint["trigger_event"]
    assert 1 <= blueprint["pressure_level"] <= 5
    assert "opening_npc_line" not in blueprint

    # Pedagogy + adaptation
    assert 1 <= data["pedagogy"]["difficulty"] <= 10
    assert data["adaptation"]["max_difficulty_delta"] == 1
    assert data["personalisation_brief"]

    # Target skills are RPE-vocabulary only
    assert data["target_skills"]
    assert all(s in RPE_SKILL_VOCABULARY for s in data["target_skills"])

    # inputs_snapshot exposes levels, never raw scores
    snapshot = data["inputs_snapshot"]
    assert set(snapshot["ocean_levels"].values()) <= {"low", "mid", "high"}
    assert snapshot["baseline_present"] is False
    assert snapshot["sessions_considered"] == 0


def test_generate_still_succeeds_when_llm_unavailable(client, db_session):
    """No usable Gemini key → rule_based intent, still 201."""
    uid = _make_user(db_session, tag="nollm")
    _give_profile(db_session, uid)

    broken = AsyncMock()
    broken.generate_json.side_effect = RuntimeError("no key configured")

    try:
        _as(uid)
        with patch(
            "app.api.v1.training_plan.get_apm_llm_client", return_value=broken
        ):
            data = _generate(client)
    finally:
        _clear_auth()

    assert data["intent"]["parse_source"] == "rule_based"
    assert data["generation_sources"]["intent"] == "rule_based"
    assert data["intent"]["parse_confidence"] <= 0.5


def test_structured_overrides_win_over_llm(client, db_session, llm_mock):
    uid = _make_user(db_session, tag="override")
    _give_profile(db_session, uid)

    try:
        _as(uid)
        data = _generate(
            client,
            domain="negotiation",
            counterpart_role="VP of Product",
            focus_skills=["self_advocacy"],
            intensity_preference="challenging",
            session_length="extended",
        )
    finally:
        _clear_auth()

    assert data["intent"]["domain"] == "negotiation"
    assert data["intent"]["counterpart_role"] == "VP of Product"
    assert data["intent"]["intensity_preference"] == "challenging"
    assert data["blueprint"]["target_turn_count"] == 12   # extended
    assert "self_advocacy" in data["target_skills"]


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_missing_personality_profile_returns_409(client, db_session, llm_mock):
    uid = _make_user(db_session, tag="noprofile")
    # deliberately no PersonalityProfile

    try:
        _as(uid)
        resp = client.post(f"{BASE}/generate", json={"goal_text": GOAL})
    finally:
        _clear_auth()

    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "PERSONALITY_PROFILE_MISSING"


def test_unknown_focus_skill_returns_422_with_allowed_list(
    client, db_session, llm_mock
):
    uid = _make_user(db_session, tag="badskill")
    _give_profile(db_session, uid)

    try:
        _as(uid)
        resp = client.post(
            f"{BASE}/generate",
            json={"goal_text": GOAL, "focus_skills": ["telepathy"]},
        )
    finally:
        _clear_auth()

    assert resp.status_code == 422
    body = resp.text
    assert "telepathy" in body
    # The allowed list travels with the error so the frontend can self-correct.
    assert "assertiveness" in body


@pytest.mark.parametrize("goal", ["too short", "x" * 501])
def test_goal_text_length_is_enforced(client, db_session, llm_mock, goal):
    uid = _make_user(db_session, tag="goallen")
    _give_profile(db_session, uid)

    try:
        _as(uid)
        resp = client.post(f"{BASE}/generate", json={"goal_text": goal})
    finally:
        _clear_auth()

    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Reads, ownership, pagination
# ---------------------------------------------------------------------------


def test_cross_user_access_returns_404(client, db_session, llm_mock):
    owner_id = _make_user(db_session, tag="owner")
    intruder_id = _make_user(db_session, tag="intruder")
    _give_profile(db_session, owner_id)
    _give_profile(db_session, intruder_id)

    try:
        _as(owner_id)
        plan_id = _generate(client)["plan_id"]

        _as(intruder_id)
        get_resp = client.get(f"{BASE}/{plan_id}")
        patch_resp = client.patch(
            f"{BASE}/{plan_id}/status", json={"action": "archive"}
        )
        regen_resp = client.post(f"{BASE}/{plan_id}/regenerate")
    finally:
        _clear_auth()

    assert get_resp.status_code == 404
    assert patch_resp.status_code == 404
    assert regen_resp.status_code == 404


def test_active_and_history_endpoints(client, db_session, llm_mock):
    uid = _make_user(db_session, tag="history")
    _give_profile(db_session, uid)

    try:
        _as(uid)
        first = _generate(client)
        second = _generate(client)

        active = client.get(f"{BASE}/active")
        listing = client.get(BASE, params={"limit": 1, "offset": 0})
        old = client.get(f"{BASE}/{first['plan_id']}").json()
    finally:
        _clear_auth()

    assert active.status_code == 200
    # Generating again archives the previous plan — newest is the active one.
    assert active.json()["plan_id"] == second["plan_id"]

    body = listing.json()
    assert body["total"] >= 2
    assert body["limit"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["plan_id"] == second["plan_id"]

    # The first plan is still readable, just archived.
    assert old["status"] == "archived"


def test_active_returns_404_when_none(client, db_session):
    uid = _make_user(db_session, tag="noactive")

    try:
        _as(uid)
        resp = client.get(f"{BASE}/active")
    finally:
        _clear_auth()

    assert resp.status_code == 404


def test_skill_vocabulary_returns_the_eleven_rpe_skills(client, db_session):
    uid = _make_user(db_session, tag="vocab")

    try:
        _as(uid)
        resp = client.get(f"{BASE}/skill-vocabulary")
    finally:
        _clear_auth()

    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 11
    assert set(body["skills"]) == set(RPE_SKILL_VOCABULARY)


# ---------------------------------------------------------------------------
# Regenerate + status
# ---------------------------------------------------------------------------


def test_regenerate_increments_version_and_archives_previous(
    client, db_session, llm_mock
):
    uid = _make_user(db_session, tag="regen")
    _give_profile(db_session, uid)

    try:
        _as(uid)
        original = _generate(client)
        resp = client.post(f"{BASE}/{original['plan_id']}/regenerate")
        assert resp.status_code == 201, resp.text
        regenerated = resp.json()

        previous = client.get(f"{BASE}/{original['plan_id']}").json()
    finally:
        _clear_auth()

    assert regenerated["plan_version"] == original["plan_version"] + 1
    assert regenerated["plan_id"] != original["plan_id"]
    assert regenerated["status"] == "active"
    assert previous["status"] == "archived"

    # Same intent, rebuilt — the goal text is carried over verbatim.
    assert regenerated["intent"]["raw_text"] == original["intent"]["raw_text"]
    assert regenerated["intent"]["domain"] == original["intent"]["domain"]


def test_patch_status_activate_and_archive(client, db_session, llm_mock):
    uid = _make_user(db_session, tag="status")
    _give_profile(db_session, uid)

    try:
        _as(uid)
        first = _generate(client)
        second = _generate(client)

        # Re-activate the older plan; the newer one must be archived.
        reactivated = client.patch(
            f"{BASE}/{first['plan_id']}/status", json={"action": "activate"}
        )
        newer = client.get(f"{BASE}/{second['plan_id']}").json()

        archived = client.patch(
            f"{BASE}/{first['plan_id']}/status", json={"action": "archive"}
        )
        bad = client.patch(
            f"{BASE}/{first['plan_id']}/status", json={"action": "explode"}
        )
    finally:
        _clear_auth()

    assert reactivated.status_code == 200
    assert reactivated.json()["status"] == "active"
    assert newer["status"] == "archived"
    assert archived.json()["status"] == "archived"
    assert bad.status_code == 422


# ---------------------------------------------------------------------------
# Scenario brief — the RPE-facing route
# ---------------------------------------------------------------------------


def test_scenario_brief_rejects_request_with_neither_token_nor_jwt(
    client, db_session, llm_mock
):
    uid = _make_user(db_session, tag="briefauth")
    _give_profile(db_session, uid)

    try:
        _as(uid)
        plan_id = _generate(client)["plan_id"]
    finally:
        _clear_auth()

    # No JWT, no service token → 401
    assert client.get(f"{BASE}/{plan_id}/scenario-brief").status_code == 401

    # Wrong service token → 401
    assert client.get(
        f"{BASE}/{plan_id}/scenario-brief",
        headers={"X-Service-Token": "definitely-not-the-token"},
    ).status_code == 401


def test_scenario_brief_with_service_token(client, db_session, llm_mock):
    from app.config import get_settings

    uid = _make_user(db_session, tag="briefsvc")
    _give_profile(db_session, uid)

    try:
        _as(uid)
        plan_id = _generate(client)["plan_id"]
    finally:
        _clear_auth()

    token = "test-service-token"
    with patch.object(get_settings(), "apm_service_token", token):
        resp = client.get(
            f"{BASE}/{plan_id}/scenario-brief",
            headers={"X-Service-Token": token},
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Validates against the published contract model
    brief = ScenarioGenerationBrief(**body)
    assert brief.schema_version == SCHEMA_VERSION
    assert brief.plan_id == plan_id

    # Big Five arrive on RPE's 0.0-1.0 scale, converted by adapter.py only.
    profile = body["learner_profile"]
    for trait in ("openness", "conscientiousness", "extraversion",
                  "agreeableness", "neuroticism"):
        assert 0.0 <= profile[trait] <= 1.0
    assert profile["neuroticism"] == pytest.approx(
        ANXIOUS_INTROVERT["neuroticism"] / 100.0
    )
    assert profile["extraversion"] == pytest.approx(
        ANXIOUS_INTROVERT["extraversion"] / 100.0
    )
    assert profile["recommended_difficulty"] in (
        "beginner", "intermediate", "advanced"
    )
    assert set(profile["weak_skills"]) <= RPE_SKILL_VOCABULARY

    # Full build spec present, no scenario content
    assert body["blueprint"]["required_beats"]
    assert body["blueprint"]["escalation_seed"]["initial_trust"] <= 1.0
    assert body["pedagogy"]["teaching_strategy"]
    assert "opening_npc_line" not in body["blueprint"]


def test_scenario_brief_stamps_consumed_at_without_changing_status(
    client, db_session, llm_mock
):
    uid = _make_user(db_session, tag="consumed")
    _give_profile(db_session, uid)

    try:
        _as(uid)
        plan_id = _generate(client)["plan_id"]
        with patch(
            "app.api.v1.training_plan.verify_jwt",
            return_value=type("P", (), {"sub": str(uid)})(),
        ):
            first = client.get(
                f"{BASE}/{plan_id}/scenario-brief",
                headers={"Authorization": "Bearer fake-jwt"},
            )
            # RPE may retry — a second fetch must also succeed.
            second = client.get(
                f"{BASE}/{plan_id}/scenario-brief",
                headers={"Authorization": "Bearer fake-jwt"},
            )
        plan = client.get(f"{BASE}/{plan_id}").json()
    finally:
        _clear_auth()

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["consumed_at"] is None      # stamped after the response
    assert second.json()["consumed_at"] is not None
    assert plan["status"] == "active"               # unchanged by consumption

    row = (
        db_session.query(PersonalisedTrainingPlan)
        .filter(PersonalisedTrainingPlan.id == uuid.UUID(plan_id))
        .first()
    )
    assert row.consumed_at is not None


def test_scenario_brief_cross_user_jwt_returns_404(client, db_session, llm_mock):
    owner_id = _make_user(db_session, tag="bowner")
    intruder_id = _make_user(db_session, tag="bintruder")
    _give_profile(db_session, owner_id)
    _give_profile(db_session, intruder_id)

    try:
        _as(owner_id)
        plan_id = _generate(client)["plan_id"]

        # The service route reads the JWT itself rather than using
        # get_current_user, so drive it with a patched verify_jwt.
        with patch(
            "app.api.v1.training_plan.verify_jwt",
            return_value=type("P", (), {"sub": str(intruder_id)})(),
        ):
            resp = client.get(
                f"{BASE}/{plan_id}/scenario-brief",
                headers={"Authorization": "Bearer fake-jwt"},
            )
    finally:
        _clear_auth()

    assert resp.status_code == 404
