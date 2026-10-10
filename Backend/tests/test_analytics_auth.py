"""Who may call the analytics routes.

Every one of them used to depend on get_db alone, so anyone who had a learner
id could read that learner's analytics without signing in. These run against
the real access dependency; tests/analytics swaps it out to exercise the logic.
"""
import re
import uuid

import pytest
from fastapi.routing import APIRoute

from app.core.auth import get_current_user
from app.main import app
from app.models.analytics import AnalyticsSessionMetric
from app.models.user import User

BASE = "/api/v1/analytics"

_PATH_VALUES = {
    "user_id": "someone",
    "session_id": "some-session",
    "skill_area": "clarity",
    "metric_id": "1",
    "feedback_id": "1",
    "prediction_id": "1",
}


def _analytics_routes():
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith(BASE + "/"):
            for method in route.methods:
                yield method, route.path


def _fill(path: str) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: _PATH_VALUES[m.group(1)], path)


def _as(user_id: str) -> None:
    principal = User(id=uuid.UUID(user_id), email="analytics@test.auth")
    app.dependency_overrides[get_current_user] = lambda: principal


@pytest.fixture
def me():
    return str(uuid.uuid4())


@pytest.fixture
def someone_else():
    return str(uuid.uuid4())


def _metric(db_session, user_id: str, session_id: str) -> AnalyticsSessionMetric:
    row = AnalyticsSessionMetric(user_id=user_id, session_id=session_id, overall_score=70)
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_every_analytics_route_needs_a_token(client):
    routes = sorted(_analytics_routes())
    assert routes, "no analytics routes found"

    let_through = []
    for method, path in routes:
        response = client.request(method, _fill(path), json={})
        if response.status_code != 401:
            let_through.append(f"{method} {path} -> {response.status_code}")

    assert not let_through, "reachable without a token:\n" + "\n".join(let_through)


def test_learner_reads_own_analytics(client, me):
    _as(me)
    assert client.get(f"{BASE}/users/{me}/aggregate").status_code == 200


def test_learner_cannot_read_another_learners_analytics(client, me, someone_else):
    _as(me)
    for suffix in ("aggregate", "feedback", "skill-history", "gamification", "sessions"):
        response = client.get(f"{BASE}/users/{someone_else}/{suffix}")
        assert response.status_code == 403, suffix


def test_session_belonging_to_another_learner_is_refused(client, db_session, me, someone_else):
    session_id = f"theirs-{uuid.uuid4()}"
    _metric(db_session, someone_else, session_id)

    _as(me)
    assert client.get(f"{BASE}/sessions/{session_id}/feedback").status_code == 403
    assert client.get(f"{BASE}/sessions/{session_id}/report").status_code == 403
    # The session filter on a learner's own trends is checked too.
    response = client.get(f"{BASE}/users/{me}/progress-trends", params={"session_id": session_id})
    assert response.status_code == 403


def test_own_session_is_allowed(client, db_session, me):
    session_id = f"mine-{uuid.uuid4()}"
    _metric(db_session, me, session_id)

    _as(me)
    assert client.get(f"{BASE}/sessions/{session_id}/session-metrics").status_code == 200


def test_stored_row_of_another_learner_reads_as_missing(client, db_session, me, someone_else):
    theirs = _metric(db_session, someone_else, f"s-{uuid.uuid4()}")
    mine = _metric(db_session, me, f"s-{uuid.uuid4()}")

    _as(me)
    assert client.get(f"{BASE}/session-metrics/{theirs.id}").status_code == 404
    assert client.get(f"{BASE}/session-metrics/{mine.id}").status_code == 200


def test_cannot_write_under_another_learners_name(client, me, someone_else):
    _as(me)
    response = client.post(
        f"{BASE}/session-metrics",
        json={"user_id": someone_else, "session_id": f"s-{uuid.uuid4()}", "overall_score": 50},
    )
    assert response.status_code == 403


def test_cannot_write_into_another_learners_session(client, db_session, me, someone_else):
    """Doing so would also lock the owner out of their own session."""
    session_id = f"theirs-{uuid.uuid4()}"
    _metric(db_session, someone_else, session_id)

    _as(me)
    response = client.post(
        f"{BASE}/session-metrics",
        json={"user_id": me, "session_id": session_id, "overall_score": 50},
    )
    assert response.status_code == 403
