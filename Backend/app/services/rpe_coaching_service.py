import asyncio

from app.services import rpe_llm_service

_SYSTEM_PROMPT = (
    "You are an expert workplace soft skills coach. "
    "You analyse roleplay session data and give concise, "
    "actionable, encouraging feedback. "
    "Always respond in valid JSON only. No markdown, no preamble. "
    'Format: {"overall_rating": "excellent|good|needs_work", '
    '"summary": "one sentence", '
    '"advice": ["point 1", "point 2", "point 3"], '
    '"strengths": ["strength 1", "strength 2"], '
    '"focus_areas": ["area 1", "area 2"], '
    '"strongest_turn": number or null, "strongest_turn_note": string or null, '
    '"improvement_turn": number or null, "improvement_original": string or null, '
    '"improvement_suggested": string or null}\n\n'
    "You are given the full turn-by-turn transcript below the session stats. "
    "strongest_turn: the turn number of the single best user reply in the "
    "transcript (clearest, most assertive-and-professional, or the one that "
    "visibly earned trust) — null if nothing stands out. strongest_turn_note: "
    "one short sentence on why it worked.\n"
    "improvement_turn: the turn number of the single weakest user reply worth "
    "coaching — null if there isn't a clear one. improvement_original: quote "
    "that reply's actual text. improvement_suggested: a rewritten version of "
    "that same reply, in the user's own voice, that would have landed better "
    "in that moment — not generic advice, an actual alternative line they "
    "could have said."
)


class RpeCoachingService:
    """
    Builds coaching-advice prompts from session/turn data and hands them to
    rpe_llm_service — the only place that talks to an LLM provider SDK.
    """

    def generate_advice(
        self,
        session:      dict,
        scenario:     object,
        turn_metrics: list[dict],
        risk_flags:   list[dict],
        blind_spots:  list[dict],
        end_reason:   str | None = None,
    ) -> dict:
        prompt = self._build_prompt(
            session, scenario, turn_metrics, risk_flags, blind_spots, end_reason
        )
        response = asyncio.run(
            rpe_llm_service.get_coaching_response(
                prompt, _SYSTEM_PROMPT, session.get("outcome")
            )
        )
        return response.model_dump()

    def _build_prompt(
        self,
        session:      dict,
        scenario:     object,
        turn_metrics: list[dict],
        risk_flags:   list[dict],
        blind_spots:  list[dict],
        end_reason:   str | None = None,
    ) -> str:
        avg_quality = (
            sum(m["response_quality"] for m in turn_metrics) / len(turn_metrics)
            if turn_metrics else 0.0
        )
        flag_summary = ", ".join(f["flag_type"] for f in risk_flags) or "none"
        spot_summary = ", ".join(b["blind_spot_type"] for b in blind_spots) or "none"

        quality_by_turn = {m["turn"]: m["response_quality"] for m in turn_metrics}
        transcript_lines = []
        for t in session.get("turns", []):
            q = quality_by_turn.get(t["turn"])
            q_str = f", quality {q}/10" if q is not None else ""
            transcript_lines.append(
                f"Turn {t['turn']} (emotion: {t.get('emotion', 'n/a')}{q_str})\n"
                f"  User: {t['user_input']}\n"
                f"  NPC:  {t['npc_response']}"
            )
        transcript = "\n".join(transcript_lines) or "(no turns recorded)"

        return (
            f"Scenario: {scenario.title} ({scenario.difficulty})\n"
            f"NPC Role: {scenario.npc_role}\n"
            f"Session End Reason: {end_reason}\n"
            f"Outcome: {session.get('outcome', 'incomplete')}\n"
            f"Final Trust: {session.get('final_trust', 'N/A')}/100\n"
            f"Final Escalation: {session.get('final_escalation', 'N/A')}/5\n"
            f"Total Turns: {len(session.get('turns', []))}\n"
            f"Avg Response Quality: {avg_quality:.1f}/10\n"
            f"Emotion Journey: {' -> '.join(session.get('emotion_history', []))}\n"
            f"Trust Journey: {session.get('trust_history', [])}\n"
            f"Risk Flags Detected: {flag_summary}\n"
            f"Blind Spots Detected: {spot_summary}\n\n"
            f"Full transcript:\n{transcript}\n\n"
            f"Generate coaching feedback for this learner."
        )
