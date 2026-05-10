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
    self_entries = [entry for entry in feedback if entry.feedback_type == "self"]

    skill_rating_averages = {}
    self_rating_averages = {}
    skill_areas = sorted({entry.skill_area for entry in feedback if entry.skill_area})
    for skill_area in skill_areas:
        skill_ratings = [
            entry.rating
            for entry in feedback
            if entry.skill_area == skill_area and entry.rating is not None
        ]
        if skill_ratings:
            skill_rating_averages[skill_area] = round(mean(skill_ratings), 2)

        self_skill_ratings = [
            entry.rating
            for entry in self_entries
            if entry.skill_area == skill_area and entry.rating is not None
        ]
        if self_skill_ratings:
            self_rating_averages[skill_area] = round(mean(self_skill_ratings), 2)

    # Calculate weighted average for overall rating if MCA skills are present
    mca_weights = {
        "emotional_intelligence": 0.30,
        "presence_engagement": 0.30,
        "vocal_command": 0.20,
        "speech_fluency": 0.20
    }

    total_weight = 0.0
    weighted_sum = 0.0
    for skill, weight in mca_weights.items():
        if skill in skill_rating_averages:
            weighted_sum += skill_rating_averages[skill] * weight
            total_weight += weight

    if total_weight > 0:
        average_rating = round(weighted_sum / total_weight, 2)
    else:
        average_rating = round(mean(ratings), 2) if ratings else None

    return FeedbackSummary(
        total_count=len(feedback),
        session_count=len({entry.session_id for entry in feedback if entry.session_id}),
        by_type=dict(Counter(entry.feedback_type for entry in feedback)),
        sentiment_counts=dict(Counter(entry.sentiment for entry in feedback if entry.sentiment)),
        skill_rating_averages=skill_rating_averages,
        self_rating_averages=self_rating_averages,
        average_rating=average_rating,
        latest_entries=feedback[:20],
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
