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
        span = "most of the conversation" if len(low_turns) > len(turns) / 2 else "part of the conversation"
        return [{
            "blind_spot_type": "low_trust_turns",
            "description":     f"Trust never reached a comfortable level for {span}.",
            "affected_turns":  low_turns,
            "recommendation":  "Warmer, more confident language early on tends to build trust faster.",
        }]

    def _high_escalation_turns(
        self, turns: list[dict], success_criteria: dict
    ) -> list[dict]:
        max_esc    = success_criteria.get("max_escalation_level", 2)
        high_turns = [t["turn"] for t in turns if t["escalation_level"] > max_esc]
        if not high_turns:
            return []
        span = "most of the conversation" if len(high_turns) > len(turns) / 2 else "part of the conversation"
        return [{
            "blind_spot_type": "high_escalation_turns",
            "description":     f"Tension stayed high for {span}.",
            "affected_turns":  high_turns,
            "recommendation":  "Acknowledge how the other person is feeling before making your own point.",
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
                    "description":     f"You came across as {emotion} for most of the conversation.",
                    "affected_turns":  [t["turn"] for t in turns if t["emotion"] == emotion],
                    "recommendation":  f"Try catching a {emotion} reply before you send it and reframing it as calm or assertive instead.",
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
            "description":     "A few times when tension was already high, the reply that followed didn't bring it back down.",
            "affected_turns":  missed,
            "recommendation":  "When tension is high, shift to calmer, more understanding language to bring it back down before pressing your point.",
        }]
