"""Who may read and write which learner's analytics.

Every route in this module used to depend on get_db alone. Anyone who knew or
guessed a learner id could read that learner's scores, feedback, reflections and
forecasts, and write rows under their name. The other components already turned
anonymous callers away; this one did not.

Authenticating alone would not have closed it. A signed-in learner could still
put somebody else's id in the URL, so every learner id, session id and stored row
is also checked against the caller.

It is one dependency on purpose. The router depends on it, so a route added
later is authenticated without anyone remembering to; and tests that exercise
the analytics logic with made-up learner ids can swap it for one that allows
everything, without switching the checks off anywhere else.
"""
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.auth import get_current_user
from app.models.analytics import (
    AnalyticsSessionMetric,
    FeedbackEntry,
    MentoringRecommendation,
    SkillPrediction,
)
from app.models.session_result import SessionResult
from app.models.user import User

_FORBIDDEN = "You do not have access to this learner's analytics."

# Every table here that ties a session id to a learner.
_SESSION_OWNER_TABLES = (
    AnalyticsSessionMetric,
    FeedbackEntry,
    SkillPrediction,
    MentoringRecommendation,
)


class AnalyticsAccess:
    def __init__(self, user: User, db: Session):
        self.user = user
        self.db = db
        self.user_id = str(user.id)

    def require_user(self, user_id: str | None) -> None:
        if user_id != self.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_FORBIDDEN)

    def require_session(self, session_id: str | None) -> None:
        """Refuse a session that belongs to anyone but the caller.

        A session nobody owns yet is allowed through: no stored row ties it to
        anyone, so there is nothing of anyone's to see. Every owner has to be the
        caller, not just one of them - a session id carried by rows for two
        learners would otherwise hand the caller the other learner's rows.
        """
        if not session_id:
            return
        owners = session_owners(self.db, session_id)
        if owners and owners != {self.user_id}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_FORBIDDEN)

    def require_row(self, row, detail: str) -> None:
        """404 rather than 403, so ids cannot be walked to learn which exist."""
        if row is None or row.user_id != self.user_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def session_owners(db: Session, session_id: str) -> set[str]:
    owners: set[str] = set()
    try:
        row = db.query(SessionResult.user_id).filter(SessionResult.id == session_id).first()
        if row and row[0]:
            owners.add(str(row[0]))
    except Exception:
        # A role-play or made-up id is not a UUID, and comparing one against
        # a uuid column raises rather than matching nothing.
        db.rollback()

    for model in _SESSION_OWNER_TABLES:
        rows = db.query(model.user_id).filter(model.session_id == session_id).distinct()
        owners.update(str(user_id) for (user_id,) in rows if user_id)
    return owners


def get_analytics_access(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnalyticsAccess:
    return AnalyticsAccess(current_user, db)


def require_own_user(
    user_id: str,
    access: AnalyticsAccess = Depends(get_analytics_access),
) -> None:
    access.require_user(user_id)


def require_own_session(
    session_id: str,
    access: AnalyticsAccess = Depends(get_analytics_access),
) -> None:
    access.require_session(session_id)
