"""Sentiment reading used by the running application.

The training pipeline that produces the artifact this module loads lives in
``training/feedback_analytics/sentiment/``, beside its datasets.
"""

from research.nlp_sentiment.sentiment_baseline import (
    SENTIMENT_LABELS,
    clean_feedback_text,
    load_model,
    predict_sentiment,
)

__all__ = [
    "SENTIMENT_LABELS",
    "clean_feedback_text",
    "load_model",
    "predict_sentiment",
]
