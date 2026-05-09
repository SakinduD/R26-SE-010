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

    def detect_emotion(self, user_input: str) -> str:
        if self._models_loaded:
            vec = self._emotion_vectorizer.transform([user_input])
            return str(self._emotion_model.predict(vec)[0])
        text = user_input.lower()
        for emotion, keywords in EMOTION_KEYWORDS.items():
            if any(kw in text for kw in keywords):
                return emotion
        return "calm"

    def update_trust(self, current_score: int, emotion: str) -> int:
        deltas: dict[str, int] = {
            "assertive": 2,
            "calm": 1,
            "confused": 0,
            "anxious": -1,
            "frustrated": -2,
        }
        return max(0, min(100, current_score + deltas.get(emotion, 0)))

    def update_escalation(self, current_level: int, emotion: str) -> int:
        deltas: dict[str, int] = {
            "frustrated": 2,
            "anxious": 1,
            "confused": 0,
            "calm": -1,
            "assertive": -1,
        }
        return max(0, min(5, current_level + deltas.get(emotion, 0)))
