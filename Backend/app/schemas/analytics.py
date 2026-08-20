from datetime import date, datetime
from typing import Any, Literal

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
    # For human-written feedback the service overwrites this with the NLP model's
    # reading; supplying it only sets the fallback for entries with no text.
    sentiment: Literal["positive", "neutral", "negative", "mixed"] | None = None
    # What the author says about their own feedback, kept apart from the model's
    # independent reading of the same words.
    declared_sentiment: Literal["positive", "neutral", "negative", "mixed"] | None = None


class FeedbackEntryCreate(FeedbackEntryBase):
    pass


class FeedbackEntryRead(FeedbackEntryBase):
    sentiment_confidence: float | None = None
    sentiment_source: Literal["model", "rule", "declared"] | None = None
    sentiment_model_version: str | None = None
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FeedbackSentimentRequest(BaseModel):
    text: str = Field(..., min_length=1)


class FeedbackSentimentResult(BaseModel):
    text: str
    cleaned_text: str
    sentiment: Literal["positive", "neutral", "negative", "mixed"]
    confidence: float = Field(..., ge=0, le=1)
    sentiment_score: float = Field(..., ge=-1, le=1)
    class_probabilities: dict[str, float]
    model_version: str
    model_type: str
    source: Literal["ml_model"]


class ComponentMcaNudge(BaseModel):
    emotion: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    nudge: str | None = None
    nudge_category: str | None = None
    nudge_severity: str | None = None


class ComponentTurnMetric(BaseModel):
    turn: int | None = None
    assertiveness_score: Score = Field(default=None, ge=0, le=100)
    empathy_score: Score = Field(default=None, ge=0, le=100)
    clarity_score: Score = Field(default=None, ge=0, le=100)
    response_quality: Score = Field(default=None, ge=0, le=100)
    flags: list[str] = []


class ComponentRpeSession(BaseModel):
    session_id: str | None = None
    scenario_id: str | None = None
    user_id: str | None = None
    outcome: str | None = None
    final_trust: Score = Field(default=None, ge=0, le=100)
    final_escalation: int | None = Field(default=None, ge=0)
    total_turns: int | None = Field(default=None, ge=0)
    trust_history: list[float] = []
    emotion_history: list[str] = []


class ComponentRpeFeedback(BaseModel):
    session_id: str | None = None
    scenario_id: str | None = None
    scenario_title: str | None = None
    user_id: str | None = None
    outcome: str | None = None
    final_trust: Score = Field(default=None, ge=0, le=100)
    final_escalation: int | None = Field(default=None, ge=0)
    total_turns: int | None = Field(default=None, ge=0)
    turn_metrics: list[ComponentTurnMetric] = []
    risk_flags: list[str] = []
    blind_spots: list[str] = []
    coaching_advice: list[str] = []
    viz_payload: dict[str, Any] = {}
    end_reason: str | None = None
    recommended_turns: int | None = Field(default=None, ge=0)
    max_turns: int | None = Field(default=None, ge=0)


class ComponentAdaptivePlan(BaseModel):
    skill: str | None = None
    strategy: str | None = None
    difficulty: str | None = None
    recommended_scenario_ids: list[str] = []
    primary_scenario: str | None = None
    generation_source: str | None = None
    generation_status: str | None = None


class ComponentSurveyProfile(BaseModel):
    profile: dict[str, Any] = {}
    ocean_scores: dict[str, float] = {}
    dominant_traits: list[str] = []


class ComponentSubmittedFeedback(BaseModel):
    feedback_type: Literal["self", "peer", "system", "mentor"]
    skill_area: str | None = Field(default=None, max_length=80)
    rating: Score = Field(default=None, ge=0, le=100)
    comment: str | None = None
    sentiment: Literal["positive", "neutral", "negative", "mixed"] | None = None


class AnalyticsComponentIntegrationRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    session_id: str = Field(..., min_length=1, max_length=64)
    scenario_id: str | None = Field(default=None, max_length=64)
    skill_type: str | None = Field(default=None, max_length=80)
    survey_profile: ComponentSurveyProfile | dict[str, Any] | None = None
    adaptive_plan: ComponentAdaptivePlan | dict[str, Any] | None = None
    rpe_session: ComponentRpeSession | dict[str, Any] | None = None
    rpe_feedback: ComponentRpeFeedback | dict[str, Any] | None = None
    mca_nudges: list[ComponentMcaNudge | dict[str, Any]] = []
    # Accurate per-skill scores already computed by the MCA engine
    # (vocal_command, speech_fluency, presence_engagement, emotional_regulation).
    # When present these are mapped directly onto the metric columns instead of
    # re-deriving lossy scores from the nudge log.
    mca_skill_scores: dict[str, Score] | None = None
    mca_overall_score: Score = Field(default=None, ge=0, le=100)
    self_feedback: ComponentSubmittedFeedback | None = None


class SessionBackfillItem(BaseModel):
    session_id: str
    source: Literal["mca", "rpe"]
    label: str
    integrated: bool
    overall_score: Score = None
    reason: str | None = None


