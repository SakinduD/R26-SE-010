"""Train TF-IDF + Random Forest escalation classifier.

Run from Backend/:
    python -m app.api.v1.rpe.ml.train_escalation_model
"""
from __future__ import annotations

import os

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

_BASE = os.path.dirname(__file__)
_DATASET = os.path.join(_BASE, "dataset", "soft_skills_dataset.csv")
_MODELS_DIR = os.path.join(_BASE, "models")


def train() -> None:
    df = pd.read_csv(_DATASET)
    X = df["user_input"].astype(str)
    y = df["escalation_label"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    vectorizer = TfidfVectorizer(max_features=1000, ngram_range=(1, 2))
    X_train_vec = vectorizer.fit_transform(X_train)
    X_test_vec = vectorizer.transform(X_test)

    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X_train_vec, y_train)

    print(classification_report(y_test, model.predict(X_test_vec)))

    os.makedirs(_MODELS_DIR, exist_ok=True)
    joblib.dump(model, os.path.join(_MODELS_DIR, "escalation_model.pkl"))
    joblib.dump(vectorizer, os.path.join(_MODELS_DIR, "escalation_vectorizer.pkl"))
    print(f"Saved escalation_model.pkl and escalation_vectorizer.pkl → {_MODELS_DIR}")


if __name__ == "__main__":
    train()
