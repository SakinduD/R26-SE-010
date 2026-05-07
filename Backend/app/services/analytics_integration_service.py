from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.schemas.analytics import (
    AnalyticsAggregateSummary,
    AnalyticsComponentIntegrationRequest,
    AnalyticsIntegrationSourceSummary,
    AnalyticsSessionIntegrationResult,
    AnalyticsSessionMetricCreate,
    ComponentAdaptivePlan,
    ComponentMcaNudge,
    ComponentRpeFeedback,
    ComponentRpeSession,
    ComponentSurveyProfile,
    FeedbackEntryCreate,
)
from app.services import analytics_service, data_aggregation_service


MAPPING_VERSION = "component-contract-mapping-v1"


def integrate_component_session_data(
    db: Session,
    payload: AnalyticsComponentIntegrationRequest,
) -> AnalyticsSessionIntegrationResult:
    rpe_feedback = _coerce_model(payload.rpe_feedback, ComponentRpeFeedback)
    rpe_session = _coerce_model(payload.rpe_session, ComponentRpeSession)
    adaptive_plan = _coerce_model(payload.adaptive_plan, ComponentAdaptivePlan)
    survey_profile = _coerce_model(payload.survey_profile, ComponentSurveyProfile)
    mca_nudges = [_coerce_model(item, ComponentMcaNudge) for item in payload.mca_nudges]

    metric_payload = _build_metric_payload(
        payload=payload,
        rpe_feedback=rpe_feedback,
        rpe_session=rpe_session,
        adaptive_plan=adaptive_plan,
        mca_nudges=mca_nudges,
    )
    metric = analytics_service.create_session_metric(db, metric_payload)

    generated_feedback = _build_generated_feedback(
        payload=payload,
        rpe_feedback=rpe_feedback,
        rpe_session=rpe_session,
        adaptive_plan=adaptive_plan,
        survey_profile=survey_profile,
        mca_nudges=mca_nudges,
    )
    submitted_feedback = _normalize_submitted_feedback(payload)
    feedback_entries = [
        analytics_service.create_feedback_entry(db, feedback)
        for feedback in [*generated_feedback, *submitted_feedback]
    ]

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
            has_rpe_session=rpe_session is not None,
            has_rpe_feedback=rpe_feedback is not None,
            mca_nudge_count=len(mca_nudges),
            submitted_feedback_count=len(submitted_feedback),
            generated_feedback_count=len(generated_feedback),
        ),
        mapping_version=MAPPING_VERSION,
    )


