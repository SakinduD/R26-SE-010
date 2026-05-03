"""Critical-path integration tests for the survey API endpoints."""

import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_db
from app.core.auth import get_current_user
from app.main import app
from app.models.personality_profile import PersonalityProfile
from app.models.user import User

# Fixed UUID so we can count rows by user_id without guessing
TEST_USER_ID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

_ALL_THREES: dict[str, int] = {str(i): 3 for i in range(1, 45)}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_profiles(db_session):
    """Delete all personality_profile rows before each test for isolation."""
    db_session.query(PersonalityProfile).delete()
    db_session.commit()
    yield


@pytest.fixture
def mock_user() -> User:
    return User(id=TEST_USER_ID, email="survey-test@example.com")


@pytest.fixture
def auth_client(db_session, mock_user):
    """TestClient with get_db and get_current_user overridden."""

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: mock_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def anon_client(db_session):
    """TestClient with only get_db overridden — no auth."""

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# GET /api/v1/survey/questions
# ---------------------------------------------------------------------------


def test_get_questions_returns_44_items(anon_client):
    resp = anon_client.get("/api/v1/survey/questions")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 44
    for item in data:
        assert {"id", "text", "trait", "reverse"}.issubset(item.keys()), (
            f"Question missing required fields: {item}"
        )
    ids = [item["id"] for item in data]
    assert len(set(ids)) == 44, "Duplicate question ids found"


# ---------------------------------------------------------------------------
# POST /api/v1/survey/submit
# ---------------------------------------------------------------------------


def test_submit_without_auth_returns_401(anon_client):
    resp = anon_client.post("/api/v1/survey/submit", json={"answers": _ALL_THREES})
    assert resp.status_code == 401


def test_submit_with_valid_auth_returns_200(auth_client):
    resp = auth_client.post("/api/v1/survey/submit", json={"answers": _ALL_THREES})
    assert resp.status_code == 200
    body = resp.json()

    valid_levels = {"low", "mid", "high"}
    for trait in ("openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"):
        trait_data = body["scores"][trait]
        assert 0 <= trait_data["score"] <= 100, (
            f"{trait} score {trait_data['score']} out of [0, 100]"
        )
        assert trait_data["level"] in valid_levels, (
            f"{trait} level '{trait_data['level']}' not in {valid_levels}"
        )


def test_submit_twice_upserts_single_row(auth_client, db_session):
    resp1 = auth_client.post("/api/v1/survey/submit", json={"answers": _ALL_THREES})
    assert resp1.status_code == 200
    updated_at_1 = resp1.json()["updated_at"]

    time.sleep(0.02)  # ensure distinct timestamps at microsecond resolution

    resp2 = auth_client.post("/api/v1/survey/submit", json={"answers": _ALL_THREES})
    assert resp2.status_code == 200
    updated_at_2 = resp2.json()["updated_at"]

    assert updated_at_2 != updated_at_1, "updated_at must change on resubmission"

    count = (
        db_session.query(PersonalityProfile)
        .filter(PersonalityProfile.user_id == TEST_USER_ID)
        .count()
    )
    assert count == 1, f"Expected 1 profile row, found {count}"


# ---------------------------------------------------------------------------
# GET /api/v1/survey/profile/me
# ---------------------------------------------------------------------------


def test_get_profile_before_submission_returns_404(auth_client):
    resp = auth_client.get("/api/v1/survey/profile/me")
    assert resp.status_code == 404


def test_get_profile_after_submission_returns_200(auth_client):
    submit = auth_client.post("/api/v1/survey/submit", json={"answers": _ALL_THREES})
    assert submit.status_code == 200

    resp = auth_client.get("/api/v1/survey/profile/me")
    assert resp.status_code == 200
    body = resp.json()

    assert "scores" in body
    assert "created_at" in body
    assert "updated_at" in body
    # All-threes should yield 50.0 for every trait
    for trait in ("openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"):
        assert body["scores"][trait]["score"] == pytest.approx(50.0, abs=0.1), (
            f"{trait} expected ~50.0"
        )
        assert body["scores"][trait]["level"] == "mid"
