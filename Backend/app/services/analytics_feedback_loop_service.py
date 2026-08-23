"""The learner profile the analytics module hands back to the pedagogy engine.

The system architecture draws an edge labelled "Updated learner profile &
performance data" running from the Feedback System & Predictive Analytics module
back into the Adaptive Pedagogical Architecture. This module produces what
travels along that edge.

Why it is not a duplicate of what RPE already sends
---------------------------------------------------
The Role-Play engine hands the pedagogy engine a *per-session* signal: how did
this one conversation go. That is the right input for reacting to the last
session, but it cannot see a learner who has been quietly declining for three
weeks, or one whose self-perception has drifted away from observed behaviour.
Averaging recent sessions has the same blind spot — a learner averaging 70 while
sliding from 85 looks identical to one climbing from 55.

The analytics module owns the longitudinal view, so the signal built here is
derived from evidence that only exists across sessions:

    trend direction   — improving / stable / declining per skill (many sessions)
    blind-spot load   — self-perception vs observed behaviour, weighted by severity
    predicted risk    — the ML behavioural risk model's forecast

Those are reduced to the same normalised ``PerformanceSignal`` the pedagogy
module already consumes, so it needs no new vocabulary — only a better source.
The mapping for every field is documented next to it, in the same style as
``pedagogy/aggregator.py``, so an adjustment can always be traced back to the
evidence that caused it.

How it reaches the plan
-----------------------
``pedagogy.plan_service`` pulls this signal when it composes or regenerates a
plan, and stamps ``generation_sources.pedagogy = "recalibrated_from_analytics"``
so the learner can see on the plan page that their history shaped it.

Deliberately a pull, not a push. The plans learners actually create are
``PersonalisedTrainingPlan`` rows, which are versioned and never overwritten —
mutating one from here would break that guarantee and bypass the module that
owns plans. This module decides *what the learner profile says*; the pedagogy
module decides *what to do about it*.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.schemas.analytics import AnalyticsLearnerProfileSignal
from app.services import blind_spot_service, predictive_modeling_service, progress_trend_service


logger = logging.getLogger(__name__)

LOOP_VERSION = "analytics-feedback-loop-v1"

# Score scale used throughout the analytics tables.
SCORE_SCALE = 100.0

# Blind spots are pressure on the learner, weighted by how badly self-perception
# and observed behaviour disagree.
BLIND_SPOT_SEVERITY_WEIGHT = {"high": 1.0, "medium": 0.6, "low": 0.3}
# A learner is considered under real self-perception pressure at roughly three
# high-severity blind spots; the load is normalised against that.
BLIND_SPOT_SATURATION = 3.0

RISK_WEIGHT = {"high": 1.0, "medium": 0.5, "low": 0.0}

# How stress is split between the two longitudinal pressure sources.
BLIND_SPOT_STRESS_WEIGHT = 0.6
RISK_STRESS_WEIGHT = 0.4

# Trend majority thresholds for the coarse outcome label.
OUTCOME_SUCCESS_RATIO = 0.5
OUTCOME_FAILURE_RATIO = 0.5


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _mean(values: list[float]) -> float | None:
    clean = [value for value in values if value is not None]
    return sum(clean) / len(clean) if clean else None


def build_learner_profile_signal(db: Session, user_id: str) -> AnalyticsLearnerProfileSignal:
    """Reduce the learner's analytics history to one normalised signal.

    Field mapping — each cites the analytics output it is derived from:

    ``confidence_score``
        <- mean latest_score across the four tracked skill trends / 100.
           Where the learner currently stands, not how one session went.

    ``objective_completion_rate``
        <- mean predicted_score from the behavioural model / 100, falling back to
           the current mean when the model has too little evidence. This is the
           forward-looking channel: how close the learner is trending toward the
           expected standard.

    ``engagement_score``
        <- proportion of tracked skills with enough evidence to trend at all,
           blended with trend direction. A learner practising every skill
           regularly scores high; one who has stopped touching most skills does
           not, even if the sessions they do run go well.

    ``stress_level``
        <- 0.6 * blind-spot load + 0.4 * predicted risk.
           Blind-spot load weights each spot by severity and normalises against
           three high-severity spots. This is the channel RPE cannot supply: it
           only exists once self-assessments and observed behaviour can be
           compared over time.

    ``outcome``
        <- trend majority. More improving than declining -> success; more
           declining than improving -> failure; otherwise partial.
    """
    trends = progress_trend_service.analyze_user_progress_trends(db, user_id)
    blind_spots = blind_spot_service.detect_user_blind_spots(db, user_id)
    predictions = predictive_modeling_service.predict_user_skill_outcomes(db, user_id)

    trend_items = [item for item in trends.trends if item.trend_label != "insufficient_data"]
    tracked_count = len(trends.trends) or 1

    # --- confidence: where the learner stands right now -----------------------
    latest_mean = _mean([item.latest_score for item in trend_items])
    confidence = _clamp(latest_mean / SCORE_SCALE) if latest_mean is not None else 0.5

    # --- completion: where the learner is heading -----------------------------
    predicted_mean = _mean([item.predicted_score for item in predictions.predictions])
    completion = (
        _clamp(predicted_mean / SCORE_SCALE) if predicted_mean is not None else confidence
    )

    # --- engagement: breadth of practice, tilted by direction -----------------
    coverage = len(trend_items) / tracked_count
    improving = sum(1 for item in trend_items if item.trend_label == "improving")
    declining = sum(1 for item in trend_items if item.trend_label == "declining")
    direction = (
        0.5 + 0.5 * ((improving - declining) / len(trend_items)) if trend_items else 0.5
    )
    engagement = _clamp(0.5 * coverage + 0.5 * direction)

    # --- stress: blind-spot load and predicted risk ---------------------------
    blind_spot_load = _clamp(
        sum(
            BLIND_SPOT_SEVERITY_WEIGHT.get(item.severity, 0.3)
            for item in blind_spots.blind_spots
        )
        / BLIND_SPOT_SATURATION
    )
    risk_values = [
        RISK_WEIGHT.get(item.risk_level, 0.5) for item in predictions.predictions
    ]
    risk_load = _clamp(sum(risk_values) / len(risk_values)) if risk_values else 0.0
    stress = _clamp(
        BLIND_SPOT_STRESS_WEIGHT * blind_spot_load + RISK_STRESS_WEIGHT * risk_load
    )

    # --- outcome: trend majority ---------------------------------------------
    if trend_items and improving > declining and improving / len(trend_items) > OUTCOME_SUCCESS_RATIO:
        outcome = "success"
    elif trend_items and declining > improving and declining / len(trend_items) > OUTCOME_FAILURE_RATIO:
        outcome = "failure"
    else:
        outcome = "partial"

    return AnalyticsLearnerProfileSignal(
        engagement_score=round(engagement, 4),
        confidence_score=round(confidence, 4),
        objective_completion_rate=round(completion, 4),
        stress_level=round(stress, 4),
        outcome=outcome,
        analyzed_skill_count=len(trend_items),
        improving_count=improving,
        declining_count=declining,
        blind_spot_total=blind_spots.summary.total_count,
        blind_spot_high=blind_spots.summary.high_count,
        high_risk_skill_count=sum(
            1 for item in predictions.predictions if item.risk_level == "high"
        ),
        mean_latest_score=round(latest_mean, 2) if latest_mean is not None else None,
        mean_predicted_score=round(predicted_mean, 2) if predicted_mean is not None else None,
        evidence_sessions=max((item.session_count for item in trends.trends), default=0),
    )