class SessionBackfillResult(BaseModel):
    user_id: str
    examined_count: int
    integrated_count: int
    # Sessions that were started but recorded nothing analysable - counted, never
    # turned into empty metric rows.
    skipped_count: int = 0
    failed_count: int
    items: list[SessionBackfillItem]
    backfill_version: str


class AnalyticsIntegrationSourceSummary(BaseModel):
    has_survey_profile: bool
    has_adaptive_plan: bool
    has_rpe_session: bool
    has_rpe_feedback: bool
    mca_nudge_count: int
    submitted_feedback_count: int
    generated_feedback_count: int


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
    session_count: int = 0
    # Distinct sessions the user self-assessed. Self feedback is stored one row per
    # skill (4 rows per assessment), so this reflects "assessments" not row count.
    self_session_count: int = 0
    by_type: dict[str, int]
    sentiment_counts: dict[str, int]
    skill_rating_averages: dict[str, float] = {}
    self_rating_averages: dict[str, float] = {}
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
    observed_score: float | None = None
    self_observed_gap: float | None = None
    alignment: Literal[
        "aligned",
        "self_overestimation",
        "self_underestimation",
        "insufficient_data",
    ]
    severity: Literal["none", "low", "medium", "high"]
    recommendation: str


class FeedbackAnalysisSummary(BaseModel):
    self_feedback_count: int
    analyzed_skill_count: int
    aligned_count: int
    blind_spot_count: int
    average_self_rating: float | None = None
    average_observed_score: float | None = None


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
    comparison_source: Literal["observed"]
    gap: float
    confidence: float
    recommendation: str


class SentimentBlindSpotItem(BaseModel):
    """A gap between how the learner rated a session and how they wrote about it.

    The rating-based blind spots compare numbers; this compares the learner's own
    stated sentiment against what the NLP model reads in their words. A learner
    who marks a session positive while describing it critically is showing the
    same self-perception gap, expressed in language rather than scores.
    """

    session_id: str
    declared_sentiment: Literal["positive", "neutral", "negative", "mixed"]
    detected_sentiment: Literal["positive", "neutral", "negative", "mixed"]
    severity: Literal["low", "medium", "high"]
    confidence: float = Field(..., ge=0, le=1)
    comment_excerpt: str
    model_version: str | None = None
    recommendation: str
    created_at: datetime


class BlindSpotSummary(BaseModel):
    total_count: int
    high_count: int
    medium_count: int
    low_count: int
    strongest_blind_spot: BlindSpotItem | None = None
    # Counted separately: a sentiment gap is different evidence from a rating gap
    # and lumping the two totals together would blur what the learner is told.
    sentiment_gap_count: int = 0


class BlindSpotDetectionResult(BaseModel):
    scope: Literal["session", "user"]
    user_id: str | None = None
    session_id: str | None = None
    summary: BlindSpotSummary
    blind_spots: list[BlindSpotItem]
    sentiment_gaps: list[SentimentBlindSpotItem] = []
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
    cutoff_at: datetime | None = None


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


class AnalyticsSessionIntegrationResult(BaseModel):
    user_id: str
    session_id: str
    scenario_id: str | None = None
    metric: AnalyticsSessionMetricRead
    feedback_entries: list[FeedbackEntryRead]
    aggregate: AnalyticsAggregateSummary
    source_summary: AnalyticsIntegrationSourceSummary
    mapping_version: str


class MentoringRecommendationItem(BaseModel):
    priority: Literal["high", "medium", "low"]
    skill_area: str | None = None
    title: str
    reason: str
    detail: str
    next_action: str
    source: Literal["llm", "rule_based"]
    evidence_sources: list[str] = []


class MentoringRecommendationResult(BaseModel):
    user_id: str
    session_id: str | None = None
    recommendations: list[MentoringRecommendationItem]
    evidence: dict[str, int | float | str | None]
    generated_at: datetime
    recommendation_version: str
    model_version: str
    source: Literal["llm", "rule_based"]
    recommendation_type: Literal["overall_user", "session_specific"] = "overall_user"


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
    computed_predictions: list[PredictiveModelingItem] = []
    generated_at: datetime
    report_version: str


class GamificationLevelProgress(BaseModel):
    level: int
    total_xp: int
    xp_into_level: int
    xp_for_next_level: int
    xp_to_next_level: int
    progress_percent: float = Field(..., ge=0, le=100)


class GamificationStreak(BaseModel):
    current_streak: int
    longest_streak: int
    total_learning_days: int
    last_activity_date: date | None = None
    active_today: bool
    # Mon..Sun flags for the current calendar week.
    week_activity: list[bool] = []


class GamificationSkillLevel(BaseModel):
    skill_area: str
    label: str
    xp: int
    level: int
    latest_score: Score = None
    progress_percent: float = Field(..., ge=0, le=100)
    xp_to_next_level: int


