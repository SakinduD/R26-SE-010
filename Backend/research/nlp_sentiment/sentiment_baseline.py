"""Sentiment reading for stored feedback — the serving half of the NLP module.

Only what the application needs at request time lives here: the text cleaner, the
artifact loader, and the prediction call. Training the artifact is a separate
concern and lives with the datasets it consumes, in
``training/feedback_analytics/sentiment/``.

The split matters in one direction: the trainer imports ``clean_feedback_text``
from this module rather than keeping its own copy, so the text a model is trained
on is prepared by exactly the code that will prepare the text it is later asked
about.
"""

from __future__ import annotations

import html
import re
from pathlib import Path

import joblib
from sklearn.pipeline import Pipeline

SENTIMENT_LABELS = {
    0: "negative",
    2: "neutral",
    4: "positive",
}

LABEL_TO_TARGET = {label: target for target, label in SENTIMENT_LABELS.items()}

URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", flags=re.IGNORECASE)
MENTION_PATTERN = re.compile(r"@\w+")
NON_TEXT_PATTERN = re.compile(r"[^a-zA-Z0-9\s!?.,']")
WHITESPACE_PATTERN = re.compile(r"\s+")


def clean_feedback_text(text: str) -> str:
    """Normalize informal feedback text without removing useful sentiment cues."""
    normalized = (text or "").replace("&amp;", " and ")
    normalized = html.unescape(normalized).lower()
    normalized = URL_PATTERN.sub(" url ", normalized)
    normalized = MENTION_PATTERN.sub(" user ", normalized)
    normalized = NON_TEXT_PATTERN.sub(" ", normalized)
    normalized = WHITESPACE_PATTERN.sub(" ", normalized)
    return normalized.strip()


def predict_sentiment(model: Pipeline, text: str) -> dict:
    cleaned = clean_feedback_text(text)
    probabilities = model.predict_proba([cleaned])[0]
    classes = list(model.classes_)
    best_index = int(probabilities.argmax())
    label = classes[best_index]
    confidence = float(probabilities[best_index])

    # A signed score for callers that want direction rather than a class.
    # "mixed" scores zero like "neutral", but for a different reason: neutral
    # text carries no judgement, mixed text carries two that cancel. Both are
    # equally wrong to treat as leaning one way.
    sentiment_score = {
        "negative": -confidence,
        "neutral": 0.0,
        "mixed": 0.0,
        "positive": confidence,
    }.get(label, 0.0)

    return {
        "text": text,
        "cleaned_text": cleaned,
        "sentiment": label,
        "confidence": round(confidence, 4),
        "sentiment_score": round(sentiment_score, 4),
        "class_probabilities": {
            sentiment_class: round(float(probability), 4)
            for sentiment_class, probability in zip(classes, probabilities)
        },
    }


def load_model(model_path: str | Path) -> tuple[Pipeline, dict]:
    artifact = joblib.load(model_path)
    return artifact["model"], artifact.get("metadata", {})
