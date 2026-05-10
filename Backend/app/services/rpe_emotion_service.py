PROFANITY_KEYWORDS: list[str] = [
    "fuck", "fk", "fck", "shit", "bitch", "bastard",
    "asshole", "idiot", "stupid", "moron", "dumb",
    "shut up", "screw you", "go to hell", "piss off",
    "damn you", "hate you", "loser", "monkey", "freak",
    "jerk", "dickhead", "scumbag", "pathetic", "useless",
]

INSULT_PATTERNS: list[str] = [
    "you are a", "you're a", "you talk like",
    "what a", "you piece", "get lost", "drop dead",
]


class RpeEmotionService:
    """
    Profanity detection + trust/escalation math.
    Emotion classification is handled by Groq inside RpeNpcService.
    """

    def _is_profanity(self, text: str) -> bool:
        """True if text contains profanity/insults — must be pre-lowercased."""
        for word in PROFANITY_KEYWORDS:
            if word in text:
                return True
        for pattern in INSULT_PATTERNS:
            if pattern in text:
                return True
        return False

    def is_profanity(self, user_input: str) -> bool:
        """Public wrapper — accepts any casing."""
        return self._is_profanity(user_input.lower())

    def profanity_escalation_penalty(self, user_input: str) -> int:
        """Extra escalation penalty (+1) stacked on top of frustrated (+2) delta."""
        return 1 if self._is_profanity(user_input.lower()) else 0

    def update_trust(
        self, current_score: int, emotion: str, user_input: str = ""
    ) -> int:
        # Profanity always penalises trust regardless of the emotion label
        if user_input and self._is_profanity(user_input.lower()):
            return max(0, min(100, current_score - 2))

        deltas: dict[str, int] = {
            "assertive":  2,
            "calm":       1,
            "confused":   0,
            "anxious":   -1,
            "frustrated": -2,
        }
        return max(0, min(100, current_score + deltas.get(emotion, 0)))

    def update_escalation(self, current_level: int, emotion: str) -> int:
        deltas: dict[str, int] = {
            "frustrated":  2,
            "anxious":     1,
            "confused":    0,
            "calm":       -1,
            "assertive":  -1,
        }
        return max(0, min(5, current_level + deltas.get(emotion, 0)))
