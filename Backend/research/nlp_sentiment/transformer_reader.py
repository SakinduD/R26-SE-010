"""Read sentiment with a fine-tuned transformer, for the running application.

Why this exists beside the classical reader
-------------------------------------------
Both were measured on the same hand-labelled workplace set:

    Sentiment140 TF-IDF     accuracy 0.731   no mixed class   97% of readings usable
    DistilBERT fine-tuned   accuracy 0.842   mixed F1 0.81    97% of readings usable

The gap is not incremental. The classical model reads "I did not rush a single
answer" as negative at 0.86 confidence, because TF-IDF counts words and cannot
let one change the meaning of the next. It also has nowhere to put "I perform
well but I don't have enough time", which is the shape of nearly every reflection
learners actually write.

Torch is imported lazily. It is a heavy dependency and the application must still
start, and still serve every other analytics endpoint, on a machine where it is
absent - so a failure to load lands as SentimentModelUnavailableError, the same
error the caller already handles, rather than an import error at startup.

Text is cleaned with the same function the training pipeline used. A model must
be asked about text prepared exactly the way its training text was prepared.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from research.nlp_sentiment.sentiment_baseline import clean_feedback_text

logger = logging.getLogger(__name__)

# Longer than any reflection this system collects; the fine-tuned model was
# trained at this window and reading beyond it would be extrapolation.
MAX_LENGTH = 64

# Signed direction for callers that want one. "mixed" scores zero like "neutral"
# but for the opposite reason: neutral text carries no judgement, mixed text
# carries two that cancel.
SENTIMENT_DIRECTION = {
    "negative": -1.0,
    "neutral": 0.0,
    "mixed": 0.0,
    "positive": 1.0,
}


def is_transformer_artifact(path: str | Path) -> bool:
    """A saved transformer is a directory with a config; a classical model is a file."""
    candidate = Path(path)
    return candidate.is_dir() and (candidate / "config.json").exists()


def load_transformer(model_path: str | Path):
    """Returns (predict, metadata). Raises if torch or the artifact is unavailable."""
    path = Path(model_path)
    try:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise RuntimeError(
            "torch and transformers are required to serve the fine-tuned sentiment "
            f"model at {path}. Install them, or point the service at the classical "
            "joblib artifact instead."
        ) from exc

    tokenizer = AutoTokenizer.from_pretrained(str(path))
    model = AutoModelForSequenceClassification.from_pretrained(str(path))
    model.eval()

    id_to_label = {index: str(name).lower() for index, name in model.config.id2label.items()}

    metadata = {
        "model_version": path.name,
        "model_type": type(model).__name__,
        "labels": sorted(id_to_label.values()),
    }
    metadata_file = path / "training_metadata.json"
    if metadata_file.exists():
        try:
            metadata.update(json.loads(metadata_file.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            logger.warning("Could not read %s; using defaults", metadata_file)

    def predict(text: str) -> dict:
        cleaned = clean_feedback_text(text)
        encoded = tokenizer(
            cleaned,
            return_tensors="pt",
            truncation=True,
            max_length=MAX_LENGTH,
        )
        with torch.no_grad():
            logits = model(**encoded).logits[0]
        probabilities = torch.softmax(logits, dim=-1)

        best = int(probabilities.argmax())
        label = id_to_label[best]
        confidence = float(probabilities[best])

        return {
            "text": text,
            "cleaned_text": cleaned,
            "sentiment": label,
            "confidence": round(confidence, 4),
            "sentiment_score": round(
                SENTIMENT_DIRECTION.get(label, 0.0) * confidence, 4
            ),
            "class_probabilities": {
                id_to_label[index]: round(float(probability), 4)
                for index, probability in enumerate(probabilities)
            },
        }

    return predict, metadata
