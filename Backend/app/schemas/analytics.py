from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


Score = float | None


class AnalyticsSessionMetricBase(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    session_id: str = Field(..., min_length=1, max_length=64)
    scenario_id: str | None = Field(default=None, max_length=64)
    skill_type: str | None = Field(default=None, max_length=80)

    confidence_score: Score = Field(default=None, ge=0, le=100)
    clarity_score: Score = Field(default=None, ge=0, le=100)
    empathy_score: Score = Field(default=None, ge=0, le=100)
    listening_score: Score = Field(default=None, ge=0, le=100)
    adaptability_score: Score = Field(default=None, ge=0, le=100)
    emotional_control_score: Score = Field(default=None, ge=0, le=100)
    professionalism_score: Score = Field(default=None, ge=0, le=100)

    eye_contact_score: Score = Field(default=None, ge=0, le=100)
    speech_pace_score: Score = Field(default=None, ge=0, le=100)
    speech_volume_score: Score = Field(default=None, ge=0, le=100)
    response_quality_score: Score = Field(default=None, ge=0, le=100)

    overall_score: Score = Field(default=None, ge=0, le=100)


class AnalyticsSessionMetricCreate(AnalyticsSessionMetricBase):
    pass


class AnalyticsSessionMetricRead(AnalyticsSessionMetricBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FeedbackEntryBase(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    session_id: str = Field(..., min_length=1, max_length=64)
    feedback_type: Literal["self", "peer", "system", "mentor"]
    skill_area: str | None = Field(default=None, max_length=80)
    rating: Score = Field(default=None, ge=0, le=100)
    comment: str | None = None
    sentiment: Literal["positive", "neutral", "negative"] | None = None


class FeedbackEntryCreate(FeedbackEntryBase):
    pass


class FeedbackEntryRead(FeedbackEntryBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FeedbackSentimentRequest(BaseModel):
    text: str = Field(..., min_length=1)


class FeedbackSentimentResult(BaseModel):
    text: str
    cleaned_text: str
    sentiment: Literal["positive", "neutral", "negative"]
    confidence: float = Field(..., ge=0, le=1)
    sentiment_score: float = Field(..., ge=-1, le=1)
    class_probabilities: dict[str, float]
    model_version: str
    model_type: str
    source: Literal["ml_model"]


class SkillPredictionBase(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    session_id: str | None = Field(default=None, max_length=64)
    predicted_skill: str = Field(..., min_length=1, max_length=80)
    predicted_score: Score = Field(default=None, ge=0, le=100)
    current_score: Score = Field(default=None, ge=0, le=100)
    trend_label: Literal["improving", "stable", "declining"] | None = None
    risk_level: Literal["low", "medium", "high"] = "medium"
    recommendation: str | None = None
    model_version: str = Field(default="rule-based-v1", min_length=1, max_length=40)


class SkillPredictionCreate(SkillPredictionBase):
    pass


class SkillPredictionRead(SkillPredictionBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ScoreSummary(BaseModel):
    metric_count: int
    averages: dict[str, float]
    latest: AnalyticsSessionMetricRead | None = None


class FeedbackSummary(BaseModel):
    total_count: int
    by_type: dict[str, int]
    sentiment_counts: dict[str, int]
    average_rating: float | None = None
    latest_entries: list[FeedbackEntryRead]


class PredictionSummary(BaseModel):
    total_count: int
    risk_counts: dict[str, int]
    trend_counts: dict[str, int]
    latest_predictions: list[SkillPredictionRead]


class DataCompletenessSummary(BaseModel):
    has_session_metrics: bool
    has_feedback: bool
    has_predictions: bool


class AnalyticsAggregateSummary(BaseModel):
    scope: Literal["session", "user"]
    user_id: str | None = None
    session_id: str | None = None
    scores: ScoreSummary
    feedback: FeedbackSummary
    predictions: PredictionSummary
    data_completeness: DataCompletenessSummary
    generated_at: datetime


class SkillScoreInputs(BaseModel):
    confidence_score: Score = Field(default=None, ge=0, le=100)
    clarity_score: Score = Field(default=None, ge=0, le=100)
    empathy_score: Score = Field(default=None, ge=0, le=100)
    listening_score: Score = Field(default=None, ge=0, le=100)
    adaptability_score: Score = Field(default=None, ge=0, le=100)
    emotional_control_score: Score = Field(default=None, ge=0, le=100)
    professionalism_score: Score = Field(default=None, ge=0, le=100)
    eye_contact_score: Score = Field(default=None, ge=0, le=100)
    speech_pace_score: Score = Field(default=None, ge=0, le=100)
    speech_volume_score: Score = Field(default=None, ge=0, le=100)
    response_quality_score: Score = Field(default=None, ge=0, le=100)
    self_rating: Score = Field(default=None, ge=0, le=100)
    peer_rating: Score = Field(default=None, ge=0, le=100)


class SkillScoreRequest(BaseModel):
    user_id: str | None = Field(default=None, max_length=64)
    session_id: str | None = Field(default=None, max_length=64)
    inputs: SkillScoreInputs


class SkillScoreBreakdown(BaseModel):
    score: float | None
    inputs_used: list[str]


class SkillScoreResult(BaseModel):
    user_id: str | None = None
    session_id: str | None = None
    skill_scores: dict[str, float | None]
    breakdown: dict[str, SkillScoreBreakdown]
    overall_score: float | None
    completeness: float
    scoring_version: str


class FeedbackAlignmentItem(BaseModel):
    skill_area: str
    self_rating: float | None = None
    peer_rating: float | None = None
    observed_score: float | None = None
    self_peer_gap: float | None = None
    self_observed_gap: float | None = None
    peer_observed_gap: float | None = None
    alignment: Literal[
        "aligned",
        "self_overestimation",
        "self_underestimation",
        "peer_misalignment",
        "insufficient_data",
    ]
    severity: Literal["none", "low", "medium", "high"]
    recommendation: str


class FeedbackAnalysisSummary(BaseModel):
    self_feedback_count: int
    peer_feedback_count: int
    analyzed_skill_count: int
    aligned_count: int
    blind_spot_count: int
    average_self_rating: float | None = None
    average_peer_rating: float | None = None


class FeedbackAnalysisResult(BaseModel):
    scope: Literal["session", "user"]
    user_id: str | None = None
    session_id: str | None = None
    summary: FeedbackAnalysisSummary
    items: list[FeedbackAlignmentItem]
    generated_at: datetime
    analysis_version: str


class BlindSpotItem(BaseModel):
    skill_area: str
    blind_spot_type: Literal["overestimation", "underestimation"]
    severity: Literal["low", "medium", "high"]
    self_rating: float
    comparison_score: float
    comparison_source: Literal["observed", "peer"]
    gap: float
    confidence: float
    recommendation: str


class BlindSpotSummary(BaseModel):
    total_count: int
    high_count: int
    medium_count: int
    low_count: int
    strongest_blind_spot: BlindSpotItem | None = None


class BlindSpotDetectionResult(BaseModel):
    scope: Literal["session", "user"]
    user_id: str | None = None
    session_id: str | None = None
    summary: BlindSpotSummary
    blind_spots: list[BlindSpotItem]
    generated_at: datetime
    detection_version: str


class ProgressTrendPoint(BaseModel):
    session_id: str
    score: float
    created_at: datetime


class SkillTrendItem(BaseModel):
    skill_area: str
    trend_label: Literal["improving", "stable", "declining", "insufficient_data"]
    first_score: float | None = None
    latest_score: float | None = None
    delta: float | None = None
    slope: float | None = None
    session_count: int
    points: list[ProgressTrendPoint]
    recommendation: str


class ProgressTrendSummary(BaseModel):
    analyzed_skill_count: int
    improving_count: int
    stable_count: int
    declining_count: int
    insufficient_data_count: int
    strongest_improvement: SkillTrendItem | None = None
    strongest_decline: SkillTrendItem | None = None


class ProgressTrendResult(BaseModel):
    user_id: str
    summary: ProgressTrendSummary
    trends: list[SkillTrendItem]
    generated_at: datetime
    trend_version: str


class PredictiveModelingItem(BaseModel):
    predicted_skill: str
    current_score: float | None = None
    predicted_score: float | None = None
    trend_label: Literal["improving", "stable", "declining", "insufficient_data"]
    risk_level: Literal["low", "medium", "high"]
    confidence: float
    evidence_points: int
    recommendation: str


class PredictiveModelingSummary(BaseModel):
    predicted_count: int
    low_risk_count: int
    medium_risk_count: int
    high_risk_count: int
    highest_risk_prediction: PredictiveModelingItem | None = None


class PredictiveModelingResult(BaseModel):
    user_id: str
    predictions: list[PredictiveModelingItem]
    summary: PredictiveModelingSummary
    generated_at: datetime
    model_version: str


class PostSessionActionItem(BaseModel):
    priority: Literal["high", "medium", "low"]
    skill_area: str | None = None
    title: str
    detail: str


class PostSessionReportSummary(BaseModel):
    headline: str
    strengths: list[str]
    improvement_areas: list[str]
    completion_status: Literal["complete", "partial", "empty"]


class PostSessionReportResult(BaseModel):
    session_id: str
    user_id: str | None = None
    summary: PostSessionReportSummary
    aggregate: AnalyticsAggregateSummary
    skill_scores: SkillScoreResult
    feedback_analysis: FeedbackAnalysisResult
    blind_spots: BlindSpotDetectionResult
    action_items: list[PostSessionActionItem]
    generated_at: datetime
    report_version: str
