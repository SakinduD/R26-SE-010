from pathlib import Path

import joblib

try:
    from transformers import (
        DistilBertTokenizerFast,
        DistilBertForSequenceClassification,
    )
    import torch
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False

BASE_DIR        = Path(__file__).resolve().parent.parent
MODELS_DIR      = BASE_DIR / "models" / "rpe" / "ml"
TRANSFORMER_DIR = MODELS_DIR / "transformer"

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
        self._transformer_model     = None
        self._transformer_tokenizer = None
        self._transformer_loaded    = False
        self._try_load_models()

    def _try_load_models(self) -> None:
        # sklearn models (escalation always uses these)
        try:
            self._emotion_model      = joblib.load(MODELS_DIR / "emotion_classifier.pkl")
            self._emotion_vectorizer = joblib.load(MODELS_DIR / "tfidf_vectorizer.pkl")
            self._escalation_model   = joblib.load(MODELS_DIR / "escalation_model.pkl")
            self._escalation_vectorizer = joblib.load(MODELS_DIR / "escalation_tfidf.pkl")
            self._models_loaded = True
        except FileNotFoundError:
            self._models_loaded = False

        # Transformer model (preferred for emotion detection)
        if TRANSFORMERS_AVAILABLE:
            try:
                self._transformer_tokenizer = \
                    DistilBertTokenizerFast.from_pretrained(str(TRANSFORMER_DIR))
                self._transformer_model = \
                    DistilBertForSequenceClassification.from_pretrained(
                        str(TRANSFORMER_DIR)
                    )
                self._transformer_model.eval()
                self._transformer_loaded = True
            except Exception:
                self._transformer_loaded = False

    def _is_profanity(self, text: str) -> bool:
        """True if text contains profanity/insults — must be pre-lowercased."""
        for word in PROFANITY_KEYWORDS:
            if word in text:
                return True
        for pattern in INSULT_PATTERNS:
            if pattern in text:
                return True
        return False

    def profanity_escalation_penalty(self, user_input: str) -> int:
        """Extra escalation penalty (+1) stacked on top of frustrated (+2) delta."""
        return 1 if self._is_profanity(user_input.lower()) else 0

    def detect_emotion(self, user_input: str) -> str:
        text = user_input.lower()

        # 1. Profanity always wins — never reaches any model
        if self._is_profanity(text):
            return "frustrated"

        # 1b. Calm keyword override — both ML models underperform on this class.
        # Skip if the keyword is negated (e.g. "do not understand").
        for kw in EMOTION_KEYWORDS.get("calm", []):
            if kw in text:
                negated = any(neg + kw in text for neg in ("not ", "n't ", "can't ", "cannot "))
                if not negated:
                    return "calm"

        # 2. Get transformer prediction if available
        transformer_pred = None
        if self._transformer_loaded:
            transformer_pred = self._predict_transformer(user_input)

        # 3. Get sklearn prediction if available
        sklearn_pred = None
        if self._models_loaded:
            vec          = self._emotion_vectorizer.transform([user_input])
            sklearn_pred = str(self._emotion_model.predict(vec)[0])

        # 4. Hybrid routing
        # Transformer F1 scores: anxious=0.81, confused=0.76
        # Sklearn F1 scores:     frustrated=1.00, assertive~0.78, calm~0.65
        if transformer_pred in ("anxious", "confused"):
            return transformer_pred    # transformer wins these classes
        if sklearn_pred is not None:
            return sklearn_pred        # sklearn wins calm/assertive/frustrated
        if transformer_pred is not None:
            return transformer_pred    # fallback to transformer
        return self._keyword_fallback(text)

    def _keyword_fallback(self, text: str) -> str:
        for emotion, keywords in EMOTION_KEYWORDS.items():
            if any(kw in text for kw in keywords):
                return emotion
        return "calm"

    def _predict_transformer(self, text: str) -> str:
        try:
            inputs = self._transformer_tokenizer(
                text, return_tensors="pt",
                truncation=True, max_length=128, padding=True,
            )
            with torch.no_grad():
                outputs = self._transformer_model(**inputs)
            pred_id = outputs.logits.argmax(-1).item()
            return self._transformer_model.config.id2label[pred_id]
        except Exception:
            if self._models_loaded:
                vec = self._emotion_vectorizer.transform([text])
                return str(self._emotion_model.predict(vec)[0])
            return "calm"

    @property
    def active_model(self) -> str:
        if self._transformer_loaded and self._models_loaded:
            return "hybrid (transformer: anxious/confused | sklearn: calm/assertive/frustrated)"
        if self._transformer_loaded:
            return "transformer (distilbert)"
        if self._models_loaded:
            return "sklearn (tfidf + lr)"
        return "keyword fallback"

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
