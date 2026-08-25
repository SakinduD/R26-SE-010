import logging
from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsSessionMetric, FeedbackEntry
from app.schemas.analytics import (
    AnalyticsComponentIntegrationRequest,
    AnalyticsIntegrationSourceSummary,
    AnalyticsSessionIntegrationResult,
    AnalyticsSessionMetricCreate,
    ComponentAdaptivePlan,
    ComponentMcaNudge,
    ComponentSurveyProfile,
    FeedbackEntryCreate,
)
from app.services import analytics_service, data_aggregation_service


MAPPING_VERSION = "component-contract-mapping-v1"

logger = logging.getLogger(__name__)


def integrate_component_session_data(
    db: Session,
    payload: AnalyticsComponentIntegrationRequest,
    run_downstream: bool = True,
) -> AnalyticsSessionIntegrationResult:
    """Fold one completed session into the analytics module.

    ``run_downstream`` controls the after-effects (currently the gamification
    sync). A bulk backfill turns it off and runs them once at the end instead:
    each sync replays the learner's whole history, so doing it per session would
    make importing fifty sessions quadratic for no benefit.
    """
    adaptive_plan = _coerce_model(payload.adaptive_plan, ComponentAdaptivePlan)
    survey_profile = _coerce_model(payload.survey_profile, ComponentSurveyProfile)
    # Dropped, not kept as None: _coerce_model returns None for an entry that
    # does not validate, and a None in this list reaches the scorers as a nudge.
    mca_nudges = [
        nudge
        for nudge in (
            _coerce_model(item, ComponentMcaNudge) for item in payload.mca_nudges
        )
        if nudge is not None
    ]

    metric_payload = _build_metric_payload(
        payload=payload,
        adaptive_plan=adaptive_plan,
        mca_nudges=mca_nudges,
    )
    metric = _upsert_session_metric(db, metric_payload)

    generated_feedback = _build_generated_feedback(
        payload=payload,
        adaptive_plan=adaptive_plan,
        survey_profile=survey_profile,
        mca_nudges=mca_nudges,
    )
    submitted_feedback = _normalize_submitted_feedback(payload)
    feedback_entries = [
        *_replace_generated_feedback(db, payload.user_id, payload.session_id, generated_feedback),
        *[
            analytics_service.create_feedback_entry(db, feedback)
            for feedback in submitted_feedback
        ],
    ]

    # The session's own analytics are now stored; award the learner for it. The
    # pedagogy engine picks up the refreshed learner profile itself, the next
    # time it composes a plan.
    if run_downstream:
        _sync_gamification(db, payload.user_id)

    aggregate = data_aggregation_service.get_session_aggregate(db, payload.session_id)
    return AnalyticsSessionIntegrationResult(
        user_id=payload.user_id,
        session_id=payload.session_id,
        scenario_id=metric.scenario_id,
        metric=metric,
        feedback_entries=feedback_entries,
        aggregate=aggregate,
        source_summary=AnalyticsIntegrationSourceSummary(
            has_survey_profile=survey_profile is not None,
            has_adaptive_plan=adaptive_plan is not None,
            mca_nudge_count=len(mca_nudges),
            submitted_feedback_count=len(submitted_feedback),
            generated_feedback_count=len(generated_feedback),
        ),
        mapping_version=MAPPING_VERSION,
    )


def _sync_gamification(db: Session, user_id: str) -> None:
    """Award XP / badges for the session that just landed.

    Imported lazily to keep the module import graph flat, and deliberately
    non-fatal: gamification is a motivational layer, so a failure here must never
    stop a session's analytics from being recorded.
    """
    try:
        from app.services import gamification_service

        gamification_service.sync_user_gamification(db, user_id)
    except Exception:
        logger.exception("Gamification sync failed for user %s", user_id)


def _upsert_session_metric(
    db: Session,
    payload: AnalyticsSessionMetricCreate,
) -> AnalyticsSessionMetric:
    existing_metrics = (
        db.query(AnalyticsSessionMetric)
        .filter(
            AnalyticsSessionMetric.user_id == payload.user_id,
            AnalyticsSessionMetric.session_id == payload.session_id,
        )
        .order_by(AnalyticsSessionMetric.created_at.desc(), AnalyticsSessionMetric.id.desc())
        .all()
    )

    if not existing_metrics:
        return analytics_service.create_session_metric(db, payload)

    metric = existing_metrics[0]
    for duplicate in existing_metrics[1:]:
        db.delete(duplicate)

    for field, value in payload.model_dump().items():
        setattr(metric, field, value)

    db.add(metric)
    db.commit()
    db.refresh(metric)
    return metric


