from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry, SkillPrediction
from app.schemas.analytics import (
    AnalyticsSessionMetricCreate,
    FeedbackEntryCreate,
    SkillPredictionCreate,
)
from app.services import sentiment_analysis_service


def create_session_metric(
    db: Session,
    payload: AnalyticsSessionMetricCreate,
) -> AnalyticsSessionMetric:
    metric = AnalyticsSessionMetric(**payload.model_dump())
    db.add(metric)
    db.commit()
    db.refresh(metric)
    return metric


def get_session_metric(db: Session, metric_id: int) -> AnalyticsSessionMetric | None:
    return db.get(AnalyticsSessionMetric, metric_id)


def list_session_metrics_by_user(
    db: Session,
    user_id: str,
    limit: int = 50,
) -> list[AnalyticsSessionMetric]:
    return (
        db.query(AnalyticsSessionMetric)
        .filter(AnalyticsSessionMetric.user_id == user_id)
        .order_by(AnalyticsSessionMetric.created_at.desc())
        .limit(limit)
        .all()
    )


def list_session_metrics_by_session(
    db: Session,
    session_id: str,
    limit: int = 50,
) -> list[AnalyticsSessionMetric]:
    return (
        db.query(AnalyticsSessionMetric)
        .filter(AnalyticsSessionMetric.session_id == session_id)
        .order_by(AnalyticsSessionMetric.created_at.desc())
        .limit(limit)
        .all()
    )


def create_feedback_entry(db: Session, payload: FeedbackEntryCreate) -> FeedbackEntry:
    feedback_data = payload.model_dump()
    if feedback_data.get("sentiment") is None and feedback_data.get("comment"):
        feedback_data["sentiment"] = _infer_feedback_sentiment(feedback_data["comment"])

    feedback = FeedbackEntry(**feedback_data)
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return feedback


def _infer_feedback_sentiment(comment: str) -> str | None:
    try:
        return sentiment_analysis_service.analyze_feedback_text(comment).sentiment
    except sentiment_analysis_service.SentimentModelUnavailableError:
        return None


def get_feedback_entry(db: Session, feedback_id: int) -> FeedbackEntry | None:
    return db.get(FeedbackEntry, feedback_id)


def list_feedback_by_user(
    db: Session,
    user_id: str,
    limit: int = 50,
) -> list[FeedbackEntry]:
    return (
        db.query(FeedbackEntry)
        .filter(FeedbackEntry.user_id == user_id)
        .order_by(FeedbackEntry.created_at.desc())
        .limit(limit)
        .all()
    )


def list_feedback_by_session(
    db: Session,
    session_id: str,
    limit: int = 50,
) -> list[FeedbackEntry]:
    return (
        db.query(FeedbackEntry)
        .filter(FeedbackEntry.session_id == session_id)
        .order_by(FeedbackEntry.created_at.desc())
        .limit(limit)
        .all()
    )


def create_skill_prediction(
    db: Session,
    payload: SkillPredictionCreate,
) -> SkillPrediction:
    prediction = SkillPrediction(**payload.model_dump())
    db.add(prediction)
    db.commit()
    db.refresh(prediction)
    return prediction


def get_skill_prediction(db: Session, prediction_id: int) -> SkillPrediction | None:
    return db.get(SkillPrediction, prediction_id)


def list_predictions_by_user(
    db: Session,
    user_id: str,
    limit: int = 50,
) -> list[SkillPrediction]:
    return (
        db.query(SkillPrediction)
        .filter(SkillPrediction.user_id == user_id)
        .order_by(SkillPrediction.created_at.desc())
        .limit(limit)
        .all()
    )


def list_predictions_by_session(
    db: Session,
    session_id: str,
    limit: int = 50,
) -> list[SkillPrediction]:
    return (
        db.query(SkillPrediction)
        .filter(SkillPrediction.session_id == session_id)
        .order_by(SkillPrediction.created_at.desc())
        .limit(limit)
        .all()
    )
