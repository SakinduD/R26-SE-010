from pathlib import Path

import joblib

BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models" / "rpe" / "ml"

EMOTION_KEYWORDS: dict[str, list[str]] = {
    "frustrated": [
        "unfair", "ridiculous", "hate", "angry", "sick of",
        "fed up", "not fair", "always", "never",
    ],
    "anxious": [
        "worried", "nervous", "scared", "not sure", "what if",
        "mess up", "afraid", "can't do",
    ],
    "assertive": [
        "propose", "suggest", "deliver", "need", "require",
        "will", "can do", "plan", "solution",
    ],
    "calm": [
        "understand", "okay", "sure", "alright", "happy to",
        "of course", "no problem", "appreciate",
    ],
}

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
    def __init__(self) -> None:
        self._emotion_model = None
        self._emotion_vectorizer = None
        self._escalation_model = None
        self._escalation_vectorizer = None
        self._models_loaded = False
        self._try_load_models()

    def _try_load_models(self) -> None:
        try:
            self._emotion_model = joblib.load(MODELS_DIR / "emotion_classifier.pkl")
            self._emotion_vectorizer = joblib.load(MODELS_DIR / "tfidf_vectorizer.pkl")
            self._escalation_model = joblib.load(MODELS_DIR / "escalation_model.pkl")
            self._escalation_vectorizer = joblib.load(MODELS_DIR / "escalation_tfidf.pkl")
            self._models_loaded = True
        except FileNotFoundError:
            self._models_loaded = False

    # ── Profanity helpers ─────────────────────────────────────────────────────

    def _is_profanity(self, text: str) -> bool:
        """
        Returns True if the input contains profanity or direct insults.
        Called before the ML model to override any misclassification of
        abusive language as assertive or calm.
        """
        for word in PROFANITY_KEYWORDS:
            if word in text:
                return True
        for pattern in INSULT_PATTERNS:
            if pattern in text:
                return True
        return False

    def profanity_escalation_penalty(self, user_input: str) -> int:
        """
        Returns extra escalation points if profanity is detected.
        Called after update_escalation() to stack an additional +1
        on top of the normal frustrated (+2) delta — total +3.
        Normal escalation (frustrated): +2
        With profanity:                 +1 extra (total +3 possible)
        """
        text = user_input.lower()
        if self._is_profanity(text):
            return 1
        return 0

    # ── Core emotion / trust / escalation ────────────────────────────────────

    def detect_emotion(self, user_input: str) -> str:
        text = user_input.lower()

        # Check profanity FIRST — overrides ML model and keyword fallback
        if self._is_profanity(text):
            return "frustrated"

        # ML model if loaded
        if self._models_loaded:
            vec = self._emotion_vectorizer.transform([user_input])
            return str(self._emotion_model.predict(vec)[0])

        # Keyword fallback
        for emotion, keywords in EMOTION_KEYWORDS.items():
            if any(kw in text for kw in keywords):
                return emotion
        return "calm"

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
