from datetime import datetime

from sqlalchemy.orm import Session

from app.models.analytics import FeedbackEntry
from app.schemas.analytics import (
    PredictiveModelingItem,
    PredictiveModelingResult,
    PredictiveModelingSummary,
    SkillTrendItem,
)
from app.services import ml_predictive_model_service, progress_trend_service


MODEL_VERSION = "rule-based-baseline-v1"
ML_MODEL_VERSION = "ml-predictive-behavioral-analytics-v1"
MIN_SCORE = 0.0
MAX_SCORE = 100.0
MAX_NEXT_SESSION_DELTA = 15.0
LOW_EVIDENCE_MAX_DELTA = 10.0
SENTIMENT_VALUES = {"positive": 1.0, "neutral": 0.0, "negative": -1.0}


def predict_user_skill_outcomes(
    db: Session,
    user_id: str,
    limit: int = 100,
) -> PredictiveModelingResult:
    trend_result = progress_trend_service.analyze_user_progress_trends(db, user_id, limit)
    predictions: list[PredictiveModelingItem] = []
    used_ml_model = False

    for trend in trend_result.trends:
        if trend.session_count < 2 or trend.latest_score is None:
            continue
        prediction, source = _prediction_from_trend(db, user_id, trend)
        predictions.append(prediction)
        used_ml_model = used_ml_model or source == "ml"

    return PredictiveModelingResult(
        user_id=user_id,
        predictions=predictions,
        summary=_summarize(predictions),
        generated_at=datetime.utcnow(),
        model_version=ML_MODEL_VERSION if used_ml_model else MODEL_VERSION,
    )


def predict_user_skill_outcome(
    db: Session,
    user_id: str,
    skill_area: str,
    limit: int = 100,
) -> PredictiveModelingItem:
    trend = progress_trend_service.analyze_user_skill_trend(db, user_id, skill_area, limit)
    prediction, _source = _prediction_from_trend(db, user_id, trend)
    return prediction


def _prediction_from_trend(
    db: Session,
    user_id: str,
    trend: SkillTrendItem,
) -> tuple[PredictiveModelingItem, str]:
    if trend.session_count < 2 or trend.latest_score is None:
        return (
            PredictiveModelingItem(
                predicted_skill=trend.skill_area,
                current_score=trend.latest_score,
                predicted_score=None,
                trend_label=trend.trend_label,
                risk_level="medium",
                confidence=0.2,
                evidence_points=trend.session_count,
                recommendation=f"Collect more sessions before predicting {trend.skill_area}.",
            ),
            "rule",
        )

    ml_prediction = _try_ml_prediction(db, user_id, trend)
    if ml_prediction is not None:
        predicted_score = _calibrate_ml_predicted_score(
            raw_prediction=ml_prediction["predicted_score"],
            trend=trend,
        )
        risk_level = _combined_risk_level(
            model_risk=ml_prediction["risk_level"],
            predicted_score=predicted_score,
            trend_label=trend.trend_label,
            slope=trend.slope or 0.0,
        )
        return (
            PredictiveModelingItem(
                predicted_skill=trend.skill_area,
                current_score=trend.latest_score,
                predicted_score=predicted_score,
                trend_label=trend.trend_label,
                risk_level=risk_level,
                confidence=ml_prediction["confidence"],
                evidence_points=trend.session_count,
                recommendation=_recommendation(trend.skill_area, risk_level, trend.trend_label),
            ),
            "ml",
        )

    slope = trend.slope or 0.0
    predicted_score = _bounded_next_score(
        current_score=trend.latest_score,
        proposed_score=trend.latest_score + slope,
        evidence_points=trend.session_count,
    )
    risk_level = _risk_level(predicted_score, trend.trend_label, slope)

    return (
        PredictiveModelingItem(
            predicted_skill=trend.skill_area,
            current_score=trend.latest_score,
            predicted_score=predicted_score,
            trend_label=trend.trend_label,
            risk_level=risk_level,
            confidence=_confidence(trend.session_count, trend.trend_label),
            evidence_points=trend.session_count,
            recommendation=_recommendation(trend.skill_area, risk_level, trend.trend_label),
        ),
        "rule",
    )


def _try_ml_prediction(
    db: Session,
    user_id: str,
    trend: SkillTrendItem,
) -> dict | None:
    features = _build_ml_features(db, user_id, trend)
    if features is None:
        return None

    try:
        return ml_predictive_model_service.predict_behavioral_outcome(features)
    except ml_predictive_model_service.PredictiveModelUnavailableError:
        return None


