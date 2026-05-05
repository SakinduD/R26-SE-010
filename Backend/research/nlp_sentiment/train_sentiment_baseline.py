from __future__ import annotations

import argparse
import csv
import json
from datetime import UTC, datetime
from pathlib import Path

from research.nlp_sentiment.sentiment_baseline import (
    load_sentiment140,
    model_display_name,
    predict_sentiment,
    save_model,
    train_sentiment_model,
)

MODEL_VERSION = "tfidf-sentiment-model-comparison-v1"
DEFAULT_CLASSIFIERS = ("naive_bayes", "logistic_regression", "linear_svm")


def main() -> None:
    args = parse_args()
    dataset = load_sentiment140(
        args.dataset,
        limit=args.limit,
        limit_per_class=args.limit_per_class,
        min_text_length=args.min_text_length,
        remove_duplicates=not args.keep_duplicates,
        output_processed_path=args.output_processed,
    )

    classifier_names = args.classifiers or list(DEFAULT_CLASSIFIERS)
    trained_models = []
    evaluations = []
    for classifier_name in classifier_names:
        print(f"Training {model_display_name(classifier_name)}...")
        model, evaluation = train_sentiment_model(
            dataset,
            classifier_name=classifier_name,
            max_features=args.max_features,
            test_size=args.test_size,
            random_state=args.random_state,
        )
        trained_models.append((classifier_name, model, evaluation))
        evaluations.append(evaluation)

    best_classifier_name, best_model, best_evaluation = select_best_model(trained_models)

    metadata = {
        "model_version": MODEL_VERSION,
        "dataset_name": "Sentiment140",
        "dataset_path": str(args.dataset),
        "rows_used": len(dataset.texts),
        "trained_at": datetime.now(UTC).isoformat(),
        "text_preprocessing": [
            "lowercase",
            "html_unescape",
            "url_normalization",
            "mention_normalization",
            "special_character_cleanup",
            "whitespace_normalization",
            "empty_text_removal",
            "short_text_removal",
            "duplicate_cleaned_text_removal",
        ],
        "preprocessing_summary": dataset.preprocessing_summary,
        "model_type": model_display_name(best_classifier_name),
        "selected_classifier": best_classifier_name,
        "selection_metric": "weighted_f1",
        "max_features": args.max_features,
        "test_size": args.test_size,
        "random_state": args.random_state,
    }

    output_evaluation = {
        **metadata,
        "model_comparison": summarize_model_comparison(evaluations),
        "evaluation": best_evaluation,
        "sample_predictions": [
            predict_sentiment(best_model, "Your answer was clear and professional."),
            predict_sentiment(best_model, "The response was confusing and lacked empathy."),
        ],
    }

    save_model(best_model, args.output_model, metadata)
    write_json(args.output_evaluation, output_evaluation)
    if args.output_comparison_csv is not None:
        write_comparison_csv(args.output_comparison_csv, output_evaluation["model_comparison"])

    print(f"Rows used: {len(dataset.texts)}")
    print(f"Best model: {metadata['model_type']}")
    print(f"Model saved: {args.output_model}")
    print(f"Evaluation saved: {args.output_evaluation}")
    if args.output_comparison_csv is not None:
        print(f"Model comparison CSV saved: {args.output_comparison_csv}")
    print(
        "Weighted F1:",
        output_evaluation["evaluation"]["weighted_f1"],
        "| Accuracy:",
        output_evaluation["evaluation"]["accuracy"],
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the Sentiment140 TF-IDF + Logistic Regression baseline."
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("../training/feedback_analytics/datasets/raw/sentiment140.csv"),
        help="Path to Sentiment140 CSV file.",
    )
    parser.add_argument(
        "--output-model",
        type=Path,
        default=Path("../training/feedback_analytics/models/sentiment_model.joblib"),
        help="Path for the generated model artifact.",
    )
    parser.add_argument(
        "--output-evaluation",
        type=Path,
        default=Path("../training/feedback_analytics/evaluation/sentiment_evaluation.json"),
        help="Path for the generated evaluation JSON.",
    )
    parser.add_argument(
        "--output-comparison-csv",
        type=Path,
        default=Path("../training/feedback_analytics/evaluation/sentiment_model_comparison.csv"),
        help="Path for the generated model comparison CSV.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Optional maximum number of rows to use.")
    parser.add_argument(
        "--limit-per-class",
        type=int,
        default=None,
        help="Optional balanced row limit for each sentiment class. Recommended for quick Sentiment140 training.",
    )
    parser.add_argument("--max-features", type=int, default=50_000)
    parser.add_argument(
        "--classifiers",
        nargs="+",
        choices=list(DEFAULT_CLASSIFIERS),
        default=None,
        help="Classifier names to compare. Defaults to Naive Bayes, Logistic Regression, and Linear SVM.",
    )
    parser.add_argument(
        "--min-text-length",
        type=int,
        default=3,
        help="Minimum cleaned text character length to keep.",
    )
    parser.add_argument(
        "--keep-duplicates",
        action="store_true",
        help="Keep duplicate cleaned text rows. By default duplicates are removed.",
    )
    parser.add_argument(
        "--output-processed",
        type=Path,
        default=None,
        help="Optional path for saving the cleaned training dataset CSV.",
    )
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--random-state", type=int, default=42)
    return parser.parse_args()


def write_json(output_path: Path, data: dict) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def select_best_model(trained_models: list[tuple[str, object, dict]]) -> tuple[str, object, dict]:
    return max(
        trained_models,
        key=lambda item: (
            item[2]["weighted_f1"],
            item[2]["accuracy"],
            -item[2]["training_seconds"],
        ),
    )


def summarize_model_comparison(evaluations: list[dict]) -> list[dict]:
    return [
        {
            "classifier_name": evaluation["classifier_name"],
            "model_type": evaluation["model_type"],
            "accuracy": evaluation["accuracy"],
            "weighted_precision": evaluation["weighted_precision"],
            "weighted_recall": evaluation["weighted_recall"],
            "weighted_f1": evaluation["weighted_f1"],
            "training_seconds": evaluation["training_seconds"],
        }
        for evaluation in sorted(
            evaluations,
            key=lambda item: (item["weighted_f1"], item["accuracy"]),
            reverse=True,
        )
    ]


def write_comparison_csv(output_path: Path, rows: list[dict]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "classifier_name",
                "model_type",
                "accuracy",
                "weighted_precision",
                "weighted_recall",
                "weighted_f1",
                "training_seconds",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