def _replace_generated_feedback(
    db: Session,
    user_id: str,
    session_id: str,
    generated_feedback: list[FeedbackEntryCreate],
) -> list[FeedbackEntry]:
    db.query(FeedbackEntry).filter(
        FeedbackEntry.user_id == user_id,
        FeedbackEntry.session_id == session_id,
        FeedbackEntry.feedback_type.in_(["system", "mentor"]),
    ).delete(synchronize_session=False)
    db.commit()

    return [
        analytics_service.create_feedback_entry(db, feedback)
        for feedback in generated_feedback
    ]


def _build_metric_payload(
    payload: AnalyticsComponentIntegrationRequest,
    adaptive_plan: ComponentAdaptivePlan | None,
    mca_nudges: list[ComponentMcaNudge],
) -> AnalyticsSessionMetricCreate:
    scenario_id = (
        payload.scenario_id
        or _optional_attr(adaptive_plan, "primary_scenario")
    )

    # Several of these were filled from role-play turn scores and now have no
    # non-multimodal source. They stay in the dict because the mapping below
    # writes into them, and because a metric row missing columns the rest of the
    # module reads is worse than one holding an explicit None.
    values = {
        "confidence_score": None,
        "clarity_score": None,
        "empathy_score": None,
        "response_quality_score": None,
        "adaptability_score": None,
        "emotional_control_score": _nudge_score(mca_nudges, {"fusion", "ser"}),
        "professionalism_score": None,
        "speech_pace_score": _nudge_score(mca_nudges, {"pace"}),
        "speech_volume_score": _nudge_score(mca_nudges, {"volume", "pitch"}),
        "eye_contact_score": _nudge_score(mca_nudges, {"fusion", "ser"}),
    }

    # When the MCA engine has already computed accurate per-skill scores, map them
    # straight onto the composite metric columns so the analytics radar shows the
    # exact MCA scores instead of values re-derived (and conflated) from nudges.
    mca_scores = _normalize_mca_skill_scores(payload.mca_skill_scores)
    if mca_scores.get("vocal_command") is not None:
        values["speech_volume_score"] = mca_scores["vocal_command"]
    if mca_scores.get("speech_fluency") is not None:
        values["speech_pace_score"] = mca_scores["speech_fluency"]
        values["clarity_score"] = mca_scores["speech_fluency"]
    if mca_scores.get("presence_engagement") is not None:
        values["eye_contact_score"] = mca_scores["presence_engagement"]
        values["confidence_score"] = mca_scores["presence_engagement"]
    if mca_scores.get("emotional_intelligence") is not None:
        values["empathy_score"] = mca_scores["emotional_intelligence"]
        values["emotional_control_score"] = mca_scores["emotional_intelligence"]

    values["listening_score"] = _average(
        [
            values["empathy_score"],
            values["response_quality_score"],
            _nudge_score(mca_nudges, {"silence"}),
        ]
    )
    # Overall is the mean of the four skills (not a skill). Prefer the MCA overall
    # when it was supplied for an MCA-scored session; otherwise average whatever
    # composite scores are available.
    if payload.mca_overall_score is not None:
        values["overall_score"] = _clamp_score(float(payload.mca_overall_score))
    else:
        values["overall_score"] = _average(values.values())

    return AnalyticsSessionMetricCreate(
        user_id=payload.user_id,
        session_id=payload.session_id,
        scenario_id=scenario_id,
        skill_type=payload.skill_type or _optional_attr(adaptive_plan, "skill"),
        **values,
    )


def _build_generated_feedback(
    payload: AnalyticsComponentIntegrationRequest,
    adaptive_plan: ComponentAdaptivePlan | None,
    survey_profile: ComponentSurveyProfile | None,
    mca_nudges: list[ComponentMcaNudge],
) -> list[FeedbackEntryCreate]:
    entries: list[FeedbackEntryCreate] = []

    if adaptive_plan:
        entries.append(
            _system_feedback(
                payload,
                feedback_type="mentor",
                skill_area=adaptive_plan.skill,
                comment=(
                    f"Adaptive pedagogy selected {adaptive_plan.strategy or 'a personalized strategy'} "
                    f"at {adaptive_plan.difficulty or 'current'} difficulty. "
                    f"Recommended scenarios: {', '.join(adaptive_plan.recommended_scenario_ids) or 'not provided'}."
                ),
                sentiment="neutral",
            )
        )

    if survey_profile:
        trait_names = survey_profile.dominant_traits or list(survey_profile.ocean_scores.keys())[:3]
        if trait_names:
            entries.append(
                _system_feedback(
                    payload,
                    feedback_type="mentor",
                    skill_area="personality_profile",
                    comment=f"Survey profile context used for analytics: {', '.join(trait_names)}.",
                    sentiment="neutral",
                )
            )

    for nudge in mca_nudges[:5]:
        if not nudge.nudge:
            continue
        entries.append(
            _system_feedback(
                payload,
                skill_area=_nudge_skill_area(nudge.nudge_category),
                rating=_score_from_nudge(nudge),
                comment=f"Multimodal cue: {nudge.nudge}",
                sentiment=_sentiment_from_nudge(nudge),
            )
        )

    return entries


