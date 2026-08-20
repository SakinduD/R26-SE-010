from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
import logging

from app.api.dependencies import get_db
from app.models.analytics import MentoringRecommendation
from app.schemas.analytics import (
    AnalyticsSessionMetricCreate,
    AnalyticsSessionMetricRead,
    BlindSpotDetectionResult,
    FeedbackEntryCreate,
    FeedbackEntryRead,
    FeedbackAnalysisResult,
    FeedbackSentimentRequest,
    FeedbackSentimentResult,
    AnalyticsAggregateSummary,
    AnalyticsComponentIntegrationRequest,
    AnalyticsFeedbackLoopResult,
    AnalyticsSessionIntegrationResult,
    GamificationProfileResult,
    LearnerHistorySummary,
    RecurringBlindSpotResult,
    SessionBackfillResult,
    GamificationSyncResult,
    MentoringRecommendationItem,
    MentoringRecommendationResult,
    PostSessionReportResult,
    ProgressTrendResult,
    PredictiveModelingItem,
    PredictiveModelingResult,
    SkillTrendItem,
    SkillPredictionCreate,
    SkillPredictionRead,
    SkillScoreRequest,
    SkillScoreResult,
)
from app.services import (
    analytics_service,
    analytics_feedback_loop_service,
    analytics_integration_service,
    blind_spot_service,
    data_aggregation_service,
    feedback_analysis_service,
    gamification_service,
    llm_mentoring_service,
    post_session_report_service,
    predictive_modeling_service,
    progress_trend_service,
    sentiment_analysis_service,
    learner_history_service,
    session_backfill_service,
    skill_scoring_service,
)

router = APIRouter(tags=["feedback-analytics"])
logger = logging.getLogger(__name__)


@router.post(
    "/integrations/session-complete",
    response_model=AnalyticsSessionIntegrationResult,
    status_code=status.HTTP_201_CREATED,
)
def integrate_completed_session_analytics(
    payload: AnalyticsComponentIntegrationRequest,
    db: Session = Depends(get_db),
):
    return analytics_integration_service.integrate_component_session_data(db, payload)


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
    "/feedback/sentiment",
    response_model=FeedbackSentimentResult,
)
def analyze_feedback_sentiment(payload: FeedbackSentimentRequest):
    try:
        return sentiment_analysis_service.analyze_feedback_text(payload.text)
    except sentiment_analysis_service.SentimentModelUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


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
    "/sessions/{session_id}/report",
    response_model=PostSessionReportResult,
)
def get_post_session_report(session_id: str, db: Session = Depends(get_db)):
    return post_session_report_service.generate_session_report(db, session_id)


