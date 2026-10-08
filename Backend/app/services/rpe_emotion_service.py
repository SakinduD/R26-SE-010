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
    Emotion classification (8-value: neutral | happy | surprised | frustrated |
    sad | skeptical | angry | thinking) is handled by rpe_llm_service, called
    from RpeNpcService.
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

    # emotion -> trust delta. Higher = the user is building trust with the NPC.
    _TRUST_DELTAS: dict[str, int] = {
        "happy":      2,
        "neutral":    0,
        "thinking":   0,
        "surprised": -1,
        "sad":       -1,
        "skeptical": -2,
        "frustrated": -3,
        "angry":      -4,
    }

    # emotion -> escalation delta. Negative = de-escalating, positive = tension rising.
    _ESCALATION_DELTAS: dict[str, int] = {
        "neutral":   -1,
        "happy":     -2,
        "thinking":   0,
        "surprised":  1,
        "sad":        1,
        "skeptical":  2,
        "frustrated": 3,
        "angry":      4,
    }

    def update_trust(
        self, current_score: int, emotion: str, user_input: str = ""
    ) -> int:
        # Profanity always penalises trust regardless of the emotion label
        if user_input and self._is_profanity(user_input.lower()):
            return max(0, min(100, current_score - 2))

        return max(0, min(100, current_score + self._TRUST_DELTAS.get(emotion, 0)))

    def update_escalation(self, current_level: int, emotion: str) -> int:
        return max(0, min(5, current_level + self._ESCALATION_DELTAS.get(emotion, 0)))