class GamificationBadgeItem(BaseModel):
    badge_key: str
    title: str
    description: str
    criteria: str
    tier: Literal["bronze", "silver", "gold"]
    skill_area: str | None = None
    earned: bool
    earned_at: datetime | None = None
    progress_percent: float = Field(default=0.0, ge=0, le=100)
    progress_hint: str | None = None


class GamificationBadgeSummary(BaseModel):
    earned_count: int
    total_count: int
    latest_badge: GamificationBadgeItem | None = None


class GamificationXpAward(BaseModel):
    session_id: str
    base_xp: int
    performance_xp: int
    streak_bonus_xp: int
    total_xp_awarded: int
    overall_score: Score = None
    already_scored: bool = False


class AnalyticsLearnerProfileSignal(BaseModel):
    """The learner's longitudinal profile, normalised for the pedagogy engine.

    The first five fields are the contract the Adaptive Pedagogical Architecture
    already consumes; the rest are the evidence they were derived from, carried
    along so an adjustment can be explained rather than just asserted.
    """

    engagement_score: float = Field(..., ge=0, le=1)
    confidence_score: float = Field(..., ge=0, le=1)
    objective_completion_rate: float = Field(..., ge=0, le=1)
    stress_level: float = Field(..., ge=0, le=1)
    outcome: Literal["success", "partial", "failure"]

    analyzed_skill_count: int
    improving_count: int
    declining_count: int
    blind_spot_total: int
    blind_spot_high: int
    high_risk_skill_count: int
    mean_latest_score: Score = None
    mean_predicted_score: Score = None
    evidence_sessions: int


class AnalyticsFeedbackLoopResult(BaseModel):
    user_id: str
    signal: AnalyticsLearnerProfileSignal
    loop_version: str
    generated_at: datetime


class GamificationRules(BaseModel):
    """The XP formula, published so the UI never restates it from memory."""

    base_session_xp: int
    performance_xp_factor: float
    max_performance_xp: int
    streak_xp_per_day: int
    max_streak_bonus_days: int
    max_streak_bonus_xp: int
    level_base_xp: int
    level_growth_xp: int
    timezone: str


class GamificationProfileResult(BaseModel):
    user_id: str
    level_progress: GamificationLevelProgress
    streak: GamificationStreak
    session_count: int
    skill_levels: list[GamificationSkillLevel]
    badges: list[GamificationBadgeItem]
    badge_summary: GamificationBadgeSummary
    rules: GamificationRules
    generated_at: datetime
    rules_version: str


class GamificationSyncResult(BaseModel):
    user_id: str
    profile: GamificationProfileResult
    awards: list[GamificationXpAward] = []
    newly_earned_badges: list[GamificationBadgeItem] = []
    xp_gained: int = 0


# --- Whole-history views -----------------------------------------------------
# The dashboard's "All Sessions" mode was showing the same panels as its
# single-session mode, with lifetime averages substituted for that session's
# numbers. An average answers a different question from the one the panel asks:
# "how are you doing" is about now, and a mean over three months is not now. On
# the development account the cards read 88 while the learner's last session was
# 72, so a visible decline was being reported as "Great job".


class SkillHistoryItem(BaseModel):
    """One skill across a learner's whole history.

    Carries latest and average side by side deliberately. Either alone misleads:
    the latest score is one session and may be a bad day, the average hides which
    direction the learner is moving.
    """

    skill_area: str
    latest_score: float | None = None
    first_score: float | None = None
    best_score: float | None = None
    worst_score: float | None = None
    average_score: float | None = None
    delta: float | None = None
    trend_label: Literal["improving", "stable", "declining", "insufficient_data"]
    session_count: int
    # How much the learner varies between sessions. A high figure alongside a
    # comfortable average means the average is not describing anything real.
    consistency: float | None = None


class LearnerHistorySummary(BaseModel):
    user_id: str
    session_count: int
    first_session_at: datetime | None = None
    latest_session_at: datetime | None = None
    skills: list[SkillHistoryItem]
    improving_count: int
    declining_count: int
    strongest_skill: SkillHistoryItem | None = None
    weakest_skill: SkillHistoryItem | None = None
    generated_at: datetime
    history_version: str


class RecurringBlindSpotItem(BaseModel):
    """A self-assessment gap counted across sessions rather than averaged.

    Averaging destroys the distinction this exists to make. A learner who
    overestimates by 20 in one session and underestimates by 20 in the next has a
    mean gap of zero and a real problem; a learner who overestimates by 20 every
    single time has the same mean as one bad session and a completely different
    situation.
    """

    skill_area: str
    sessions_rated: int
    sessions_with_gap: int
    gap_rate: float
    pattern: Literal[
        "consistent_overestimation",
        "consistent_underestimation",
        "inconsistent",
        "aligned",
    ]
    mean_signed_gap: float | None = None
    typical_gap: float | None = None
    severity: Literal["none", "low", "medium", "high"]
    recommendation: str


class RecurringBlindSpotResult(BaseModel):
    user_id: str
    minimum_gap: float
    items: list[RecurringBlindSpotItem]
    strongest_pattern: RecurringBlindSpotItem | None = None
    generated_at: datetime
    detection_version: str
