"""
Auth endpoints — backend-mediated Supabase Auth flow.

Supabase owns credentials and issues JWTs; this layer proxies the auth calls
and keeps our users table in sync. Passwords are never stored here.
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.auth import get_current_user
from app.core.supabase_client import get_supabase_admin_client, get_supabase_client
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    PasswordResetRequest,
    RefreshTokenRequest,
    SignInRequest,
    SignUpRequest,
    UserResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _build_auth_response(session_data, user: User) -> AuthResponse:
    """Convert a Supabase session object into our AuthResponse schema."""
    return AuthResponse(
        access_token=session_data.access_token,
        refresh_token=session_data.refresh_token,
        token_type="bearer",
        expires_in=session_data.expires_in,
        user=UserResponse.model_validate(user),
    )


@router.post("/signup", status_code=status.HTTP_201_CREATED, response_model=AuthResponse)
def signup(body: SignUpRequest, db: Session = Depends(get_db)) -> AuthResponse:
    """Create a new account via Supabase Auth and mirror the profile in our DB."""
    admin = get_supabase_admin_client()

    # Create the Supabase auth user
    try:
        result = admin.auth.admin.create_user(
            {
                "email": body.email,
                "password": body.password,
                "email_confirm": True,  # skip email verification for backend-created users
            }
        )
    except Exception as exc:
        logger.warning("Supabase signup failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Signup failed: " + str(exc)
        )

    auth_user = result.user
    user_id = uuid.UUID(auth_user.id)

    # Create matching row in our users table
    user = User(
        id=user_id,
        email=body.email,
        display_name=body.display_name,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    try:
        db.add(user)
        db.commit()
        db.refresh(user)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to persist user after Supabase signup: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User created in auth but profile save failed",
        )

    # Sign in immediately to return tokens
    try:
        session_result = get_supabase_client().auth.sign_in_with_password(
            {"email": body.email, "password": body.password}
        )
    except Exception as exc:
        logger.error("Auto sign-in after signup failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Account created but auto sign-in failed — please sign in manually",
        )

    return _build_auth_response(session_result.session, user)


@router.post("/signin", status_code=status.HTTP_200_OK, response_model=AuthResponse)
def signin(body: SignInRequest, db: Session = Depends(get_db)) -> AuthResponse:
    """Sign in with email and password, return Supabase JWT tokens."""
    try:
        result = get_supabase_client().auth.sign_in_with_password(
            {"email": body.email, "password": body.password}
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    session = result.session
    auth_user = result.user
    user_id = uuid.UUID(auth_user.id)

    # Sync user row (auto-create if first sign-in after manual Supabase setup)
    user = db.get(User, user_id)
    if user is None:
        user = User(
            id=user_id,
            email=auth_user.email,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        try:
            db.add(user)
            db.commit()
            db.refresh(user)
        except Exception as exc:
            db.rollback()
            logger.error("Failed to sync user on signin: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Auth succeeded but profile sync failed",
            )

    return _build_auth_response(session, user)


@router.post("/refresh", status_code=status.HTTP_200_OK, response_model=AuthResponse)
def refresh_token(body: RefreshTokenRequest, db: Session = Depends(get_db)) -> AuthResponse:
    """Exchange a refresh token for a new access token."""
    try:
        result = get_supabase_client().auth.refresh_session(body.refresh_token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token"
        )

    session = result.session
    auth_user = result.user
    user_id = uuid.UUID(auth_user.id)

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User profile not found"
        )

    return _build_auth_response(session, user)


@router.post("/signout", status_code=status.HTTP_204_NO_CONTENT)
def signout(
    response: Response,
    current_user: User = Depends(get_current_user),
) -> None:
    """Invalidate the current session in Supabase."""
    try:
        get_supabase_client().auth.sign_out()
    except Exception as exc:
        logger.warning("Supabase sign-out error (non-fatal): %s", exc)


@router.post("/password-reset", status_code=status.HTTP_200_OK)
def password_reset(body: PasswordResetRequest) -> dict[str, str]:
    """Send a password-reset email. Always returns 200 to avoid email enumeration."""
    try:
        get_supabase_client().auth.reset_password_email(body.email)
    except Exception as exc:
        # Log but don't reveal whether the email exists
        logger.warning("Password reset request error (suppressed): %s", exc)
    return {"message": "If that email is registered, a password-reset link has been sent."}


@router.get("/me", status_code=status.HTTP_200_OK, response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """Return the authenticated user's profile."""
    return UserResponse.model_validate(current_user)
