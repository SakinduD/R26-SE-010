"""
JWT verification and FastAPI user dependencies.

Newer Supabase projects issue ES256 JWTs (asymmetric ECDSA), not HS256.
We fetch the public JWKS once from Supabase's well-known endpoint, match
the key by kid, and verify locally. Signature + expiry are fully checked.

Dependency hierarchy:
  get_current_user         → raises 401 if unauthenticated
  get_current_user_optional → returns None if unauthenticated (public endpoints)
"""
import logging
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Optional

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.config import get_settings
from app.models.user import User

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


class TokenPayload(BaseModel):
    sub: str
    email: Optional[str] = None
    role: str = "authenticated"
    exp: int
    aud: Optional[str] = None

    model_config = {"extra": "ignore"}  # ignore aal, amr, session_id, is_anonymous, etc.


@lru_cache(maxsize=1)
def _get_jwks() -> list[dict]:
    """Fetch and cache Supabase's public JWKS. Called once per process lifetime."""
    url = f"{get_settings().supabase_url}/auth/v1/.well-known/jwks.json"
    with httpx.Client(timeout=10) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.json()["keys"]


def verify_jwt(token: str) -> TokenPayload:
    """Decode and validate a Supabase-issued JWT using the JWKS public key."""
    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    kid = header.get("kid")
    alg = header.get("alg", "ES256")

    try:
        keys = _get_jwks()
    except Exception as exc:
        logger.error("Failed to fetch Supabase JWKS: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth service unavailable",
        )

    # Match by kid; fall back to first key if kid not found
    key = next((k for k in keys if k.get("kid") == kid), keys[0] if keys else None)
    if key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No signing key found")

    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=[alg],
            options={"verify_aud": False},
        )
    except ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except JWTError as exc:
        logger.debug("JWT decode failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    token_data = TokenPayload(**payload)

    if token_data.role != "authenticated":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token role")

    if token_data.email is None:
        token_data.email = (payload.get("user_metadata") or {}).get("email", "")

    return token_data


def _sync_user(db: Session, payload: TokenPayload) -> User:
    """Return the User row for this JWT, auto-creating it on first login."""
    user_id = uuid.UUID(payload.sub)
    user = db.get(User, user_id)
    if user is None:
        user = User(
            id=user_id,
            email=payload.email or "",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        try:
            db.add(user)
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create user profile",
            )
    return user


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency — requires a valid Bearer token. Raises 401 otherwise."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = verify_jwt(credentials.credentials)
    return _sync_user(db, payload)


def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """FastAPI dependency — returns None when no token is present (public endpoints)."""
    if credentials is None:
        return None
    payload = verify_jwt(credentials.credentials)
    return _sync_user(db, payload)