def _build_metric_payload(
    payload: AnalyticsComponentIntegrationRequest,
    rpe_feedback: ComponentRpeFeedback | None,
    rpe_session: ComponentRpeSession | None,
    adaptive_plan: ComponentAdaptivePlan | None,
    mca_nudges: list[ComponentMcaNudge],
) -> AnalyticsSessionMetricCreate:
    turn_metrics = rpe_feedback.turn_metrics if rpe_feedback else []
    scenario_id = (
        payload.scenario_id
        or _optional_attr(rpe_feedback, "scenario_id")
        or _optional_attr(rpe_session, "scenario_id")
        or _optional_attr(adaptive_plan, "primary_scenario")
    )

    values = {
        "confidence_score": _average(item.assertiveness_score for item in turn_metrics),
        "clarity_score": _average(item.clarity_score for item in turn_metrics),
        "empathy_score": _average(item.empathy_score for item in turn_metrics),
        "response_quality_score": _average(item.response_quality for item in turn_metrics),
        "adaptability_score": _trust_score(rpe_feedback, rpe_session),
        "emotional_control_score": _emotional_control_score(rpe_feedback, rpe_session, mca_nudges),
        "professionalism_score": _professionalism_score(rpe_feedback, rpe_session),
        "speech_pace_score": _nudge_score(mca_nudges, {"pace"}),
        "speech_volume_score": _nudge_score(mca_nudges, {"volume", "pitch"}),
        "eye_contact_score": _nudge_score(mca_nudges, {"fusion", "ser"}),
    }
    values["listening_score"] = _average(
        [
            values["empathy_score"],
            values["response_quality_score"],
            _nudge_score(mca_nudges, {"silence"}),
        ]
    )
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
    rpe_feedback: ComponentRpeFeedback | None,
    rpe_session: ComponentRpeSession | None,
    adaptive_plan: ComponentAdaptivePlan | None,
    survey_profile: ComponentSurveyProfile | None,
    mca_nudges: list[ComponentMcaNudge],
) -> list[FeedbackEntryCreate]:
    entries: list[FeedbackEntryCreate] = []

    if rpe_feedback:
        comment_parts = [
            _sentence("Role-play outcome", rpe_feedback.outcome or _optional_attr(rpe_session, "outcome")),
            _sentence("Risk flags", ", ".join(rpe_feedback.risk_flags)),
            _sentence("Blind spots", ", ".join(rpe_feedback.blind_spots)),
            _sentence("Coaching advice", " ".join(rpe_feedback.coaching_advice)),
        ]
        entries.append(
            _system_feedback(
                payload,
                skill_area=payload.skill_type,
                rating=_average(
                    [
                        _optional_attr(rpe_feedback, "final_trust"),
                        _average(item.response_quality for item in rpe_feedback.turn_metrics),
                    ]
                ),
                comment=" ".join(part for part in comment_parts if part),
                sentiment=_sentiment_from_outcome(rpe_feedback.outcome),
            )
        )

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
    for item in payload.peer_feedback:
        entries.append(
            FeedbackEntryCreate(
                user_id=payload.user_id,
                session_id=payload.session_id,
                **item.model_dump(),
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
    if value is None:
        return None
    if isinstance(value, model_type):
        return value
    return model_type.model_validate(value)


def _optional_attr(value, attr: str):
    return getattr(value, attr, None) if value is not None else None


def _average(values: Iterable[float | None]) -> float | None:
    valid_values = [float(value) for value in values if value is not None]
    if not valid_values:
        return None
    return round(sum(valid_values) / len(valid_values), 2)


def _trust_score(
    rpe_feedback: ComponentRpeFeedback | None,
    rpe_session: ComponentRpeSession | None,
) -> float | None:
    trust_history = _optional_attr(rpe_session, "trust_history") or []
    return _average(
        [
            _optional_attr(rpe_feedback, "final_trust"),
            _optional_attr(rpe_session, "final_trust"),
            *trust_history,
        ]
    )


def _emotional_control_score(
    rpe_feedback: ComponentRpeFeedback | None,
    rpe_session: ComponentRpeSession | None,
    mca_nudges: list[ComponentMcaNudge],
) -> float | None:
    escalations = [
        value
        for value in [
            _optional_attr(rpe_feedback, "final_escalation"),
            _optional_attr(rpe_session, "final_escalation"),
        ]
        if value is not None
    ]
    escalation_score = None
    if escalations:
        escalation_score = _clamp_score(100 - (max(escalations) * 18))
    return _average([escalation_score, _nudge_score(mca_nudges, {"fusion", "ser"})])


def _professionalism_score(
    rpe_feedback: ComponentRpeFeedback | None,
    rpe_session: ComponentRpeSession | None,
) -> float | None:
    trust = _trust_score(rpe_feedback, rpe_session)
    escalation = max(
        [
            value
            for value in [
                _optional_attr(rpe_feedback, "final_escalation"),
                _optional_attr(rpe_session, "final_escalation"),
            ]
            if value is not None
        ],
        default=None,
    )
    outcome = (_optional_attr(rpe_feedback, "outcome") or _optional_attr(rpe_session, "outcome") or "").lower()
    if trust is None and escalation is None and not outcome:
        return None
    score = trust if trust is not None else 70
    if escalation is not None:
        score -= escalation * 8
    if "success" in outcome or "resolved" in outcome:
        score += 8
    if "fail" in outcome or "escalated" in outcome:
        score -= 10
    return _clamp_score(score)


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
