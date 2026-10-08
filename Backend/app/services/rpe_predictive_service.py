class RpePredictiveService:
    def detect_risk_patterns(
        self,
        turns: list[dict],
        trust_history: list[int],
        emotion_history: list[str],
    ) -> list[dict]:
        flags: list[dict] = []
        flags += self._check_trust_plateau(trust_history)
        flags += self._check_escalation_spikes(turns)
        flags += self._check_passive_streak(emotion_history, turns)
        flags += self._check_trust_collapse(trust_history)
        flags += self._check_emotional_volatility(emotion_history)
        return flags

    def _check_trust_plateau(self, trust_history: list[int]) -> list[dict]:
        for i in range(2, len(trust_history)):
            window = trust_history[i - 2 : i + 1]
            if max(window) - min(window) <= 2:
                return [{
                    "flag_type":      "trust_plateau",
                    "severity":       "medium",
                    "description":    "Trust stopped growing for a few turns in a row — whatever you tried there wasn't landing. Worth changing your approach.",
                    "affected_turns": [i - 1, i, i + 1],
                }]
        return []

    def _check_escalation_spikes(self, turns: list[dict]) -> list[dict]:
        flags: list[dict] = []
        levels = [t["escalation_level"] for t in turns]
        for i in range(1, len(levels)):
            if levels[i] - levels[i - 1] >= 2:
                flags.append({
                    "flag_type":      "escalation_spike",
                    "severity":       "high",
                    "description":    "Tension jumped suddenly partway through — something in that reply caught the other person off guard.",
                    "affected_turns": [i + 1],
                })
        return flags

    def _check_passive_streak(
        self, emotion_history: list[str], turns: list[dict]
    ) -> list[dict]:
        passive = {"anxious", "confused"}
        streak  = 0
        start   = 0
        for i, emotion in enumerate(emotion_history[1:], 1):
            if emotion in passive:
                if streak == 0:
                    start = i
                streak += 1
            else:
                streak = 0
            if streak >= 3:
                return [{
                    "flag_type":      "passive_streak",
                    "severity":       "high",
                    "description":    "You held back for several turns in a row. Speaking up earlier and more directly tends to land better.",
                    "affected_turns": list(range(start, start + streak)),
                }]
        return []

    def _check_trust_collapse(self, trust_history: list[int]) -> list[dict]:
        for i in range(1, len(trust_history)):
            if trust_history[i - 1] - trust_history[i] >= 10:
                return [{
                    "flag_type":      "trust_collapse",
                    "severity":       "high",
                    "description":    "Trust dropped suddenly at one point — worth thinking back on what triggered that reaction.",
                    "affected_turns": [i, i + 1],
                }]
        return []

    def _check_emotional_volatility(self, emotion_history: list[str]) -> list[dict]:
        if len(emotion_history) < 4:
            return []
        changes = sum(
            1 for i in range(1, len(emotion_history))
            if emotion_history[i] != emotion_history[i - 1]
        )
        ratio = changes / (len(emotion_history) - 1)
        if ratio >= 0.85:
            return [{
                "flag_type":      "emotional_volatility",
                "severity":       "medium",
                "description":    "Your tone shifted almost every turn. A steadier, more consistent approach tends to build trust faster.",
                "affected_turns": [],
            }]
        return []
