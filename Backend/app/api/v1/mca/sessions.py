"""
MCA Session lifecycle endpoints.

POST /api/v1/mca/sessions/start   → creates and returns a new SessionResult (active)
POST /api/v1/mca/sessions/{id}/end → closes the session and persists results
GET  /api/v1/mca/sessions/        → lists the current user's sessions (paginated)
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.auth import get_current_user
from app.models.session_result import SessionResult
from app.models.user import User
from app.api.v1.mca.scoring import calculate_overall_score

router = APIRouter()


# Request / Response Schemas

class SessionStartRequest(BaseModel):
    mode: Literal["live", "ai"] = "live"


class NudgeEntry(BaseModel):
    message: str
    category: str
    severity: str
    timestamp: Optional[str] = None


class SessionEndRequest(BaseModel):
    nudge_log: list[NudgeEntry] = []
    result_data: Optional[dict[str, Any]] = None
    chat_turns: Optional[int] = None  # AI-mode only
    emotion_distribution: Optional[dict[str, float]] = None
    mechanical_averages: Optional[dict[str, float]] = None


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
    mechanical_averages: Optional[dict[str, Any]] = None

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
            mechanical_averages=session.mechanical_averages,
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
        started_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
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
    session.duration_seconds = int((now - session.started_at).total_seconds())
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
    
    # Calculate overall score
    session.overall_score = calculate_overall_score(
        nudge_summary, 
        session.emotion_distribution,
        duration_seconds=session.duration_seconds
    )
    
    # Determine dominant emotion
    if session.emotion_distribution:
        session.dominant_emotion = max(session.emotion_distribution.items(), key=lambda x: x[1])[0]

    if body.chat_turns is not None:
        session.chat_turns = body.chat_turns

    db.commit()
    db.refresh(session)
    return SessionResponse.from_orm(session)


@router.get("/", response_model=list[SessionResponse])
def list_sessions(
    limit: int = 20,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the authenticated user's MCA sessions, newest first."""
    sessions = (
        db.query(SessionResult)
        .filter(SessionResult.user_id == current_user.id)
        .order_by(SessionResult.started_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return [SessionResponse.from_orm(s) for s in sessions]
