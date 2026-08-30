"""
MCA Session lifecycle endpoints.

POST /api/v1/mca/sessions/start   → creates and returns a new SessionResult (active)
POST /api/v1/mca/sessions/{id}/end → closes the session and persists results
GET  /api/v1/mca/sessions/        → lists the current user's sessions (paginated)
"""
import uuid
import random
import string
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.auth import get_current_user
from app.models.session_result import SessionResult
from app.models.user import User
from app.api.v1.mca.scoring import calculate_session_metrics
from app.services.mca_live_scorer import mca_live_scorer

router = APIRouter()

def generate_friendly_id(mode: str) -> str:
    """Generate a human-readable session ID: MCA-MODE-YYYYMMDD-XXXX"""
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    random_str = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"MCA-{mode.upper()}-{date_str}-{random_str}"


# Request / Response Schemas

class SessionStartRequest(BaseModel):
    mode: Literal["live", "ai"] = "live"


class NudgeEntry(BaseModel):
    message: str
    category: str
    severity: str
    timestamp: Optional[str] = None
    elapsed_seconds: Optional[float] = None  # seconds since session start (live mode)


class TranscriptSegment(BaseModel):
    text: str
    elapsed_seconds: float = 0.0


class SessionEndRequest(BaseModel):
    nudge_log: list[NudgeEntry] = []
    result_data: Optional[dict[str, Any]] = None
    chat_turns: Optional[int] = None  # AI-mode only
    emotion_distribution: Optional[dict[str, float]] = None
    mechanical_averages: Optional[dict[str, float]] = None
    # Live-mode only: transcribed speech used for LLM-based scoring.
    user_transcript: list[TranscriptSegment] = []
    meeting_transcript: list[TranscriptSegment] = []


class SessionResponse(BaseModel):
    id: str
    user_id: str
    mode: str
    status: str
    started_at: str
    ended_at: Optional[str] = None
    duration_seconds: Optional[int] = None
    chat_turns: Optional[int] = None
    nudge_log: Optional[list[dict]] = None
    overall_score: Optional[int] = None
    dominant_emotion: Optional[str] = None
    emotion_distribution: Optional[dict[str, Any]] = None
    nudge_summary: Optional[dict[str, Any]] = None
    skill_scores: Optional[dict[str, Any]] = None
    score_diagnostics: Optional[dict[str, Any]] = None
    mechanical_averages: Optional[dict[str, Any]] = None
    friendly_id: Optional[str] = None

    @classmethod
    def from_orm(cls, session: SessionResult) -> "SessionResponse":
        return cls(
            id=str(session.id),
            user_id=str(session.user_id),
            mode=session.session_type,
            status=session.status,
            started_at=session.started_at.isoformat(),
            ended_at=session.ended_at.isoformat() if session.ended_at else None,
            duration_seconds=session.duration_seconds,
            nudge_log=session.nudge_log,
            chat_turns=session.chat_turns,
            overall_score=session.overall_score,
            dominant_emotion=session.dominant_emotion,
            emotion_distribution=session.emotion_distribution,
            nudge_summary=session.nudge_summary,
            skill_scores=session.skill_scores,
            score_diagnostics=session.score_diagnostics,
            mechanical_averages=session.mechanical_averages,
            friendly_id=session.friendly_id,
        )


# Endpoints

