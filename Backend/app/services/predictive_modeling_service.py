from datetime import datetime

from sqlalchemy.orm import Session

from app.schemas.analytics import (
    PredictiveModelingItem,
    PredictiveModelingResult,
    PredictiveModelingSummary,
    SkillTrendItem,
)
from app.services import progress_trend_service


MODEL_VERSION = "rule-based-baseline-v1"
MIN_SCORE = 0.0
MAX_SCORE = 100.0


def predict_user_skill_outcomes(
    db: Session,
    user_id: str,
    limit: int = 100,
) -> PredictiveModelingResult:
    trend_result = progress_trend_service.analyze_user_progress_trends(db, user_id, limit)
    predictions = [
        _prediction_from_trend(trend)
        for trend in trend_result.trends
        if trend.session_count >= 2 and trend.latest_score is not None
    ]

    return PredictiveModelingResult(
        user_id=user_id,
        predictions=predictions,
        summary=_summarize(predictions),
        generated_at=datetime.utcnow(),
        model_version=MODEL_VERSION,
    )


def predict_user_skill_outcome(
    db: Session,
    user_id: str,
    skill_area: str,
    limit: int = 100,
) -> PredictiveModelingItem:
    trend = progress_trend_service.analyze_user_skill_trend(db, user_id, skill_area, limit)
    return _prediction_from_trend(trend)


def _prediction_from_trend(trend: SkillTrendItem) -> PredictiveModelingItem:
    if trend.session_count < 2 or trend.latest_score is None:
        return PredictiveModelingItem(
            predicted_skill=trend.skill_area,
            current_score=trend.latest_score,
            predicted_score=None,
            trend_label=trend.trend_label,
            risk_level="medium",
            confidence=0.2,
            evidence_points=trend.session_count,
            recommendation=f"Collect more sessions before predicting {trend.skill_area}.",
        )

    slope = trend.slope or 0.0
    predicted_score = _clamp(round(trend.latest_score + slope, 2))
    risk_level = _risk_level(predicted_score, trend.trend_label, slope)

    return PredictiveModelingItem(
        predicted_skill=trend.skill_area,
        current_score=trend.latest_score,
        predicted_score=predicted_score,
        trend_label=trend.trend_label,
        risk_level=risk_level,
        confidence=_confidence(trend.session_count, trend.trend_label),
        evidence_points=trend.session_count,
        recommendation=_recommendation(trend.skill_area, risk_level, trend.trend_label),
    )


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
