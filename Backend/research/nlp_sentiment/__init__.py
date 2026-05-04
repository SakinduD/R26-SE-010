"""NLP sentiment analysis research pipeline."""

from research.nlp_sentiment.sentiment_baseline import (
    SENTIMENT_LABELS,
    clean_feedback_text,
    evaluate_sentiment_model,
    load_sentiment140,
    predict_sentiment,
    train_sentiment_model,
)

__all__ = [
    "SENTIMENT_LABELS",
    "clean_feedback_text",
    "evaluate_sentiment_model",
    "load_sentiment140",
    "predict_sentiment",
    "train_sentiment_model",
]
