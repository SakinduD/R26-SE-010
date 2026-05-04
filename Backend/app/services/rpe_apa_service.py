"""
rpe_apa_service.py

APA (Adaptive Pedagogical Architecture) Integration Service for RPE.

This service is the SINGLE integration point between the Role-Play
Simulation Engine and the Adaptive Pedagogical Architecture component.

Current status: STUB — all methods return sensible defaults.

When the APA component owner is ready to integrate, they need to:
1. Confirm the data format they send (see method docstrings below)
2. Implement the TODO sections in each method
3. Optionally: expose an APA endpoint that RPE can call, or have
   APA call POST /api/v1/rpe/apa/recommend directly

Contact: RPE component owner before modifying this file.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.rpe_scenario_service import RpeScenarioService


@dataclass
class ApaLearnerProfile:
    """
    Learner profile data expected from the APA component.

    This dataclass defines the contract between APA and RPE.
    The APA component owner should confirm these fields match
    what their Psychometric Mapping Engine / Big Five Trait Analyzer outputs.

    Fields:
        user_id:               Learner identifier (matches RPE session user_id)
        openness:              Big Five score 0.0 - 1.0
        conscientiousness:     Big Five score 0.0 - 1.0
        extraversion:          Big Five score 0.0 - 1.0
        agreeableness:         Big Five score 0.0 - 1.0
        neuroticism:           Big Five score 0.0 - 1.0
        weak_skills:           List of skill names from APA skill gap analysis
        recommended_difficulty: "beginner" | "intermediate" | "advanced"
    """
    user_id: str
    openness: float = 0.5
    conscientiousness: float = 0.5
    extraversion: float = 0.5
    agreeableness: float = 0.5
    neuroticism: float = 0.5
    weak_skills: list[str] = field(default_factory=list)
    recommended_difficulty: str = "beginner"


class RpeApaService:
    """
    Handles all APA → RPE communication.
    Currently returns sensible defaults for all methods.
    Replace TODO sections when APA integration is ready.
    """

    def __init__(self, scenario_service: RpeScenarioService) -> None:
        self._scenario_service = scenario_service

    def get_recommended_scenarios(
        self,
        learner_profile: ApaLearnerProfile | None = None,
    ) -> list[dict]:
        """
        Returns personalised scenario recommendations for a learner.

        Current behaviour (stub):
            Returns all scenarios sorted by difficulty_weight ascending.

        Future behaviour (APA integration):
            TODO: Use learner_profile.weak_skills to find scenarios whose
            apa_metadata.target_skills overlap with the learner's weak areas.

            TODO: Use learner_profile.neuroticism and agreeableness scores
            to prioritise scenarios targeting those Big Five traits.

            TODO: Use learner_profile.recommended_difficulty to filter
            scenarios by appropriate difficulty level.

            TODO: Call APA Strategy Optimizer endpoint (if exposed) to
            get optimised teaching strategy and map it to a scenario sequence.

        Args:
            learner_profile: ApaLearnerProfile from APA component.
                             Pass None to get default ordering.

        Returns:
            list[dict]: Ordered scenario summaries, most relevant first.
        """
        if learner_profile is None:
            # TODO: fetch learner profile from APA component by user_id
            # when APA exposes GET /api/v1/apa/profile/{user_id}
            return self._scenario_service.get_recommended_for_profile({})

        # TODO: implement personalised ranking using learner_profile fields
        # For now: filter by recommended_difficulty if provided
        if learner_profile.recommended_difficulty:
            results = self._scenario_service.get_by_difficulty(
                learner_profile.recommended_difficulty
            )
            if results:
                return results

        return self._scenario_service.get_recommended_for_profile({})

    def build_scenario_context(
        self,
        scenario_id: str,
        learner_profile: ApaLearnerProfile | None = None,
    ) -> dict:
        """
        Returns scenario data optionally enriched with APA teaching strategy.

        Current behaviour (stub):
            Returns raw scenario data unchanged.

        Future behaviour (APA integration):
            TODO: Call APA LLM Scenario Generator with learner_profile to
            get a personalised scenario variant (modified context, harder
            opening line, different NPC personality intensity).

            TODO: Call APA Dynamic Difficulty Adjustment (DDA) Engine to
            get recommended turn count and success criteria adjustments
            based on learner's current skill level.

            TODO: Apply APA Optimized Teaching Strategy to modify NPC
            npc_behaviour thresholds for this specific learner.

        Args:
            scenario_id:     The base scenario to load.
            learner_profile: ApaLearnerProfile. None = use defaults.

        Returns:
            dict: Scenario data dict (possibly APA-enriched in future).
        """
        scenario = self._scenario_service.get_scenario(scenario_id)
        if not scenario:
            return {}

        # TODO: enrich this dict with APA personalisation data
        return {
            "scenario_id":      scenario.scenario_id,
            "title":            scenario.title,
            "difficulty":       scenario.difficulty,
            "conflict_type":    scenario.conflict_type,
            "npc_role":         scenario.npc_role,
            "npc_personality":  scenario.npc_personality,
            "context":          scenario.context,
            "opening_npc_line": scenario.opening_npc_line,
            "turns":            scenario.turns,
            "success_criteria": scenario.success_criteria,
            "npc_behaviour":    scenario.npc_behaviour,
            "apa_metadata":     scenario.apa_metadata,
            "apa_enriched":     False,  # set True when APA data is applied
        }

    def notify_session_complete(
        self,
        user_id: str,
        session_summary: dict,
    ) -> None:
        """
        Notifies APA that an RPE session is complete.

        Current behaviour (stub):
            Does nothing.

        Future behaviour (APA integration):
            TODO: POST session performance data to APA component so it
            can update the learner's profile, adjust difficulty, and
            feed into the Adaptive Quiz Generator.

            Data to send to APA (from session_summary):
                - final_trust, final_escalation, outcome
                - emotion_history (pattern of emotions across session)
                - trust_history (engagement trend)
                - scenario_id (which skill was practiced)

            TODO: Confirm endpoint with APA component owner:
            POST /api/v1/apa/session-feedback  or similar.

        Args:
            user_id:         Learner identifier.
            session_summary: Full session JSON from rpe_session_service.
        """
        # TODO: implement when APA exposes a session feedback endpoint
        # Example future call:
        # await apa_client.post("/api/v1/apa/session-feedback", json={
        #     "user_id": user_id,
        #     "scenario_id": session_summary["scenario_id"],
        #     "outcome": session_summary["outcome"],
        #     "final_trust": session_summary["final_trust"],
        #     "final_escalation": session_summary["final_escalation"],
        #     "emotion_history": session_summary["emotion_history"],
        #     "trust_history": session_summary["trust_history"],
        # })
        pass
