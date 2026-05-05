"""
APM Analytics Writer — side-effect writes to the shared analytics tables.

All three public functions:
  - are gated behind the APM_WRITE_ANALYTICS config flag
  - are idempotent: they check for an existing (user_id, session_id) record
    before inserting; duplicate calls for the same session are silent no-ops
  - never raise: all exceptions are caught and logged at WARNING level

These are synchronous DB writes. They can be called directly from async
orchestrator code without wrapping in run_in_executor.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.config import get_settings
from app.contracts.rpe import FeedbackResponse
from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry, SkillPrediction
from app.models.training_plan import TrainingPlan

logger = logging.getLogger(__name__)

_RATING_MAP = {
    "excellent": 90.0,
    "good": 70.0,
    "fair": 50.0,
    "poor": 30.0,
}
_SENTIMENT_MAP = {
    "success": "positive",
    "partial": "neutral",
    "failure": "negative",
}


def _analytics_enabled() -> bool:
    return get_settings().apm_write_analytics


def write_session_metrics(fb: FeedbackResponse, db: Session) -> None:
    """
    Write one AnalyticsSessionMetric row for the session (turn-level averages).

    Field mapping (TurnMetric → AnalyticsSessionMetric):
      assertiveness_score → confidence_score  (assertiveness is the closest proxy)
      clarity_score       → clarity_score
      empathy_score       → empathy_score
      response_quality    → response_quality_score
      overall_score       = mean of the four above
    """
    if not _analytics_enabled():
        return
    try:
        existing = (
            db.query(AnalyticsSessionMetric)
            .filter(
                AnalyticsSessionMetric.user_id == fb.user_id,
                AnalyticsSessionMetric.session_id == fb.session_id,
            )
            .first()
        )
        if existing is not None:
            return

        metrics = fb.turn_metrics
        if metrics:
            assertiveness = sum(t.assertiveness_score for t in metrics) / len(metrics)
            clarity = sum(t.clarity_score for t in metrics) / len(metrics)
            empathy = sum(t.empathy_score for t in metrics) / len(metrics)
            rq = sum(t.response_quality for t in metrics) / len(metrics)
            overall = (assertiveness + clarity + empathy + rq) / 4.0
            # Scale 0-1 → 0-100 to match CHECK constraint
            def s(v: float) -> float:
                return round(min(100.0, max(0.0, v * 100.0)), 2)
            row = AnalyticsSessionMetric(
                user_id=fb.user_id,
                session_id=fb.session_id,
                scenario_id=fb.scenario_id,
                confidence_score=s(assertiveness),
                clarity_score=s(clarity),
                empathy_score=s(empathy),
                response_quality_score=s(rq),
                overall_score=s(overall),
                created_at=datetime.now(timezone.utc),
            )
        else:
            row = AnalyticsSessionMetric(
                user_id=fb.user_id,
                session_id=fb.session_id,
                scenario_id=fb.scenario_id,
                created_at=datetime.now(timezone.utc),
            )

        db.add(row)
        db.commit()
    except Exception:
        db.rollback()
        logger.warning(
            "analytics write_session_metrics failed for session %s", fb.session_id,
            exc_info=True,
        )


def write_feedback_entries(fb: FeedbackResponse, db: Session) -> None:
    """
    Write system FeedbackEntry rows from coaching advice and blind spots.

    Idempotent: skips if any system entry exists for this (user_id, session_id).
    """
    if not _analytics_enabled():
        return
    try:
        existing = (
            db.query(FeedbackEntry)
            .filter(
                FeedbackEntry.user_id == fb.user_id,
                FeedbackEntry.session_id == fb.session_id,
                FeedbackEntry.feedback_type == "system",
            )
            .first()
        )
        if existing is not None:
            return

        outcome_lower = (fb.outcome or "partial").lower()
        sentiment = _SENTIMENT_MAP.get(outcome_lower, "neutral")
        advice = fb.coaching_advice

        rating_raw = _RATING_MAP.get(advice.overall_rating.lower(), 50.0)
        summary_entry = FeedbackEntry(
            user_id=fb.user_id,
            session_id=fb.session_id,
            feedback_type="system",
            skill_area=fb.scenario_id,
            rating=rating_raw,
            comment=advice.summary,
            sentiment=sentiment,
            created_at=datetime.now(timezone.utc),
        )
        db.add(summary_entry)

        for spot in fb.blind_spots:
            db.add(
                FeedbackEntry(
                    user_id=fb.user_id,
                    session_id=fb.session_id,
                    feedback_type="system",
                    skill_area=spot.blind_spot_type,
                    comment=spot.recommendation,
                    sentiment="negative",
                    created_at=datetime.now(timezone.utc),
                )
            )

        db.commit()
    except Exception:
        db.rollback()
        logger.warning(
            "analytics write_feedback_entries failed for session %s", fb.session_id,
            exc_info=True,
        )


def write_skill_predictions(
    user_id: str, plan: TrainingPlan, db: Session
) -> None:
    """
    Write one SkillPrediction row per target skill found in the primary scenario.

    Uses plan difficulty as a proxy for predicted score (higher difficulty →
    higher expected skill floor). Idempotent per (user_id, predicted_skill).
    """
    if not _analytics_enabled():
        return
    try:
        scenario: dict = plan.primary_scenario_json or {}
        target_skills: list[str] = scenario.get("target_skills") or []
        if not target_skills:
            return

        for skill in target_skills:
            existing = (
                db.query(SkillPrediction)
                .filter(
                    SkillPrediction.user_id == user_id,
                    SkillPrediction.predicted_skill == skill,
                )
                .order_by(SkillPrediction.created_at.desc())
                .first()
            )
            # difficulty 1-10 → floor score 20-80 (linear)
            predicted = round(20.0 + (plan.difficulty - 1) * (60.0 / 9.0), 1)

            if existing is not None:
                trend: Optional[str]
                if predicted > (existing.predicted_score or 0):
                    trend = "improving"
                elif predicted < (existing.predicted_score or 0):
                    trend = "declining"
                else:
                    trend = "stable"
            else:
                trend = "stable"

            risk = (
                "high" if plan.difficulty <= 3
                else "low" if plan.difficulty >= 8
                else "medium"
            )

            db.add(
                SkillPrediction(
                    user_id=user_id,
                    predicted_skill=skill,
                    predicted_score=predicted,
                    trend_label=trend,
                    risk_level=risk,
                    recommendation=f"Focus on {skill} at {plan.skill} difficulty {plan.difficulty}/10",
                    model_version="rule-based-v1",
                    created_at=datetime.now(timezone.utc),
                )
            )

        db.commit()
    except Exception:
        db.rollback()
        logger.warning(
            "analytics write_skill_predictions failed for user %s", user_id,
            exc_info=True,
        )
