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


# Only text a person actually wrote is worth putting through the sentiment
# model. 'system' and 'mentor' entries are templates this codebase generates and
# already labels by rule, so classifying them would replace a known-correct label
# with a guess about our own wording.
HUMAN_AUTHORED_FEEDBACK_TYPES = {"self", "peer"}

MIN_ANALYSABLE_COMMENT_LENGTH = 4


def create_feedback_entry(db: Session, payload: FeedbackEntryCreate) -> FeedbackEntry:
    """Store one feedback entry, reading its sentiment where there is text to read.

    Two sentiments are kept apart on purpose. ``declared_sentiment`` is what the
    author said about their own feedback; ``sentiment`` is what the NLP model read
    in the words themselves. Keeping only one of them would either discard the
    learner's self-perception or discard the objective 2 analysis — and the gap
    between the two is itself a signal worth surfacing.
    """
    feedback_data = payload.model_dump()
    comment = (feedback_data.get("comment") or "").strip()
    feedback_type = feedback_data.get("feedback_type")

    analysable = (
        feedback_type in HUMAN_AUTHORED_FEEDBACK_TYPES
        and len(comment) >= MIN_ANALYSABLE_COMMENT_LENGTH
    )

    if analysable:
        # Whatever sentiment the caller supplied is the author's own view; the
        # model's reading is computed independently and takes the main field.
        feedback_data.setdefault("declared_sentiment", None)
        if feedback_data.get("declared_sentiment") is None:
            feedback_data["declared_sentiment"] = feedback_data.get("sentiment")

        reading = _read_sentiment(comment)
        if reading is not None:
            feedback_data["sentiment"] = reading.sentiment
            feedback_data["sentiment_confidence"] = reading.confidence
            feedback_data["sentiment_model_version"] = reading.model_version
            feedback_data["sentiment_source"] = "model"
        else:
            # Model unavailable — fall back to the author's own view rather than
            # storing nothing, and say so.
            feedback_data["sentiment"] = feedback_data.get("declared_sentiment")
            feedback_data["sentiment_source"] = (
                "declared" if feedback_data["sentiment"] else None
            )
    elif feedback_data.get("sentiment") is not None:
        # Generated entries carry a rule-derived label from their producer.
        feedback_data["sentiment_source"] = "rule"

    feedback = FeedbackEntry(**feedback_data)
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return feedback


def _read_sentiment(comment: str):
    """The model's independent reading of the text, or None if it cannot run."""
    try:
        return sentiment_analysis_service.analyze_feedback_text(comment)
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
