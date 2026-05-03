"""Train a TF-IDF + Logistic Regression emotion classifier for RPE.

Run from project root:
    python training/rpe/train_emotion_classifier.py
"""

from pathlib import Path

import joblib
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

DATASET_PATH = Path(__file__).parent / "dataset" / "soft_skills_dataset.csv"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "Backend" / "app" / "models" / "rpe" / "ml"


def main() -> None:
    df = pd.read_csv(DATASET_PATH)
    df = df.dropna(subset=["user_input", "emotion_label"])

    X = df["user_input"].astype(str)
    y = df["emotion_label"].astype(str)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    vectorizer = TfidfVectorizer(max_features=3000, ngram_range=(1, 2))
    X_train_vec = vectorizer.fit_transform(X_train)
    X_test_vec = vectorizer.transform(X_test)

    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X_train_vec, y_train)

    y_pred = model.predict(X_test_vec)
    score = model.score(X_test_vec, y_test)
    print(f"Emotion classifier accuracy: {score:.4f}")
    print(classification_report(y_test, y_pred))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, OUTPUT_DIR / "emotion_classifier.pkl")
    joblib.dump(vectorizer, OUTPUT_DIR / "tfidf_vectorizer.pkl")
    print(f"Saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
