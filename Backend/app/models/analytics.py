from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, Float, Index, Integer, String, Text, JSON, Enum, UniqueConstraint
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

    # The sentiment attributed to this entry. For human-written feedback this is
    # the NLP model's reading; for system-generated entries it is rule-derived.
    sentiment: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # What the author said about themselves, kept separate so the two can be
    # compared — a learner who writes something critical but marks it positive is
    # a blind spot the ratings alone would miss.
    declared_sentiment: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sentiment_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 'model' | 'rule' | 'declared' — makes it answerable at a glance which
    # entries the NLP module actually judged.
    sentiment_source: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    sentiment_model_version: Mapped[str | None] = mapped_column(String(60), nullable=True)

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
        CheckConstraint(
            "declared_sentiment IS NULL OR declared_sentiment IN ('positive', 'neutral', 'negative')",
            name="ck_feedback_entries_declared_sentiment",
        ),
        CheckConstraint(
            "sentiment_source IS NULL OR sentiment_source IN ('model', 'rule', 'declared')",
            name="ck_feedback_entries_sentiment_source",
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


class MentoringRecommendation(Base):
    __tablename__ = "mentoring_recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    recommendation_type: Mapped[str] = mapped_column(Enum('session_specific', 'overall_user', name='recommendation_type_enum'), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str] = mapped_column(Enum('high', 'medium', 'low', name='recommendation_priority_enum'), nullable=False, default="medium")
    skill_area: Mapped[str | None] = mapped_column(String(80), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    evidence: Mapped[dict] = mapped_column(JSON, nullable=True)  # Store supporting evidence
    source: Mapped[str] = mapped_column(Enum('llm', 'rule_based', 'cached', name='recommendation_source_enum'), nullable=False, default="llm")
    model_version: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_mentoring_recommendations_user_session", "user_id", "session_id"),
        Index("ix_mentoring_recommendations_user_type", "user_id", "recommendation_type"),
    )


class UserGamificationProfile(Base):
    """Running gamification state for one learner.

    One row per user. Everything here is derived from analytics data, so the row
    can always be rebuilt from scratch by replaying the user's sessions — it is a
    cache for fast reads, never the source of truth.
    """

    __tablename__ = "user_gamification_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    total_xp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    current_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    longest_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_learning_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_activity_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    session_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # {skill_area: xp} for the four tracked soft-skill dimensions.
    skill_xp: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Session ids already awarded XP, so replaying an integration never double-counts.
    scored_session_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    rules_version: Mapped[str] = mapped_column(String(40), nullable=False, default="gamification-rules-v1")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    __table_args__ = (
        CheckConstraint("total_xp >= 0", name="ck_gamification_total_xp_non_negative"),
        CheckConstraint("level >= 1", name="ck_gamification_level_min"),
        CheckConstraint("current_streak >= 0", name="ck_gamification_current_streak_non_negative"),
        CheckConstraint("longest_streak >= 0", name="ck_gamification_longest_streak_non_negative"),
    )


class UserBadge(Base):
    """An unlocked achievement badge.

    A row only exists once the badge rule has been satisfied; locked badges are
    computed on read so the criteria stay in one place (gamification_service).
    """

    __tablename__ = "user_badges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    badge_key: Mapped[str] = mapped_column(String(64), nullable=False)
    badge_tier: Mapped[str] = mapped_column(String(20), nullable=False, default="bronze")
    skill_area: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Human-readable snapshot of why it unlocked — keeps the award explainable.
    criteria: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[dict] = mapped_column(JSON, nullable=True)
    rules_version: Mapped[str] = mapped_column(String(40), nullable=False, default="gamification-rules-v1")
    earned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "badge_key", name="uq_user_badges_user_badge"),
        CheckConstraint(
            "badge_tier IN ('bronze', 'silver', 'gold')",
            name="ck_user_badges_tier",
        ),
        Index("ix_user_badges_user_earned", "user_id", "earned_at"),
    )
