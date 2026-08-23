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


def _clamped_vector(features: dict[str, float], artifact: dict) -> list[float]:
    """Feature values held inside the range the model was trained on.

    Three of these grow without bound as somebody keeps using the platform:
    session_count, blind_spot_count, and engagement_score (which is itself
    derived from the first). The training data spans 2-5 sessions and 0-2 blind
    spots, so every learner eventually walks off the edge of it.

    What that costs is not subtle. At 85 sessions and 5 blind spots this
    learner's inputs sat 79 and 7.6 standard deviations outside the training
    mean, and those two features alone pulled 36 points off the prediction -
    against a real signal of a few points from the scores themselves. The model
    was answering a question about a learner it had never seen the like of.

    Clamping keeps it answering the question it can. Somebody with 85 sessions is
    treated as the most experienced learner in the training data rather than as
    an extrapolation, which is both more useful and more honest than the
    alternative.
    """
    ranges = (artifact.get("metadata") or {}).get("feature_ranges") or {}
    vector = []
    for column in FEATURE_COLUMNS:
        value = float(features[column])
        bounds = ranges.get(column)
        if bounds:
            value = max(float(bounds["min"]), min(float(bounds["max"]), value))
        vector.append(value)
    return vector


def _out_of_range_features(features: dict[str, float], artifact: dict) -> list[str]:
    """Which inputs had to be pulled in. Recorded so this is visible, not silent."""
    ranges = (artifact.get("metadata") or {}).get("feature_ranges") or {}
    clamped = []
    for column in FEATURE_COLUMNS:
        bounds = ranges.get(column)
        if not bounds:
            continue
        value = float(features[column])
        if value < float(bounds["min"]) or value > float(bounds["max"]):
            clamped.append(column)
    return clamped


def predict_behavioral_outcome(features: dict[str, float], model_path: str | Path = DEFAULT_MODEL_PATH) -> dict:
    artifact = _load_predictive_artifact(str(model_path))
    vector = [_clamped_vector(features, artifact)]

    predicted_score = float(artifact["regressor"].predict(vector)[0])
    predicted_class = int(artifact["classifier"].predict(vector)[0])
    risk_level = str(artifact["label_encoder"].inverse_transform([predicted_class])[0])

    confidence = 0.5
    if hasattr(artifact["classifier"], "predict_proba"):
        probabilities = artifact["classifier"].predict_proba(vector)[0]
        confidence = float(max(probabilities))

    return {
        "predicted_score": round(max(0.0, min(100.0, predicted_score)), 2),
        "clamped_features": _out_of_range_features(features, artifact),
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
