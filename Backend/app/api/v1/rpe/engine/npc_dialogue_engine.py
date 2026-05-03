from __future__ import annotations

import os

from groq import Groq

_MODEL = "llama3-70b-8192"


class NpcDialogueEngine:
    def __init__(self) -> None:
        self._client = Groq(api_key=os.environ.get("GROQ_API_KEY", ""))

    def _build_system_prompt(
        self,
        npc_role: str,
        npc_personality: str,
        context: str,
        trust_score: int,
        escalation_level: int,
        trust_thresholds: dict,
        escalation_thresholds: dict,
    ) -> str:
        if trust_score >= trust_thresholds["cooperative"]:
            trust_tone = "cooperative"
        elif trust_score >= trust_thresholds["neutral"]:
            trust_tone = "neutral"
        else:
            trust_tone = "hostile"

        if escalation_level >= escalation_thresholds["furious"]:
            escalation_tone = "furious"
        elif escalation_level >= escalation_thresholds["irritated"]:
            escalation_tone = "irritated"
        else:
            escalation_tone = "controlled"

        return (
            f"You are {npc_role} with personality: {npc_personality}. "
            f"Scenario context: {context} "
            f"Your trust level toward the employee is '{trust_tone}' (score {trust_score}/100). "
            f"Your current emotional state is '{escalation_tone}' (level {escalation_level}/5). "
            f"Stay in character at all times. Never break character. "
            f"Never repeat a line you have already said in this conversation. "
            f"Keep responses concise — 1 to 3 sentences maximum."
        )

    def generate_response(
        self,
        npc_role: str,
        npc_personality: str,
        context: str,
        user_input: str,
        opening_npc_line: str,
        session_turns: list[dict],
        trust_score: int,
        escalation_level: int,
        trust_thresholds: dict,
        escalation_thresholds: dict,
    ) -> str:
        system_prompt = self._build_system_prompt(
            npc_role, npc_personality, context,
            trust_score, escalation_level,
            trust_thresholds, escalation_thresholds,
        )

        messages: list[dict] = [
            {"role": "system", "content": system_prompt},
            {"role": "assistant", "content": opening_npc_line},
        ]

        for turn in session_turns:
            messages.append({"role": "user", "content": turn["user_input"]})
            messages.append({"role": "assistant", "content": turn["npc_response"]})

        messages.append({"role": "user", "content": user_input})

        completion = self._client.chat.completions.create(
            model=_MODEL,
            messages=messages,
        )
        return completion.choices[0].message.content.strip()
