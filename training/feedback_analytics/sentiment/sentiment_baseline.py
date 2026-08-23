"""Sentiment140 training pipeline for the Feedback Analytics component.

Lives here, beside the datasets and artifacts it reads and writes, so that every
training entry point for this component sits under ``training/`` like the rest of
the team's.

Text cleaning is deliberately NOT redefined here. It is imported from the
application, which is the copy that will clean the learner's reflections at
prediction time. A model must be asked about text prepared exactly the way its
training text was prepared; two copies of that logic drift the moment one is
edited, and the model then degrades silently — still returning confident answers,
just about text it no longer recognises.
"""

from __future__ import annotations

import csv
import sys
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import joblib
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, precision_recall_fscore_support
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

# The application is not installed as a package, so make its module tree
# importable for the one symbol shared between training and serving.
_BACKEND = Path(__file__).resolve().parents[3] / "Backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from research.nlp_sentiment.sentiment_baseline import (  # noqa: E402
    SENTIMENT_LABELS,
    clean_feedback_text,
    predict_sentiment,
)

__all__ = [
    "SENTIMENT_LABELS",
    "SentimentDataset",
    "build_classifier",
    "clean_feedback_text",
    "evaluate_sentiment_model",
    "load_sentiment140",
    "model_display_name",
    "predict_sentiment",
    "save_model",
    "save_processed_dataset",
    "train_sentiment_model",
]


@dataclass(frozen=True)
class SentimentDataset:
    texts: list[str]
    labels: list[str]
    preprocessing_summary: dict[str, int | bool]

    @property
    def label_distribution(self) -> dict[str, int]:
        return dict(Counter(self.labels))


def load_sentiment140(
    dataset_path: str | Path,
    limit: int | None = None,
    limit_per_class: int | None = None,
    min_text_length: int = 3,
    remove_duplicates: bool = True,
    output_processed_path: str | Path | None = None,
) -> SentimentDataset:
    """Load Sentiment140 CSV rows and map numeric labels to sentiment names.

    Sentiment140 commonly ships without a header using this column order:
    target, id, date, flag, user, text
    """
    path = Path(dataset_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found: {path}. Place the Sentiment140 CSV at this path first."
        )

    texts: list[str] = []
    labels: list[str] = []
    class_counts: Counter[str] = Counter()
    seen_cleaned_texts: set[str] = set()
    raw_rows = 0
    invalid_rows = 0
    empty_rows = 0
    short_rows = 0
    duplicate_rows = 0

    with path.open("r", encoding="latin-1", newline="") as file:
        reader = csv.reader(file)
        for row in reader:
            raw_rows += 1
            if not row or row[0].lower() == "target":
                continue
            if len(row) < 6:
                invalid_rows += 1
                continue

            try:
                target = int(row[0])
            except ValueError:
                invalid_rows += 1
                continue

            label = SENTIMENT_LABELS.get(target)
            if label is None:
                invalid_rows += 1
                continue
            if limit_per_class is not None and class_counts[label] >= limit_per_class:
                if _all_requested_classes_loaded(class_counts, limit_per_class):
                    break
                continue

            cleaned = clean_feedback_text(row[5])
            if not cleaned:
                empty_rows += 1
                continue
            if len(cleaned) < min_text_length:
                short_rows += 1
                continue
            if remove_duplicates and cleaned in seen_cleaned_texts:
                duplicate_rows += 1
                continue

            texts.append(cleaned)
            labels.append(label)
            seen_cleaned_texts.add(cleaned)
            class_counts[label] += 1

            if limit is not None and len(texts) >= limit:
                break

    if len(set(labels)) < 2:
        raise ValueError("At least two sentiment classes are required to train the baseline model.")

    summary = {
        "raw_rows_scanned": raw_rows,
        "valid_rows_used": len(texts),
        "invalid_rows_skipped": invalid_rows,
        "empty_rows_skipped": empty_rows,
        "short_rows_skipped": short_rows,
        "duplicate_rows_skipped": duplicate_rows,
        "remove_duplicates": remove_duplicates,
        "min_text_length": min_text_length,
    }

    if output_processed_path is not None:
        save_processed_dataset(output_processed_path, texts, labels)

    return SentimentDataset(texts=texts, labels=labels, preprocessing_summary=summary)


