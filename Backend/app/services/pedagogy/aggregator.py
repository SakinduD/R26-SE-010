"""
Performance Aggregator — PURE reduction of external signals to a normalised
PerformanceSignal that the dynamic_adjuster can consume.

Two sources are supported:
  - RPE FeedbackResponse (post-session, complete picture)
  - MCA McaNudge stream  (mid-session, partial picture)

No I/O, no LLM, no DB. Source-field citations live next to each derived field.
"""
from __future__ import annotations

from typing import cast

from app.contracts.mca import McaNudge
from app.contracts.rpe import FeedbackResponse
from app.services.pedagogy.types import Outcome, PerformanceSignal


# Tunables for MCA aggregation. Documented inline.
MCA_ENGAGEMENT_DROP_CATEGORIES = {"volume", "silence", "clarity"}
MCA_ENGAGEMENT_DROP_WEIGHT = 0.6
MCA_WARNING_STRESS_WEIGHT = 0.5  # warnings count half as much as criticals

# Tunables for RPE aggregation
RPE_FINAL_TRUST_RANGE = 100.0           # final_trust is 0-100
RPE_FINAL_ESCALATION_RANGE = 4.0        # final_escalation is 0-4
RPE_HIGH_SEVERITY_FLAGS = {"high", "critical"}
RPE_HIGH_SEVERITY_FLAG_STRESS_BONUS = 0.1


class PerformanceAggregator:
    """Reduce external module signals to PerformanceSignal."""

    @staticmethod
    def from_rpe_feedback(fb: FeedbackResponse) -> PerformanceSignal:
        """
        Map an RPE FeedbackResponse to PerformanceSignal.

        Field mapping (each cites the FeedbackResponse source field):
          engagement_score
              ← mean of fb.turn_metrics[*].response_quality (0-1 already)
          confidence_score
              ← (fb.final_trust or 50) / 100      (RPE trust is 0-100)
          objective_completion_rate
              ← outcome=success → 1.0; partial → 0.5; failure → 0.0
          stress_level
              ← (fb.final_escalation or 0) / 4
                + 0.1 * count(risk_flags with severity in {high, critical})
          outcome
              ← maps fb.outcome string ("success"|"failure"|else→partial)
        """
        if fb.turn_metrics:
            engagement_raw = sum(t.response_quality for t in fb.turn_metrics) / len(
                fb.turn_metrics
            )
        else:
            engagement_raw = 0.5
        engagement = max(0.0, min(1.0, engagement_raw))

        confidence = max(
            0.0, min(1.0, (fb.final_trust or 50) / RPE_FINAL_TRUST_RANGE)
        )

        outcome_lower = (fb.outcome or "partial").lower()
        if outcome_lower == "success":
            completion = 1.0
            mapped_outcome: Outcome = "success"
        elif outcome_lower == "failure":
            completion = 0.0
            mapped_outcome = "failure"
        else:
            completion = 0.5
            mapped_outcome = "partial"

        esc_norm = (fb.final_escalation or 0) / RPE_FINAL_ESCALATION_RANGE
        high_sev_count = sum(
            1 for f in fb.risk_flags if f.severity in RPE_HIGH_SEVERITY_FLAGS
        )
        stress = max(
            0.0,
            min(
                1.0,
                esc_norm + RPE_HIGH_SEVERITY_FLAG_STRESS_BONUS * high_sev_count,
            ),
        )

        return PerformanceSignal(
            engagement_score=engagement,
            confidence_score=confidence,
            objective_completion_rate=completion,
            stress_level=stress,
            outcome=mapped_outcome,
        )

    @staticmethod
    def from_mca_nudges(nudges: list[McaNudge]) -> PerformanceSignal:
        """
        Map a batch of MCA nudges to PerformanceSignal.

        Mapping notes:
          engagement_score
              starts at 1.0; multiplies by (1 - 0.6 * (drop_categories / total))
              where drop_categories = nudges in {volume, silence, clarity}
          stress_level
              ← (criticals + 0.5 * warnings) / total
          confidence_score
              ← mean of nudge.confidence (the SVM emotion confidence proxy)
          objective_completion_rate
              ← 0.5 (MCA cannot tell us this; intentional middle value)
          outcome
              ← "partial" (MCA never decides outcome — RPE owns that)
        """
        if not nudges:
            return PerformanceSignal(
                engagement_score=0.5,
                confidence_score=0.5,
                objective_completion_rate=0.5,
                stress_level=0.0,
                outcome="partial",
            )

        n = len(nudges)
        critical = sum(1 for x in nudges if x.nudge_severity == "critical")
        warning = sum(1 for x in nudges if x.nudge_severity == "warning")
        engagement_drops = sum(
            1 for x in nudges if x.nudge_category in MCA_ENGAGEMENT_DROP_CATEGORIES
        )

        engagement = max(
            0.0,
            min(
                1.0,
                1.0 - MCA_ENGAGEMENT_DROP_WEIGHT * (engagement_drops / n),
            ),
        )
        stress = max(
            0.0,
            min(
                1.0,
                (critical + MCA_WARNING_STRESS_WEIGHT * warning) / n,
            ),
        )
        confidence = max(
            0.0, min(1.0, sum(x.confidence for x in nudges) / n)
        )

        return PerformanceSignal(
            engagement_score=engagement,
            confidence_score=confidence,
            objective_completion_rate=0.5,
            stress_level=stress,
            outcome=cast(Outcome, "partial"),
        )
