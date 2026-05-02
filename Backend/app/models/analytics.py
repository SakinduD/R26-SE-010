from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AnalyticsSessionMetric(Base):
    __tablename__ = "analytics_session_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    scenario_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    skill_type: Mapped[str | None] = mapped_column(String(80), nullable=True)

    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    clarity_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    empathy_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    listening_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    adaptability_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    emotional_control_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    professionalism_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    eye_contact_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    speech_pace_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    speech_volume_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    response_quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100",
            name="ck_analytics_confidence_score_range",
        ),
        CheckConstraint(
            "clarity_score IS NULL OR clarity_score BETWEEN 0 AND 100",
            name="ck_analytics_clarity_score_range",
        ),
        CheckConstraint(
            "empathy_score IS NULL OR empathy_score BETWEEN 0 AND 100",
            name="ck_analytics_empathy_score_range",
        ),
        CheckConstraint(
            "overall_score IS NULL OR overall_score BETWEEN 0 AND 100",
            name="ck_analytics_overall_score_range",
        ),
        Index("ix_analytics_metrics_user_session", "user_id", "session_id"),
    )


class FeedbackEntry(Base):
    __tablename__ = "feedback_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    feedback_type: Mapped[str] = mapped_column(String(20), nullable=False)
    skill_area: Mapped[str | None] = mapped_column(String(80), nullable=True)
    rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    sentiment: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "feedback_type IN ('self', 'peer', 'system', 'mentor')",
            name="ck_feedback_entries_type",
        ),
        CheckConstraint(
            "rating IS NULL OR rating BETWEEN 0 AND 100",
            name="ck_feedback_entries_rating_range",
        ),
        CheckConstraint(
            "sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')",
            name="ck_feedback_entries_sentiment",
        ),
        Index("ix_feedback_entries_user_session", "user_id", "session_id"),
    )


class SkillPrediction(Base):
    __tablename__ = "skill_predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    predicted_skill: Mapped[str] = mapped_column(String(80), nullable=False)
    predicted_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    trend_label: Mapped[str | None] = mapped_column(String(20), nullable=True)
    risk_level: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")
    recommendation: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_version: Mapped[str] = mapped_column(String(40), nullable=False, default="rule-based-v1")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "predicted_score IS NULL OR predicted_score BETWEEN 0 AND 100",
            name="ck_skill_predictions_predicted_score_range",
        ),
        CheckConstraint(
            "current_score IS NULL OR current_score BETWEEN 0 AND 100",
            name="ck_skill_predictions_current_score_range",
        ),
        CheckConstraint(
            "trend_label IS NULL OR trend_label IN ('improving', 'stable', 'declining')",
            name="ck_skill_predictions_trend_label",
        ),
        CheckConstraint(
            "risk_level IN ('low', 'medium', 'high')",
            name="ck_skill_predictions_risk_level",
        ),
        Index("ix_skill_predictions_user_skill", "user_id", "predicted_skill"),
    )
