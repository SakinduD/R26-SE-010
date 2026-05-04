from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import joblib

FEATURE_COLUMNS = [
    "current_score",
    "previous_score",
    "trend_slope",
    "average_feedback_rating",
    "sentiment_score",
    "blind_spot_count",
    "session_count",
    "engagement_score",
]

DEFAULT_MODEL_PATH = (
    Path(__file__).resolve().parents[3]
    / "training"
    / "feedback_analytics"
    / "models"
    / "predictive_behavior_model.joblib"
)


class PredictiveModelUnavailableError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _load_predictive_artifact(model_path: str | Path = DEFAULT_MODEL_PATH):
    path = Path(model_path)
    if not path.exists():
        raise PredictiveModelUnavailableError(
            f"Predictive model artifact not found at {path}. Train the ML prediction model first."
        )
    return joblib.load(path)


def predict_behavioral_outcome(features: dict[str, float], model_path: str | Path = DEFAULT_MODEL_PATH) -> dict:
    artifact = _load_predictive_artifact(str(model_path))
    vector = [[float(features[column]) for column in FEATURE_COLUMNS]]

    predicted_score = float(artifact["regressor"].predict(vector)[0])
    predicted_class = int(artifact["classifier"].predict(vector)[0])
    risk_level = str(artifact["label_encoder"].inverse_transform([predicted_class])[0])

    confidence = 0.5
    if hasattr(artifact["classifier"], "predict_proba"):
        probabilities = artifact["classifier"].predict_proba(vector)[0]
        confidence = float(max(probabilities))

    return {
        "predicted_score": round(max(0.0, min(100.0, predicted_score)), 2),
        "risk_level": risk_level,
        "confidence": round(confidence, 2),
        "model_version": artifact.get("metadata", {}).get("model_version", "unknown-ml-predictive-model"),
        "model_type": {
            "regressor": artifact.get("metadata", {}).get("selected_regressor", "unknown"),
            "classifier": artifact.get("metadata", {}).get("selected_classifier", "unknown"),
        },
    }


def clear_predictive_model_cache() -> None:
    _load_predictive_artifact.cache_clear()