@router.post("/start", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def start_session(
    body: SessionStartRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Start a new MCA session for the authenticated user.
    Returns the created session including its UUID which the client should
    pass to all subsequent audio/chat calls via the `session_id` query param.
    """
    session = SessionResult(
        user_id=current_user.id,
        session_type=body.mode,
        status="active",
        friendly_id=generate_friendly_id(body.mode),
        started_at=datetime.now(timezone.utc),
    )
    try:
        db.add(session)
        db.commit()
        db.refresh(session)
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create session: {exc}",
        )
    return SessionResponse.from_orm(session)


@router.post("/{session_id}/end", response_model=SessionResponse)
def end_session(
    session_id: uuid.UUID,
    body: SessionEndRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    End an active MCA session.  Persists the nudge log, aggregated result data,
    and computes duration. Only the owning user can end their own session.
    """
    session: Optional[SessionResult] = db.get(SessionResult, session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    if session.status != "active":
        raise HTTPException(
            status_code=400, detail=f"Session is already '{session.status}'"
        )

    now = datetime.now(timezone.utc)
    session.ended_at = now
    session.status = "completed"
    
    started = session.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    session.duration_seconds = int((now - started).total_seconds())
    session.nudge_log = [n.model_dump() for n in body.nudge_log]
    
    # Calculate nudge_summary
    nudge_summary = {"Critical": 0, "Warning": 0, "Info": 0}
    for n in body.nudge_log:
        sev = n.severity.capitalize()
        if sev in nudge_summary:
            nudge_summary[sev] += 1
        else:
            nudge_summary[sev] = 1
    session.nudge_summary = nudge_summary

    session.emotion_distribution = body.emotion_distribution or {}
    session.mechanical_averages = body.mechanical_averages or {}
    
    # Calculate multi-skill scores. This rule-based pass always runs — it's
    # the AI-baseline scoring method, and doubles as the live-mode fallback
    # plus the source of `diagnostics` even when the LLM path below succeeds.
    metrics = calculate_session_metrics(
        session.nudge_log,
        session.emotion_distribution,
        duration_seconds=session.duration_seconds
    )

    if session.session_type == "live":
        llm_result = mca_live_scorer.score(
            nudge_log=session.nudge_log,
            user_transcript=[t.model_dump() for t in body.user_transcript],
            meeting_transcript=[t.model_dump() for t in body.meeting_transcript],
            duration_seconds=session.duration_seconds,
        )
        if llm_result is not None:
            metrics["overall"] = llm_result["overall"]
            metrics["breakdown"] = llm_result["breakdown"]
            metrics["diagnostics"]["scoring_method"] = "llm"
            metrics["diagnostics"]["llm_rationale"] = llm_result["rationale"]
        else:
            metrics["diagnostics"]["scoring_method"] = "rule_based_fallback"
    else:
        metrics["diagnostics"]["scoring_method"] = "rule_based"

    session.overall_score = metrics["overall"]
    session.skill_scores = metrics["breakdown"]
    session.score_diagnostics = metrics["diagnostics"]
    
    # Determine dominant emotion
    if session.emotion_distribution:
        session.dominant_emotion = max(session.emotion_distribution.items(), key=lambda x: x[1])[0]

    if body.chat_turns is not None:
        session.chat_turns = body.chat_turns

    try:
        db.commit()
        db.refresh(session)
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save session results: {exc}",
        )
    return SessionResponse.from_orm(session)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def discard_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Discard an active MCA session without persisting any results.

    Only "active" sessions can be discarded.
    """
    session: Optional[SessionResult] = db.get(SessionResult, session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    if session.status != "active":
        raise HTTPException(
            status_code=400,
            detail=f"Only active sessions can be discarded (status is '{session.status}')",
        )

    try:
        db.delete(session)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to discard session: {exc}",
        )
    return None


@router.get("/", response_model=list[SessionResponse])
def list_sessions(
    limit: int = 20,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the authenticated user's MCA sessions, newest first (paginated)."""
    sessions = (
        db.query(SessionResult)
        .filter(SessionResult.user_id == current_user.id)
        .order_by(SessionResult.started_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return [SessionResponse.from_orm(s) for s in sessions]


@router.get("/me", response_model=list[SessionResponse])
def get_my_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all MCA sessions for the currently authenticated user, newest first."""
    sessions = (
        db.query(SessionResult)
        .filter(SessionResult.user_id == current_user.id)
        .order_by(SessionResult.started_at.desc())
        .all()
    )
    return [SessionResponse.from_orm(s) for s in sessions]

@router.get("/{session_id}", response_model=SessionResponse)
def get_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a single MCA session by ID, if it belongs to the authenticated user."""
    session: Optional[SessionResult] = db.get(SessionResult, session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    return SessionResponse.from_orm(session)
