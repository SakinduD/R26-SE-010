from app.config import get_settings


class RpeNpcService:
    def __init__(self) -> None:
        api_key = get_settings().groq_api_key
        if api_key:
            from groq import Groq
            self._client = Groq(api_key=api_key)
        else:
            self._client = None

    def _build_system_prompt(
        self,
        npc_role: str,
        npc_personality: str,
        context: str,
        trust_score: int,
        escalation_level: int,
        npc_behaviour: dict,
    ) -> str:
        trust_thresholds = npc_behaviour.get(
            "trust_thresholds",
            {"cooperative": 70, "neutral": 40, "hostile": 0},
        )
        escalation_thresholds = npc_behaviour.get(
            "escalation_thresholds",
            {"furious": 4, "irritated": 2, "controlled": 0},
        )

        if trust_score >= trust_thresholds["cooperative"]:
            trust_tone = "The user has earned some respect. Be slightly more cooperative but remain demanding."
        elif trust_score >= trust_thresholds["neutral"]:
            trust_tone = "Remain neutral. Acknowledge effort but maintain pressure."
        else:
            trust_tone = "You have no confidence in this person. Be dismissive and impatient."

        if escalation_level >= escalation_thresholds["furious"]:
            escalation_tone = "You are furious. Issue ultimatums. Use short sharp sentences."
        elif escalation_level >= escalation_thresholds["irritated"]:
            escalation_tone = "You are visibly irritated. No pleasantries whatsoever."
        else:
            escalation_tone = "You are tense but controlled."

        return (
            f"You are roleplaying as {npc_role}.\n"
            f"Personality: {npc_personality}.\n"
            f"Context: {context}\n\n"
            f"Current state:\n"
            f"- Trust level: {trust_score}/100. {trust_tone}\n"
            f"- Escalation level: {escalation_level}/5. {escalation_tone}\n\n"
            f"Rules:\n"
            f"- Respond in 1-3 sentences only.\n"
            f"- Stay in character. Never break roleplay.\n"
            f"- Never repeat the same response twice across turns.\n"
            f"- Your tone must reflect the trust and escalation state above."
        )

    def generate_response(
        self,
        user_input: str,
        opening_npc_line: str,
        session_turns: list[dict],
        npc_role: str,
        npc_personality: str,
        context: str,
        trust_score: int,
        escalation_level: int,
        npc_behaviour: dict,
    ) -> str:
        if not self._client:
            return "NPC service unavailable: GROQ_API_KEY is not configured."

        system_prompt = self._build_system_prompt(
            npc_role, npc_personality, context,
            trust_score, escalation_level, npc_behaviour,
        )
        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        messages.append({"role": "assistant", "content": opening_npc_line})
        for turn in session_turns:
            messages.append({"role": "user",      "content": turn["user_input"]})
            messages.append({"role": "assistant", "content": turn["npc_response"]})
        messages.append({"role": "user", "content": user_input})

        try:
            response = self._client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                max_tokens=150,
            )
            return response.choices[0].message.content
        except Exception as exc:
            return f"[NPC temporarily unavailable: {exc}]"
