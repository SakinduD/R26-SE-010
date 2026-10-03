"""Shared fixtures for MCA integration tests (real app, real router, SQLite test DB)."""
import uuid
from datetime import datetime, timezone

import pytest

from app.core.auth import get_current_user
from app.main import app
from app.models.user import User


@pytest.fixture
def make_user(db_session):
    """Create a persisted user. Each test gets fresh users, so rate limits never leak between tests."""
    def _make(prefix: str = "mca") -> User:
        uid = uuid.uuid4()
        now = datetime.now(timezone.utc)
        user = User(id=uid, email=f"{prefix}_{uid.hex[:8]}@mca.local", created_at=now, updated_at=now)
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        db_session.expunge(user)
        return user
    return _make


@pytest.fixture
def api(client, db_session):
    """Call /api/v1<path> as `user`; pass user=None to call without authentication."""
    def _call(user, method: str, path: str, **kwargs):
        if user is not None:
            app.dependency_overrides[get_current_user] = lambda: db_session.get(User, user.id)
        try:
            return getattr(client, method)(f"/api/v1{path}", **kwargs)
        finally:
            app.dependency_overrides.pop(get_current_user, None)
    return _call


@pytest.fixture
def start_session(api):
    """Start a session for `user` and return its JSON."""
    def _start(user, mode: str = "ai") -> dict:
        resp = api(user, "post", "/mca/sessions/start", json={"mode": mode})
        assert resp.status_code == 201, resp.text
        return resp.json()
    return _start
