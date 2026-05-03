"""Train a TF-IDF + Random Forest escalation classifier for RPE.

Run from project root:
    python training/rpe/train_escalation_model.py
"""

from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

DATASET_PATH = Path(__file__).parent / "dataset" / "soft_skills_dataset.csv"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "Backend" / "app" / "models" / "rpe" / "ml"


def main() -> None:
    df = pd.read_csv(DATASET_PATH)

    X = df["user_input"].astype(str)
    y = df["escalation_label"].astype(int)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    vectorizer = TfidfVectorizer(max_features=3000, ngram_range=(1, 2))
    X_train_vec = vectorizer.fit_transform(X_train)
    X_test_vec = vectorizer.transform(X_test)

    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X_train_vec, y_train)

    y_pred = model.predict(X_test_vec)
    print("=== Escalation Model ===")
    print(classification_report(y_test, y_pred))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, OUTPUT_DIR / "escalation_model.pkl")
    joblib.dump(vectorizer, OUTPUT_DIR / "escalation_tfidf.pkl")
    print(f"Saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