def _build_ml_features(
    db: Session,
    user_id: str,
    trend: SkillTrendItem,
) -> dict[str, float] | None:
    feedback_entries = _query_relevant_feedback(db, user_id, trend.skill_area)
    if not feedback_entries:
        return None

    ratings = [entry.rating for entry in feedback_entries if entry.rating is not None]
    sentiment_scores = [
        SENTIMENT_VALUES[entry.sentiment]
        for entry in feedback_entries
        if entry.sentiment in SENTIMENT_VALUES
    ]
    if not ratings and not sentiment_scores:
        return None

    previous_score = trend.points[-2].score if len(trend.points) >= 2 else trend.latest_score
    average_feedback_rating = sum(ratings) / len(ratings) if ratings else trend.latest_score
    sentiment_score = sum(sentiment_scores) / len(sentiment_scores) if sentiment_scores else 0.0
    blind_spot_count = sum(1 for entry in feedback_entries if entry.feedback_type in {"self", "peer"} and entry.rating)
    engagement_score = _clamp(45 + (trend.session_count * 6) + (len(feedback_entries) * 3))

    return {
        "current_score": trend.latest_score or 0.0,
        "previous_score": previous_score or trend.latest_score or 0.0,
        "trend_slope": trend.slope or 0.0,
        "average_feedback_rating": average_feedback_rating,
        "sentiment_score": sentiment_score,
        "blind_spot_count": float(min(blind_spot_count, 5)),
        "session_count": float(trend.session_count),
        "engagement_score": engagement_score,
    }


def _query_relevant_feedback(
    db: Session,
    user_id: str,
    skill_area: str,
) -> list[FeedbackEntry]:
    normalized_skill = _normalize_skill_area(skill_area)
    feedback_entries = (
        db.query(FeedbackEntry)
        .filter(FeedbackEntry.user_id == user_id)
        .order_by(FeedbackEntry.created_at.asc(), FeedbackEntry.id.asc())
        .all()
    )
    return [
        entry
        for entry in feedback_entries
        if entry.skill_area is None
        or _normalize_skill_area(entry.skill_area) in {normalized_skill, "overall"}
        or normalized_skill == "overall"
    ]


def _summarize(predictions: list[PredictiveModelingItem]) -> PredictiveModelingSummary:
    return PredictiveModelingSummary(
        predicted_count=len(predictions),
        low_risk_count=sum(1 for item in predictions if item.risk_level == "low"),
        medium_risk_count=sum(1 for item in predictions if item.risk_level == "medium"),
        high_risk_count=sum(1 for item in predictions if item.risk_level == "high"),
        highest_risk_prediction=_highest_risk(predictions),
    )


def _highest_risk(predictions: list[PredictiveModelingItem]) -> PredictiveModelingItem | None:
    risk_rank = {"high": 3, "medium": 2, "low": 1}
    return max(
        predictions,
        key=lambda item: (risk_rank[item.risk_level], -(item.predicted_score or 0)),
        default=None,
    )


def _risk_level(predicted_score: float, trend_label: str, slope: float) -> str:
    if predicted_score < 50 or (trend_label == "declining" and slope <= -8):
        return "high"
    if predicted_score < 70 or trend_label == "declining":
        return "medium"
    return "low"


def _combined_risk_level(
    *,
    model_risk: str,
    predicted_score: float,
    trend_label: str,
    slope: float,
) -> str:
    calibrated_risk = _risk_level(predicted_score, trend_label, slope)
    risk_rank = {"low": 1, "medium": 2, "high": 3}
    ranked_risks = {value: key for key, value in risk_rank.items()}
    return ranked_risks[max(risk_rank.get(model_risk, 2), risk_rank[calibrated_risk])]


def _calibrate_ml_predicted_score(
    *,
    raw_prediction: float,
    trend: SkillTrendItem,
) -> float:
    current_score = trend.latest_score or 0.0
    trend_projection = current_score + (trend.slope or 0.0)
    ml_weight = _ml_weight(trend.session_count)
    blended_score = (raw_prediction * ml_weight) + (trend_projection * (1 - ml_weight))
    return _bounded_next_score(
        current_score=current_score,
        proposed_score=blended_score,
        evidence_points=trend.session_count,
    )


def _ml_weight(evidence_points: int) -> float:
    # Keep the live forecast stable when there are only a few feedback sessions.
    return min(0.55, 0.25 + (max(evidence_points, 0) * 0.05))


def _bounded_next_score(
    *,
    current_score: float,
    proposed_score: float,
    evidence_points: int,
) -> float:
    max_delta = _max_allowed_delta(evidence_points)
    lower_bound = current_score - max_delta
    upper_bound = current_score + max_delta
    return round(_clamp(max(lower_bound, min(upper_bound, proposed_score))), 2)


def _max_allowed_delta(evidence_points: int) -> float:
    if evidence_points < 4:
        return LOW_EVIDENCE_MAX_DELTA
    return MAX_NEXT_SESSION_DELTA


def _confidence(session_count: int, trend_label: str) -> float:
    base = min(0.85, 0.35 + (session_count * 0.1))
    if trend_label == "stable":
        base -= 0.05
    return round(max(0.2, base), 2)


def _recommendation(skill_area: str, risk_level: str, trend_label: str) -> str:
    if risk_level == "high":
        return f"{skill_area} is at high risk. Assign focused practice before the next session."
    if risk_level == "medium":
        return f"{skill_area} needs monitoring. Use targeted feedback to prevent decline."
    if trend_label == "improving":
        return f"{skill_area} is predicted to improve. Continue the current strategy."
    return f"{skill_area} is low risk. Maintain consistent practice."


def _clamp(value: float) -> float:
    return max(MIN_SCORE, min(MAX_SCORE, value))


def _normalize_skill_area(skill_area: str) -> str:
    return skill_area.strip().lower().replace(" ", "_").replace("-", "_")
