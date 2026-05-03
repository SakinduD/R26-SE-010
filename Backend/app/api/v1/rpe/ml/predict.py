from __future__ import annotations

import os

import joblib

_MODELS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "models"))

_emotion_model = None
_emotion_vectorizer = None
_escalation_model = None
_escalation_vectorizer = None


def _load() -> None:
    global _emotion_model, _emotion_vectorizer, _escalation_model, _escalation_vectorizer

    em_path = os.path.join(_MODELS_DIR, "emotion_classifier.pkl")
    em_vec_path = os.path.join(_MODELS_DIR, "tfidf_vectorizer.pkl")
    esc_path = os.path.join(_MODELS_DIR, "escalation_model.pkl")
    esc_vec_path = os.path.join(_MODELS_DIR, "escalation_vectorizer.pkl")

    if os.path.exists(em_path) and os.path.exists(em_vec_path):
        _emotion_model = joblib.load(em_path)
        _emotion_vectorizer = joblib.load(em_vec_path)

    if os.path.exists(esc_path) and os.path.exists(esc_vec_path):
        _escalation_model = joblib.load(esc_path)
        _escalation_vectorizer = joblib.load(esc_vec_path)


_load()


def predict_emotion(text: str) -> str | None:
    if _emotion_model is None or _emotion_vectorizer is None:
        return None
    features = _emotion_vectorizer.transform([text])
    return str(_emotion_model.predict(features)[0])


def predict_escalation(text: str) -> int | None:
    if _escalation_model is None or _escalation_vectorizer is None:
        return None
    features = _escalation_vectorizer.transform([text])
    return int(_escalation_model.predict(features)[0])
