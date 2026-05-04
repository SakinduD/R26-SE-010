import json

from app.config import get_settings

_FALLBACK_ADVICE = {
    "overall_rating": "needs_work",
    "summary":        "Session complete. Review your turn-by-turn performance below.",
    "advice": [
        "Focus on staying calm and assertive throughout the conversation.",
        "Use empathetic language early to build trust with the NPC.",
        "When escalation rises, slow down and acknowledge the NPC's concern.",
    ],
    "strengths":   ["Completed the session"],
    "focus_areas": ["Trust building", "Escalation management"],
}

_SYSTEM_PROMPT = (
    "You are an expert workplace soft skills coach. "
    "You analyse roleplay session data and give concise, "
    "actionable, encouraging feedback. "
    "Always respond in valid JSON only. No markdown, no preamble. "
    'Format: {"overall_rating": "excellent|good|needs_work", '
    '"summary": "one sentence", '
    '"advice": ["point 1", "point 2", "point 3"], '
    '"strengths": ["strength 1", "strength 2"], '
    '"focus_areas": ["area 1", "area 2"]}'
)


class RpeCoachingService:
    def __init__(self) -> None:
        api_key = get_settings().groq_api_key
        if api_key:
            from groq import Groq
            self._client = Groq(api_key=api_key)
        else:
            self._client = None

    def generate_advice(
        self,
        session:      dict,
        scenario:     object,
        turn_metrics: list[dict],
        risk_flags:   list[dict],
        blind_spots:  list[dict],
        end_reason:   str | None = None,
    ) -> dict:
        if not self._client:
            rating = "good" if session.get("outcome") == "success" else "needs_work"
            fallback = dict(_FALLBACK_ADVICE)
            fallback["overall_rating"] = rating
            return fallback

        prompt = self._build_prompt(
            session, scenario, turn_metrics, risk_flags, blind_spots, end_reason
        )
        try:
            response = self._client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user",   "content": prompt},
                ],
                max_tokens=600,
            )
            raw = response.choices[0].message.content
            return self._parse_response(raw, session)
        except Exception:
            rating = "good" if session.get("outcome") == "success" else "needs_work"
            fallback = dict(_FALLBACK_ADVICE)
            fallback["overall_rating"] = rating
            return fallback

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
            f"Generate coaching feedback for this learner."
        )

    def _parse_response(self, raw: str, session: dict) -> dict:
        try:
            clean = raw.strip().replace("```json", "").replace("```", "")
            return json.loads(clean)
        except Exception:
            rating = "good" if session.get("outcome") == "success" else "needs_work"
            fallback = dict(_FALLBACK_ADVICE)
            fallback["overall_rating"] = rating
            return fallback
