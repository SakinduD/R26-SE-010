import csv
from pathlib import Path

from research.nlp_sentiment.sentiment_baseline import (
    clean_feedback_text,
    load_sentiment140,
    predict_sentiment,
    train_sentiment_model,
)


def test_clean_feedback_text_normalizes_social_text():
    result = clean_feedback_text("@user I LOVE this!!! https://example.com &amp; thanks")

    assert "USER" not in result
    assert "URL" not in result
    assert result == "user i love this!!! url and thanks"


def test_sentiment_baseline_trains_and_predicts():
    dataset_path = Path(__file__).with_name("_sentiment140_sample.csv")
    rows = [
        [0, "1", "date", "flag", "user", "This is bad and confusing"],
        [0, "2", "date", "flag", "user", "I hate this poor answer"],
        [0, "3", "date", "flag", "user", "Terrible unclear response"],
        [0, "4", "date", "flag", "user", "Bad communication and weak tone"],
        [4, "5", "date", "flag", "user", "This is clear and excellent"],
        [4, "6", "date", "flag", "user", "I love this helpful answer"],
        [4, "7", "date", "flag", "user", "Great confident professional response"],
        [4, "8", "date", "flag", "user", "Excellent empathy and clear tone"],
    ]
    try:
        with dataset_path.open("w", encoding="latin-1", newline="") as file:
            writer = csv.writer(file)
            writer.writerows(rows)

        dataset = load_sentiment140(dataset_path)
        model, evaluation = train_sentiment_model(dataset, max_features=200, test_size=0.25)
        prediction = predict_sentiment(model, "This was a clear and excellent response")

        assert dataset.label_distribution == {"negative": 4, "positive": 4}
        assert 0 <= evaluation["weighted_f1"] <= 1
        assert prediction["sentiment"] in {"negative", "positive"}
        assert 0 <= prediction["confidence"] <= 1
    finally:
        dataset_path.unlink(missing_ok=True)


def test_load_sentiment140_can_limit_each_class_for_sorted_dataset():
    dataset_path = Path(__file__).with_name("_sentiment140_sorted_sample.csv")
    rows = [
        [0, "1", "date", "flag", "user", "Bad unclear response"],
        [0, "2", "date", "flag", "user", "Poor confusing tone"],
        [0, "3", "date", "flag", "user", "Terrible answer"],
        [4, "4", "date", "flag", "user", "Clear helpful response"],
        [4, "5", "date", "flag", "user", "Excellent confident tone"],
        [4, "6", "date", "flag", "user", "Great answer"],
    ]
    try:
        with dataset_path.open("w", encoding="latin-1", newline="") as file:
            writer = csv.writer(file)
            writer.writerows(rows)

        dataset = load_sentiment140(dataset_path, limit_per_class=2)

        assert dataset.label_distribution == {"negative": 2, "positive": 2}
    finally:
        dataset_path.unlink(missing_ok=True)
