class RpeBlindSpotService:
    def detect(
        self,
        turns: list[dict],
        success_criteria: dict,
    ) -> list[dict]:
        blind_spots: list[dict] = []
        blind_spots += self._low_trust_turns(turns, success_criteria)
        blind_spots += self._high_escalation_turns(turns, success_criteria)
        blind_spots += self._repeated_emotion_pattern(turns)
        blind_spots += self._missed_recovery_opportunities(turns)
        return blind_spots

    def _low_trust_turns(
        self, turns: list[dict], success_criteria: dict
    ) -> list[dict]:
        min_trust = success_criteria.get("min_trust_score", 40)
        low_turns = [t["turn"] for t in turns if t["trust_score"] < min_trust]
        if not low_turns:
            return []
        return [{
            "blind_spot_type": "low_trust_turns",
            "description":     f"Trust was below the minimum threshold ({min_trust}) on turns: {low_turns}.",
            "affected_turns":  low_turns,
            "recommendation":  "Use empathetic and assertive language in early turns to build trust faster.",
        }]

    def _high_escalation_turns(
        self, turns: list[dict], success_criteria: dict
    ) -> list[dict]:
        max_esc    = success_criteria.get("max_escalation_level", 2)
        high_turns = [t["turn"] for t in turns if t["escalation_level"] > max_esc]
        if not high_turns:
            return []
        return [{
            "blind_spot_type": "high_escalation_turns",
            "description":     f"Escalation exceeded the safe threshold ({max_esc}) on turns: {high_turns}.",
            "affected_turns":  high_turns,
            "recommendation":  "Avoid reactive language. Acknowledge the NPC's frustration before stating your position.",
        }]

    def _repeated_emotion_pattern(self, turns: list[dict]) -> list[dict]:
        if not turns:
            return []
        negative: set[str] = {"frustrated", "anxious"}
        emotion_counts: dict[str, int] = {}
        for t in turns:
            e = t["emotion"]
            emotion_counts[e] = emotion_counts.get(e, 0) + 1
        for emotion, count in emotion_counts.items():
            if emotion in negative and count / len(turns) >= 0.5:
                return [{
                    "blind_spot_type": "dominant_negative_emotion",
                    "description":     f"'{emotion}' was your dominant emotion in {count}/{len(turns)} turns.",
                    "affected_turns":  [t["turn"] for t in turns if t["emotion"] == emotion],
                    "recommendation":  f"Practice reframing '{emotion}' responses into calm or assertive ones before replying.",
                }]
        return []

    def _missed_recovery_opportunities(self, turns: list[dict]) -> list[dict]:
        missed: list[int] = []
        for i in range(len(turns) - 1):
            current = turns[i]
            next_t  = turns[i + 1]
            if (current["escalation_level"] >= 3
                    and next_t["escalation_level"] >= current["escalation_level"]):
                missed.append(next_t["turn"])
        if not missed:
            return []
        return [{
            "blind_spot_type": "missed_recovery",
            "description":     f"Escalation stayed high or rose further after turns: {missed}. These were recovery opportunities.",
            "affected_turns":  missed,
            "recommendation":  "When escalation is high, immediately shift to calm and empathetic language to recover.",
        }]
