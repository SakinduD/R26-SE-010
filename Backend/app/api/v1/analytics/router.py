from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.schemas.analytics import (
    AnalyticsSessionMetricCreate,
    AnalyticsSessionMetricRead,
    FeedbackEntryCreate,
    FeedbackEntryRead,
    AnalyticsAggregateSummary,
    SkillPredictionCreate,
    SkillPredictionRead,
    SkillScoreRequest,
    SkillScoreResult,
)
from app.services import analytics_service, data_aggregation_service, skill_scoring_service

router = APIRouter(tags=["feedback-analytics"])


@router.post(
    "/session-metrics",
    response_model=AnalyticsSessionMetricRead,
    status_code=status.HTTP_201_CREATED,
)
def create_session_metric(
    payload: AnalyticsSessionMetricCreate,
    db: Session = Depends(get_db),
):
    return analytics_service.create_session_metric(db, payload)


@router.get("/session-metrics/{metric_id}", response_model=AnalyticsSessionMetricRead)
def get_session_metric(metric_id: int, db: Session = Depends(get_db)):
    metric = analytics_service.get_session_metric(db, metric_id)
    if metric is None:
        raise HTTPException(status_code=404, detail="Session metric not found")
    return metric


@router.get(
    "/users/{user_id}/session-metrics",
    response_model=list[AnalyticsSessionMetricRead],
)
def list_user_session_metrics(
    user_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return analytics_service.list_session_metrics_by_user(db, user_id, limit)


@router.get(
    "/sessions/{session_id}/session-metrics",
    response_model=list[AnalyticsSessionMetricRead],
)
def list_session_metrics(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return analytics_service.list_session_metrics_by_session(db, session_id, limit)


@router.post(
    "/feedback",
    response_model=FeedbackEntryRead,
    status_code=status.HTTP_201_CREATED,
)
def create_feedback_entry(
    payload: FeedbackEntryCreate,
    db: Session = Depends(get_db),
):
    return analytics_service.create_feedback_entry(db, payload)


@router.get("/feedback/{feedback_id}", response_model=FeedbackEntryRead)
def get_feedback_entry(feedback_id: int, db: Session = Depends(get_db)):
    feedback = analytics_service.get_feedback_entry(db, feedback_id)
    if feedback is None:
        raise HTTPException(status_code=404, detail="Feedback entry not found")
    return feedback


@router.get("/users/{user_id}/feedback", response_model=list[FeedbackEntryRead])
def list_user_feedback(
    user_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return analytics_service.list_feedback_by_user(db, user_id, limit)


@router.get("/sessions/{session_id}/feedback", response_model=list[FeedbackEntryRead])
def list_session_feedback(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return analytics_service.list_feedback_by_session(db, session_id, limit)


@router.post(
    "/predictions",
    response_model=SkillPredictionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_skill_prediction(
    payload: SkillPredictionCreate,
    db: Session = Depends(get_db),
):
    return analytics_service.create_skill_prediction(db, payload)


@router.get("/predictions/{prediction_id}", response_model=SkillPredictionRead)
def get_skill_prediction(prediction_id: int, db: Session = Depends(get_db)):
    prediction = analytics_service.get_skill_prediction(db, prediction_id)
    if prediction is None:
        raise HTTPException(status_code=404, detail="Skill prediction not found")
    return prediction


@router.get("/users/{user_id}/predictions", response_model=list[SkillPredictionRead])
def list_user_predictions(
    user_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return analytics_service.list_predictions_by_user(db, user_id, limit)


@router.get("/sessions/{session_id}/predictions", response_model=list[SkillPredictionRead])
def list_session_predictions(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return analytics_service.list_predictions_by_session(db, session_id, limit)


@router.get(
    "/sessions/{session_id}/aggregate",
    response_model=AnalyticsAggregateSummary,
)
def get_session_aggregate(session_id: str, db: Session = Depends(get_db)):
    return data_aggregation_service.get_session_aggregate(db, session_id)


@router.get(
    "/users/{user_id}/aggregate",
    response_model=AnalyticsAggregateSummary,
)
def get_user_aggregate(
    user_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return data_aggregation_service.get_user_aggregate(db, user_id, limit)


@router.post(
    "/skill-scores/calculate",
    response_model=SkillScoreResult,
)
def calculate_skill_scores(payload: SkillScoreRequest):
    return skill_scoring_service.calculate_skill_scores(payload)


@router.get(
    "/sessions/{session_id}/skill-scores",
    response_model=SkillScoreResult,
)
def get_session_skill_scores(session_id: str, db: Session = Depends(get_db)):
    return skill_scoring_service.calculate_session_skill_scores(db, session_id)
