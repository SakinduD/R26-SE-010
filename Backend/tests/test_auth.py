"""
Critical-path tests for the auth endpoints.

Supabase calls are mocked so the suite runs without real credentials.
JWT verification uses a real HS256 encode/decode cycle with a test secret.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt

# ── helpers ──────────────────────────────────────────────────────────────────

TEST_JWT_SECRET = "test-secret-do-not-use-in-production"
TEST_USER_ID = str(uuid.uuid4())
TEST_EMAIL = "auth_test@example.com"
TEST_PASSWORD = "securepass123"


def _make_token(
    sub: str = TEST_USER_ID,
    email: str = TEST_EMAIL,
    exp: int = 9_999_999_999,  # far future
    aud: str = "authenticated",
    secret: str = TEST_JWT_SECRET,
) -> str:
    return jwt.encode(
        {"sub": sub, "email": email, "role": "authenticated", "exp": exp, "aud": aud},
        secret,
        algorithm="HS256",
    )


def _make_supabase_session(user_id: str = TEST_USER_ID, email: str = TEST_EMAIL) -> MagicMock:
    """Build a minimal mock that matches the Supabase session shape our code reads."""
    user = MagicMock()
    user.id = user_id
    user.email = email

    session = MagicMock()
    session.access_token = _make_token(sub=user_id, email=email)
    session.refresh_token = "mock-refresh-token"
    session.expires_in = 3600

    result = MagicMock()
    result.user = user
    result.session = session
    return result


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_jwt_secret(monkeypatch):
    """Override the JWT secret so verify_jwt works with our test tokens."""
    from app import config as cfg

    original = cfg.get_settings
    mock_settings = MagicMock()
    mock_settings.supabase_jwt_secret = TEST_JWT_SECRET
    mock_settings.supabase_url = "https://test.supabase.co"
    mock_settings.supabase_anon_key = "anon-key"
    mock_settings.supabase_service_role_key = "service-key"
    mock_settings.app_name = "test-app"
    mock_settings.app_env = "test"
    mock_settings.database_url = "sqlite:///./test.db"
    mock_settings.gemini_api_key = ""
    mock_settings.debug = False

    monkeypatch.setattr(cfg, "get_settings", lambda: mock_settings)

    # Also patch the cached instance used in auth.py
    import app.core.auth as auth_mod
    monkeypatch.setattr(auth_mod, "get_settings", lambda: mock_settings)


# ── signup ─────────────────────────────────────────────────────────────────────

@patch("app.api.v1.auth.get_supabase_admin_client")
@patch("app.api.v1.auth.get_supabase_client")
def test_signup_creates_user_in_db(mock_anon, mock_admin, client: TestClient):
    uid = str(uuid.uuid4())
    email = f"signup_{uid[:8]}@example.com"

    # Admin client: create_user
    admin_result = MagicMock()
    admin_result.user.id = uid
    mock_admin.return_value.auth.admin.create_user.return_value = admin_result

    # Anon client: sign_in_with_password (auto sign-in after signup)
    mock_anon.return_value.auth.sign_in_with_password.return_value = (
        _make_supabase_session(user_id=uid, email=email)
    )

    resp = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": TEST_PASSWORD, "display_name": "Tester"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["email"] == email
    assert data["token_type"] == "bearer"


# ── signin ─────────────────────────────────────────────────────────────────────

@patch("app.api.v1.auth.get_supabase_client")
def test_signin_returns_valid_tokens(mock_anon, client: TestClient):
    uid = str(uuid.uuid4())
    email = f"signin_{uid[:8]}@example.com"
    mock_anon.return_value.auth.sign_in_with_password.return_value = (
        _make_supabase_session(user_id=uid, email=email)
    )

    resp = client.post(
        "/api/v1/auth/signin",
        json={"email": email, "password": TEST_PASSWORD},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


# ── /me ────────────────────────────────────────────────────────────────────────

def test_me_with_valid_token_returns_user(client: TestClient):
    uid = str(uuid.uuid4())
    email = f"me_{uid[:8]}@example.com"
    token = _make_token(sub=uid, email=email)

    resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == email
    assert data["id"] == uid


def test_me_without_token_returns_401(client: TestClient):
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401


def test_me_with_invalid_token_returns_401(client: TestClient):
    resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer this.is.not.a.valid.token"},
    )
    assert resp.status_code == 401


def test_me_with_expired_token_returns_401(client: TestClient):
    expired_token = _make_token(exp=1)  # Unix epoch 1 = long expired
    resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert resp.status_code == 401
