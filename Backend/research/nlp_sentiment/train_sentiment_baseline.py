from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from research.nlp_sentiment.sentiment_baseline import (
    load_sentiment140,
    predict_sentiment,
    save_model,
    train_sentiment_model,
)

MODEL_VERSION = "tfidf-logistic-regression-sentiment-v1"


def main() -> None:
    args = parse_args()
    dataset = load_sentiment140(
        args.dataset,
        limit=args.limit,
        limit_per_class=args.limit_per_class,
    )

    model, evaluation = train_sentiment_model(
        dataset,
        max_features=args.max_features,
        test_size=args.test_size,
        random_state=args.random_state,
    )

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
        ],
        "model_type": "TF-IDF + Logistic Regression",
        "max_features": args.max_features,
        "test_size": args.test_size,
        "random_state": args.random_state,
    }

    output_evaluation = {
        **metadata,
        "evaluation": evaluation,
        "sample_predictions": [
            predict_sentiment(model, "Your answer was clear and professional."),
            predict_sentiment(model, "The response was confusing and lacked empathy."),
        ],
    }

    save_model(model, args.output_model, metadata)
    write_json(args.output_evaluation, output_evaluation)

    print(f"Rows used: {len(dataset.texts)}")
    print(f"Model saved: {args.output_model}")
    print(f"Evaluation saved: {args.output_evaluation}")
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
        default=Path("research/datasets/raw/sentiment140.csv"),
        help="Path to Sentiment140 CSV file.",
    )
    parser.add_argument(
        "--output-model",
        type=Path,
        default=Path("research/models/sentiment_model.joblib"),
        help="Path for the generated model artifact.",
    )
    parser.add_argument(
        "--output-evaluation",
        type=Path,
        default=Path("research/evaluation/sentiment_evaluation.json"),
        help="Path for the generated evaluation JSON.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Optional maximum number of rows to use.")
    parser.add_argument(
        "--limit-per-class",
        type=int,
        default=None,
        help="Optional balanced row limit for each sentiment class. Recommended for quick Sentiment140 training.",
    )
    parser.add_argument("--max-features", type=int, default=50_000)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--random-state", type=int, default=42)
    return parser.parse_args()


def write_json(output_path: Path, data: dict) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
