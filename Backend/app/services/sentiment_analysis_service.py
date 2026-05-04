from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from app.schemas.analytics import FeedbackSentimentResult
from research.nlp_sentiment.sentiment_baseline import load_model, predict_sentiment

DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[2] / "research" / "models" / "sentiment_model.joblib"


class SentimentModelUnavailableError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _load_sentiment_artifact(model_path: str | Path = DEFAULT_MODEL_PATH):
    path = Path(model_path)
    if not path.exists():
        raise SentimentModelUnavailableError(
            f"Sentiment model artifact not found at {path}. Train Phase 1 first."
        )
    return load_model(path)


def analyze_feedback_text(text: str, model_path: str | Path = DEFAULT_MODEL_PATH) -> FeedbackSentimentResult:
    model, metadata = _load_sentiment_artifact(str(model_path))
    prediction = predict_sentiment(model, text)

    return FeedbackSentimentResult(
        text=prediction["text"],
        cleaned_text=prediction["cleaned_text"],
        sentiment=prediction["sentiment"],
        confidence=prediction["confidence"],
        sentiment_score=prediction["sentiment_score"],
        class_probabilities=prediction["class_probabilities"],
        model_version=metadata.get("model_version", "unknown-sentiment-model"),
        model_type=metadata.get("model_type", "unknown"),
        source="ml_model",
    )


def clear_sentiment_model_cache() -> None:
    _load_sentiment_artifact.cache_clear()
