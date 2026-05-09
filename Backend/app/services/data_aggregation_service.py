from collections import Counter
from datetime import datetime
from statistics import mean

from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry, SkillPrediction
from app.schemas.analytics import (
    AnalyticsAggregateSummary,
    DataCompletenessSummary,
    FeedbackSummary,
    PredictionSummary,
    ScoreSummary,
)


SCORE_FIELDS = [
    "confidence_score",
    "clarity_score",
    "empathy_score",
    "listening_score",
    "adaptability_score",
    "emotional_control_score",
    "professionalism_score",
    "eye_contact_score",
    "speech_pace_score",
    "speech_volume_score",
    "response_quality_score",
    "overall_score",
]


def get_session_aggregate(db: Session, session_id: str) -> AnalyticsAggregateSummary:
    metrics = _query_metrics(db).filter(AnalyticsSessionMetric.session_id == session_id).all()
    feedback = _query_feedback(db).filter(FeedbackEntry.session_id == session_id).all()
    predictions = _query_predictions(db).filter(SkillPrediction.session_id == session_id).all()

    user_id = _resolve_user_id(metrics, feedback, predictions)
    return _build_summary(
        scope="session",
        user_id=user_id,
        session_id=session_id,
        metrics=metrics,
        feedback=feedback,
        predictions=predictions,
    )


def get_user_aggregate(db: Session, user_id: str, limit: int = 100) -> AnalyticsAggregateSummary:
    metrics = (
        _query_metrics(db)
        .filter(AnalyticsSessionMetric.user_id == user_id)
        .limit(limit)
        .all()
    )
    feedback = (
        _query_feedback(db)
        .filter(FeedbackEntry.user_id == user_id)
        .limit(limit)
        .all()
    )
    predictions = (
        _query_predictions(db)
        .filter(SkillPrediction.user_id == user_id)
        .limit(limit)
        .all()
    )

    return _build_summary(
        scope="user",
        user_id=user_id,
        session_id=None,
        metrics=metrics,
        feedback=feedback,
        predictions=predictions,
    )


def _query_metrics(db: Session):
    return db.query(AnalyticsSessionMetric).order_by(AnalyticsSessionMetric.created_at.desc())


def _query_feedback(db: Session):
    return db.query(FeedbackEntry).order_by(FeedbackEntry.created_at.desc())


def _query_predictions(db: Session):
    return db.query(SkillPrediction).order_by(SkillPrediction.created_at.desc())


def _build_summary(
    *,
    scope: str,
    user_id: str | None,
    session_id: str | None,
    metrics: list[AnalyticsSessionMetric],
    feedback: list[FeedbackEntry],
    predictions: list[SkillPrediction],
) -> AnalyticsAggregateSummary:
    return AnalyticsAggregateSummary(
        scope=scope,
        user_id=user_id,
        session_id=session_id,
        scores=_summarize_scores(metrics),
        feedback=_summarize_feedback(feedback),
        predictions=_summarize_predictions(predictions),
        data_completeness=DataCompletenessSummary(
            has_session_metrics=bool(metrics),
            has_feedback=bool(feedback),
            has_predictions=bool(predictions),
        ),
        generated_at=datetime.utcnow(),
    )


def _summarize_scores(metrics: list[AnalyticsSessionMetric]) -> ScoreSummary:
    averages = {}
    for field in SCORE_FIELDS:
        values = [getattr(metric, field) for metric in metrics if getattr(metric, field) is not None]
        if values:
            averages[field] = round(mean(values), 2)

    latest = metrics[0] if metrics else None
    return ScoreSummary(
        metric_count=len(metrics),
        averages=averages,
        latest=latest,
    )


def _summarize_feedback(feedback: list[FeedbackEntry]) -> FeedbackSummary:
    ratings = [entry.rating for entry in feedback if entry.rating is not None]
    return FeedbackSummary(
        total_count=len(feedback),
        by_type=dict(Counter(entry.feedback_type for entry in feedback)),
        sentiment_counts=dict(Counter(entry.sentiment for entry in feedback if entry.sentiment)),
        average_rating=round(mean(ratings), 2) if ratings else None,
        latest_entries=feedback[:5],
    )


def _summarize_predictions(predictions: list[SkillPrediction]) -> PredictionSummary:
    return PredictionSummary(
        total_count=len(predictions),
        risk_counts=dict(Counter(prediction.risk_level for prediction in predictions)),
        trend_counts=dict(Counter(prediction.trend_label for prediction in predictions if prediction.trend_label)),
        latest_predictions=predictions[:5],
    )


def _resolve_user_id(
    metrics: list[AnalyticsSessionMetric],
    feedback: list[FeedbackEntry],
    predictions: list[SkillPrediction],
) -> str | None:
    for collection in (metrics, feedback, predictions):
        if collection:
            return collection[0].user_id
    return None