@router.get(
    "/users/{user_id}/aggregate",
    response_model=AnalyticsAggregateSummary,
)
def get_user_aggregate(
    user_id: str,
    limit: int = Query(
        default=data_aggregation_service.FULL_HISTORY_LIMIT,
        ge=1,
        le=data_aggregation_service.FULL_HISTORY_LIMIT,
    ),
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


@router.get(
    "/sessions/{session_id}/feedback-analysis",
    response_model=FeedbackAnalysisResult,
)
def get_session_feedback_analysis(session_id: str, db: Session = Depends(get_db)):
    return feedback_analysis_service.analyze_session_feedback(db, session_id)


@router.get(
    "/users/{user_id}/feedback-analysis",
    response_model=FeedbackAnalysisResult,
)
def get_user_feedback_analysis(
    user_id: str,
    limit: int = Query(
        default=feedback_analysis_service.FULL_HISTORY_LIMIT,
        ge=1,
        le=feedback_analysis_service.FULL_HISTORY_LIMIT,
    ),
    db: Session = Depends(get_db),
):
    return feedback_analysis_service.analyze_user_feedback(db, user_id, limit)


@router.get(
    "/sessions/{session_id}/blind-spots",
    response_model=BlindSpotDetectionResult,
)
def get_session_blind_spots(session_id: str, db: Session = Depends(get_db)):
    return blind_spot_service.detect_session_blind_spots(db, session_id)


@router.get(
    "/users/{user_id}/blind-spots",
    response_model=BlindSpotDetectionResult,
)
def get_user_blind_spots(
    user_id: str,
    limit: int = Query(
        default=blind_spot_service.FULL_HISTORY_LIMIT,
        ge=1,
        le=blind_spot_service.FULL_HISTORY_LIMIT,
    ),
    db: Session = Depends(get_db),
):
    return blind_spot_service.detect_user_blind_spots(db, user_id, limit)


@router.get(
    "/users/{user_id}/progress-trends",
    response_model=ProgressTrendResult,
)
def get_user_progress_trends(
    user_id: str,
    session_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return progress_trend_service.analyze_user_progress_trends(db, user_id, session_id)


@router.get(
    "/users/{user_id}/progress-trends/{skill_area}",
    response_model=SkillTrendItem,
)
def get_user_skill_progress_trend(
    user_id: str,
    skill_area: str,
    session_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return progress_trend_service.analyze_user_skill_trend(db, user_id, skill_area, session_id=session_id)


@router.get(
    "/users/{user_id}/predicted-outcomes",
    response_model=PredictiveModelingResult,
)
def get_user_predicted_outcomes(
    user_id: str,
    session_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return predictive_modeling_service.predict_user_skill_outcomes(db, user_id, session_id)


@router.get(
    "/users/{user_id}/predicted-outcomes/{skill_area}",
    response_model=PredictiveModelingItem,
)
def get_user_skill_predicted_outcome(
    user_id: str,
    skill_area: str,
    session_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return predictive_modeling_service.predict_user_skill_outcome(db, user_id, skill_area, session_id)


@router.post(
    "/users/{user_id}/backfill-sessions",
    response_model=SessionBackfillResult,
)
def backfill_user_sessions(user_id: str, db: Session = Depends(get_db)):
    """Pull every completed session that has no analytics into the module.

    Reads the role-play and multimodal tables directly, so a session is recorded
    whether or not anyone opened an analytics page while it was running.
    Idempotent — sessions that already have metrics are skipped.
    """
    try:
        return session_backfill_service.backfill_user_sessions(db, user_id)
    except Exception as exc:
        logger.error("Session backfill failed for user %s: %s", user_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to backfill sessions: {exc}") from exc


@router.get(
    "/users/{user_id}/skill-history",
    response_model=LearnerHistorySummary,
)
def get_learner_skill_history(user_id: str, db: Session = Depends(get_db)):
    """Every skill across the learner's whole history.

    Answers the questions the "All Sessions" view actually asks, which the
    per-session panels cannot: where am I now versus where I started, what is my
    best, and how much do I vary between sessions. Latest and average are both
    returned because either alone misleads - one is a single session, the other
    hides which way the learner is moving.
    """
    return learner_history_service.summarise_skill_history(db, user_id)


@router.get(
    "/users/{user_id}/recurring-blind-spots",
    response_model=RecurringBlindSpotResult,
)
def get_recurring_blind_spots(user_id: str, db: Session = Depends(get_db)):
    """Self-assessment gaps counted across sessions, not averaged over them.

    Averaging cannot tell a habit from a bad day, and worse, it cancels: a
    learner who is 20 points high one session and 20 low the next averages to
    zero and reads as perfectly self-aware. Counting keeps both facts - how often
    they were wrong, and whether they were wrong in a consistent direction.
    """
    return learner_history_service.detect_recurring_blind_spots(db, user_id)


@router.post(
    "/sessions/{session_id}/integrate",
    response_model=SessionBackfillResult,
)
def integrate_session(session_id: str, db: Session = Depends(get_db)):
    """Fold one just-finished session into analytics, reading it from the database.

    The session-end hook used to assemble this payload in the browser from half a
    dozen component endpoints. Any one of them failing — or the learner simply
    navigating away before they all returned — left the session with no analytics
    at all, so its scores never reached the dashboard, the trend lines or the
    predictions.

    Here the server reads the session it already stored. One call, one id, no
    assembly, and idempotent: a session that already has metrics is skipped.
    """
    owner = session_backfill_service.resolve_session_owner(db, session_id)
    if not owner:
        raise HTTPException(status_code=404, detail=f"No session found with id {session_id}")
    try:
        return session_backfill_service.backfill_user_sessions(
            db, owner, session_id=session_id
        )
    except Exception as exc:
        logger.error("Integration failed for session %s: %s", session_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to integrate session: {exc}") from exc


@router.get(
    "/users/{user_id}/learner-profile-signal",
    response_model=AnalyticsFeedbackLoopResult,
)
def get_learner_profile_signal(user_id: str, db: Session = Depends(get_db)):
    """The longitudinal learner profile analytics hands to the pedagogy engine.

    Read-only. The pedagogy module pulls the same signal when it composes a plan;
    exposing it here lets the learner see what their history currently says
    before they regenerate.
    """
    signal = analytics_feedback_loop_service.build_learner_profile_signal(db, user_id)
    return AnalyticsFeedbackLoopResult(
        user_id=user_id,
        signal=signal,
        loop_version=analytics_feedback_loop_service.LOOP_VERSION,
        generated_at=datetime.utcnow(),
    )


@router.get(
    "/users/{user_id}/gamification",
    response_model=GamificationProfileResult,
)
def get_user_gamification(user_id: str, db: Session = Depends(get_db)):
    """Current XP, level, streak and badge state. Read-only."""
    return gamification_service.get_user_gamification(db, user_id)


@router.post(
    "/users/{user_id}/gamification/sync",
    response_model=GamificationSyncResult,
)
def sync_user_gamification(user_id: str, db: Session = Depends(get_db)):
    """Award XP for any unscored sessions and re-check every badge rule.

    Idempotent — replaying it never double-counts a session.
    """
    try:
        return gamification_service.sync_user_gamification(db, user_id)
    except Exception as exc:
        logger.error("Gamification sync failed for user %s: %s", user_id, exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to sync gamification progress: {exc}",
        ) from exc


@router.get(
    "/users/{user_id}/mentoring-recommendations",
    response_model=MentoringRecommendationResult,
)
def get_user_mentoring_recommendations(
    user_id: str,
    limit: int = Query(
        default=data_aggregation_service.FULL_HISTORY_LIMIT,
        ge=2,
        le=data_aggregation_service.FULL_HISTORY_LIMIT,
    ),
    force_refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    try:
        logger.info(f"Fetching user recommendations for user_id: {user_id}, limit: {limit}, force_refresh: {force_refresh}")

        # Load saved recommendations from database unless a refresh is explicitly requested
        if not force_refresh:
            cached_recs = db.query(MentoringRecommendation).filter(
                MentoringRecommendation.user_id == user_id,
                MentoringRecommendation.session_id.is_(None),
                MentoringRecommendation.recommendation_type == "overall_user",
            ).order_by(
                MentoringRecommendation.priority.desc(),
                MentoringRecommendation.created_at.desc()
            ).limit(limit).all()

            if cached_recs:
                logger.info(f"Using saved recommendations for user {user_id}")
                recommendations = [
                    MentoringRecommendationItem(
                        priority=rec.priority,
                        skill_area=rec.skill_area,
                        title=rec.title,
                        reason=rec.reason or rec.description,
                        detail=rec.detail or "",
                        next_action=rec.next_action or "",
                        source=rec.source,
                        evidence_sources=[]
                    )
                    for rec in cached_recs
                ]
                return MentoringRecommendationResult(
                    user_id=user_id,
                    recommendations=recommendations,
                    evidence=cached_recs[0].evidence or {},
                    generated_at=cached_recs[0].created_at,
                    recommendation_version="cached",
                    model_version=cached_recs[0].model_version,
                    source=cached_recs[0].source,
                    recommendation_type="overall_user",
                )

        # Generate new recommendations (first time or explicit refresh)
        result = llm_mentoring_service.generate_user_mentoring_recommendations(db, user_id, limit)
        logger.info(f"Successfully generated user recommendations: {len(result.recommendations)} items")
        return result
    except Exception as e:
        logger.error(f"Error generating user recommendations: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate user recommendations: {str(e)}"
        )


@router.get(
    "/sessions/{session_id}/mentoring-recommendations",
    response_model=MentoringRecommendationResult,
)
def get_session_mentoring_recommendations(
    session_id: str,
    force_refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    try:
        logger.info(f"Fetching session recommendations for session_id: {session_id}, force_refresh: {force_refresh}")

        # Load saved recommendations from database unless a refresh is explicitly requested
        if not force_refresh:
            cached_recs = db.query(MentoringRecommendation).filter(
                MentoringRecommendation.session_id == session_id,
                MentoringRecommendation.recommendation_type == "session_specific",
            ).order_by(
                MentoringRecommendation.priority.desc(),
                MentoringRecommendation.created_at.desc()
            ).all()

            if cached_recs:
                logger.info(f"Using saved recommendations for session {session_id}")
                user_id = cached_recs[0].user_id
                recommendations = [
                    MentoringRecommendationItem(
                        priority=rec.priority,
                        skill_area=rec.skill_area,
                        title=rec.title,
                        reason=rec.reason or rec.description,
                        detail=rec.detail or "",
                        next_action=rec.next_action or "",
                        source=rec.source,
                        evidence_sources=[]
                    )
                    for rec in cached_recs
                ]
                return MentoringRecommendationResult(
                    user_id=user_id,
                    session_id=session_id,
                    recommendations=recommendations,
                    evidence=cached_recs[0].evidence or {},
                    generated_at=cached_recs[0].created_at,
                    recommendation_version="cached",
                    model_version=cached_recs[0].model_version,
                    source=cached_recs[0].source,
                    recommendation_type="session_specific",
                )

        # Generate new recommendations (first time or explicit refresh)
        result = llm_mentoring_service.generate_session_mentoring_recommendations(db, session_id)
        logger.info(f"Successfully generated recommendations: {len(result.recommendations)} items")
        return result
    except Exception as e:
        logger.error(f"Error generating session recommendations: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate session recommendations: {str(e)}"
        )