def save_processed_dataset(output_path: str | Path, texts: list[str], labels: list[str]) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["label", "cleaned_text"])
        writer.writerows(zip(labels, texts))


def _all_requested_classes_loaded(class_counts: Counter[str], limit_per_class: int) -> bool:
    available_sentiment140_classes = ("negative", "positive")
    return all(class_counts[label] >= limit_per_class for label in available_sentiment140_classes)


def train_sentiment_model(
    dataset: SentimentDataset,
    *,
    classifier_name: str = "logistic_regression",
    max_features: int = 50_000,
    test_size: float = 0.2,
    random_state: int = 42,
) -> tuple[Pipeline, dict]:
    """Train TF-IDF + selected classifier and return model plus evaluation data."""
    stratify = dataset.labels if _can_stratify(dataset.labels) else None
    x_train, x_test, y_train, y_test = train_test_split(
        dataset.texts,
        dataset.labels,
        test_size=test_size,
        random_state=random_state,
        stratify=stratify,
    )

    started_at = time.perf_counter()
    model = Pipeline(
        steps=[
            (
                "tfidf",
                TfidfVectorizer(
                    ngram_range=(1, 2),
                    min_df=2,
                    max_df=0.95,
                    max_features=max_features,
                    sublinear_tf=True,
                ),
            ),
            ("classifier", build_classifier(classifier_name, random_state)),
        ]
    )

    model.fit(x_train, y_train)
    training_seconds = round(time.perf_counter() - started_at, 4)
    evaluation = evaluate_sentiment_model(model, x_test, y_test)
    evaluation["classifier_name"] = classifier_name
    evaluation["model_type"] = model_display_name(classifier_name)
    evaluation["training_seconds"] = training_seconds
    evaluation["train_rows"] = len(x_train)
    evaluation["test_rows"] = len(x_test)
    evaluation["label_distribution"] = dataset.label_distribution
    evaluation["preprocessing_summary"] = dataset.preprocessing_summary
    return model, evaluation


def build_classifier(classifier_name: str, random_state: int):
    if classifier_name == "logistic_regression":
        return LogisticRegression(
            class_weight="balanced",
            max_iter=1000,
            n_jobs=1,
            random_state=random_state,
        )
    if classifier_name == "naive_bayes":
        return MultinomialNB()
    if classifier_name == "linear_svm":
        return CalibratedClassifierCV(
            estimator=LinearSVC(class_weight="balanced", random_state=random_state),
            cv=3,
        )
    raise ValueError(f"Unsupported classifier: {classifier_name}")


def model_display_name(classifier_name: str) -> str:
    display_names = {
        "logistic_regression": "TF-IDF + Logistic Regression",
        "naive_bayes": "TF-IDF + Multinomial Naive Bayes",
        "linear_svm": "TF-IDF + Linear SVM",
    }
    return display_names[classifier_name]


def evaluate_sentiment_model(model: Pipeline, texts: Iterable[str], labels: Iterable[str]) -> dict:
    y_true = list(labels)
    y_pred = model.predict(list(texts))
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true,
        y_pred,
        average="weighted",
        zero_division=0,
    )

    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "weighted_precision": round(float(precision), 4),
        "weighted_recall": round(float(recall), 4),
        "weighted_f1": round(float(f1), 4),
        "classification_report": classification_report(
            y_true,
            y_pred,
            output_dict=True,
            zero_division=0,
        ),
    }


def save_model(model: Pipeline, output_path: str | Path, metadata: dict) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "metadata": metadata}, path)


def _can_stratify(labels: list[str]) -> bool:
    counts = Counter(labels)
    return len(counts) > 1 and all(count >= 2 for count in counts.values())
