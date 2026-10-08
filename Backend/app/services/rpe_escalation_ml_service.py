from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

import joblib

logger = logging.getLogger(__name__)

_MODEL_DIR = Path(__file__).resolve().parent.parent / "models" / "rpe" / "ml"
_MODEL_PATH = _MODEL_DIR / "escalation_model.pkl"
_VECTORIZER_PATH = _MODEL_DIR / "escalation_tfidf.pkl"

# Trained by training/rpe/train_escalation_model.py: TF-IDF + RandomForest on a
# 275-row synthetic dataset, labels 0/1/2 — a coarser 3-point scale than RPE's
# live 0-5 escalation_level, and never benchmarked against a held-out set
# beyond a print-only classification_report at train time. Advisory only: this
# service is never allowed to affect trust_score/escalation_level or any
# session-end/blind-spot/predictive logic that reads them — it only surfaces
# a secondary signal alongside the LLM-driven emotion on each turn.
MODEL_VERSION = "escalation_rf_v1"


@lru_cache(maxsize=1)
def _load_model():
    """Returns (model, vectorizer), or None if the artifacts are missing/unloadable.

    Cached: joblib.load has real I/O cost, and this fires on every turn.
    """
    if not _MODEL_PATH.exists() or not _VECTORIZER_PATH.exists():
        logger.warning(
            "RPE escalation ML model not found at %s — advisory signal disabled.",
            _MODEL_DIR,
        )
        return None
    try:
        model = joblib.load(_MODEL_PATH)
        vectorizer = joblib.load(_VECTORIZER_PATH)
        return model, vectorizer
    except Exception as exc:
        logger.warning("Could not load RPE escalation ML model: %s", exc)
        return None


def predict_escalation(text: str) -> dict | None:
    """
    Best-effort advisory escalation read on a single user turn.

    Returns {"label": int (0-2), "confidence": float, "model_version": str},
    or None if the model is unavailable or prediction fails for any reason —
    callers must treat this as optional and never let its absence or failure
    interrupt the live turn.
    """
    loaded = _load_model()
    if loaded is None:
        return None

    model, vectorizer = loaded
    try:
        features = vectorizer.transform([text])
        label = int(model.predict(features)[0])
        proba = model.predict_proba(features)[0]
        confidence = float(max(proba))
        return {
            "label": label,
            "confidence": round(confidence, 4),
            "model_version": MODEL_VERSION,
        }
    except Exception as exc:
        logger.warning("RPE escalation ML prediction failed: %s", exc)
        return None
