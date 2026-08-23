from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

from app.schemas.analytics import FeedbackSentimentResult
from research.nlp_sentiment import transformer_reader
from research.nlp_sentiment.sentiment_baseline import load_model, predict_sentiment

logger = logging.getLogger(__name__)

_MODELS_DIR = (
    Path(__file__).resolve().parents[3] / "training" / "feedback_analytics" / "models"
)

# Tried in order; the first that loads is served. Both were measured on the same
# hand-labelled workplace validation set:
#
#     DistilBERT fine-tuned   accuracy 0.842   mixed F1 0.81   97% above the gate
#     Sentiment140 TF-IDF     accuracy 0.731   no mixed class  77% above the gate
#
# The fallback is not a lesser configuration to be embarrassed about - it is what
# keeps every other analytics endpoint working on a machine without torch, which
# is a 200MB dependency that a deployment may reasonably not want. What must not
# happen is the module silently serving the weaker model while reporting the
# stronger one, so the served version travels with every result.
MODEL_CANDIDATES = (
    _MODELS_DIR / "sentiment_distilbert",
    _MODELS_DIR / "sentiment_model.joblib",
)


class SentimentModelUnavailableError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _load_sentiment_artifact(model_path: str | None = None):
    """Returns (predict, metadata). Cached: loading a transformer takes seconds."""
    candidates = [Path(model_path)] if model_path else list(MODEL_CANDIDATES)
    failures: list[str] = []

    for candidate in candidates:
        if not candidate.exists():
            failures.append(f"{candidate}: not found")
            continue

        try:
            if transformer_reader.is_transformer_artifact(candidate):
                predict, metadata = transformer_reader.load_transformer(candidate)
            else:
                model, metadata = load_model(candidate)

                def predict(text: str, _model=model) -> dict:
                    return predict_sentiment(_model, text)

            logger.info(
                "Sentiment model loaded: %s (%s)",
                candidate.name,
                metadata.get("model_version", "unknown"),
            )
            return predict, metadata
        except Exception as exc:
            # One unloadable artifact must not hide a working one behind it.
            logger.warning("Could not load sentiment model %s: %s", candidate, exc)
            failures.append(f"{candidate}: {exc}")

    raise SentimentModelUnavailableError(
        "No sentiment model could be loaded. Tried:\n  " + "\n  ".join(failures)
    )


def analyze_feedback_text(text: str, model_path: str | Path | None = None) -> FeedbackSentimentResult:
    predict, metadata = _load_sentiment_artifact(str(model_path) if model_path else None)
    prediction = predict(text)

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