def _normalize_submitted_feedback(
    payload: AnalyticsComponentIntegrationRequest,
) -> list[FeedbackEntryCreate]:
    entries: list[FeedbackEntryCreate] = []
    if payload.self_feedback:
        entries.append(
            FeedbackEntryCreate(
                user_id=payload.user_id,
                session_id=payload.session_id,
                **payload.self_feedback.model_dump(),
            )
        )
    return entries


def _system_feedback(
    payload: AnalyticsComponentIntegrationRequest,
    *,
    feedback_type: str = "system",
    skill_area: str | None = None,
    rating: float | None = None,
    comment: str | None = None,
    sentiment: str | None = None,
) -> FeedbackEntryCreate:
    return FeedbackEntryCreate(
        user_id=payload.user_id,
        session_id=payload.session_id,
        feedback_type=feedback_type,
        skill_area=skill_area,
        rating=rating,
        comment=comment,
        sentiment=sentiment,
    )


def _coerce_model(value, model_type):
    """Optional component data, or None when it does not fit.

    Every one of these is an enhancement: the session's own scores are what the
    learner sees, and a survey profile or adaptive plan is extra context. This
    used to re-validate strictly and raise, so one malformed optional field
    aborted the entire integration - an adaptive plan whose difficulty was the
    integer 5 rather than the string "5" was enough to make the request fail and
    the screen report that no component data existed at all.

    A component that does not fit is dropped and logged. Losing that context is
    a smaller loss than losing the session.
    """
    if value is None:
        return None
    if isinstance(value, model_type):
        return value
    try:
        return model_type.model_validate(value)
    except Exception:
        logger.warning(
            "Dropping %s from the integration payload: it did not validate",
            model_type.__name__,
            exc_info=True,
        )
        return None


def _optional_attr(value, attr: str):
    return getattr(value, attr, None) if value is not None else None


def _average(values: Iterable[float | None]) -> float | None:
    valid_values = [float(value) for value in values if value is not None]
    if not valid_values:
        return None
    return round(sum(valid_values) / len(valid_values), 2)


def _normalize_mca_skill_scores(scores: dict[str, float] | None) -> dict[str, float]:
    """Map the MCA engine's skill_scores onto analytics skill keys.

    MCA names the fourth skill ``emotional_regulation``; the analytics component
    calls it ``emotional_intelligence`` — both are accepted here.
    """
    if not scores:
        return {}

    normalized: dict[str, float] = {}
    for key in ("vocal_command", "speech_fluency", "presence_engagement"):
        value = _coerce_score(scores.get(key))
        if value is not None:
            normalized[key] = value

    emotional = _coerce_score(scores.get("emotional_intelligence"))
    if emotional is None:
        emotional = _coerce_score(scores.get("emotional_regulation"))
    if emotional is not None:
        normalized["emotional_intelligence"] = emotional

    return normalized


def _coerce_score(value) -> float | None:
    if value is None:
        return None
    try:
        return _clamp_score(float(value))
    except (TypeError, ValueError):
        return None


def _nudge_score(nudges: list[ComponentMcaNudge], categories: set[str]) -> float | None:
    relevant = [
        _score_from_nudge(nudge)
        for nudge in nudges
        if (nudge.nudge_category or "").lower() in categories
    ]
    return _average(relevant)


def _score_from_nudge(nudge: ComponentMcaNudge) -> float:
    confidence = nudge.confidence if nudge.confidence is not None else 0.5
    severity = (nudge.nudge_severity or "info").lower()
    if severity == "critical":
        return _clamp_score(35 + (15 * (1 - confidence)))
    if severity == "warning":
        return _clamp_score(55 + (20 * (1 - confidence)))
    return _clamp_score(80 + (20 * confidence))


def _nudge_skill_area(category: str | None) -> str | None:
    mapping = {
        "pace": "speech_pace",
        "volume": "speech_volume",
        "pitch": "speech_volume",
        "clarity": "communication_clarity",
        "silence": "active_listening",
        "fusion": "emotional_control",
        "ser": "emotional_control",
    }
    return mapping.get((category or "").lower())


def _sentiment_from_outcome(outcome: str | None) -> str:
    lowered = (outcome or "").lower()
    if "success" in lowered or "resolved" in lowered:
        return "positive"
    if "fail" in lowered or "escalated" in lowered:
        return "negative"
    return "neutral"


def _sentiment_from_nudge(nudge: ComponentMcaNudge) -> str:
    severity = (nudge.nudge_severity or "info").lower()
    return "negative" if severity in {"warning", "critical"} else "neutral"


def _sentence(label: str, value: str | None) -> str:
    return f"{label}: {value}." if value else ""


def _clamp_score(value: float) -> float:
    return round(max(0, min(100, value)), 2)
