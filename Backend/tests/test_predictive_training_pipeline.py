from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.feedback_analytics.prediction.predictive_dataset import (
    FEATURE_COLUMNS,
    build_kaggle_employee_performance_dataset,
    generate_synthetic_prediction_rows,
    load_kaggle_employee_performance_rows,
    load_prediction_dataset,
    save_prediction_dataset,
)
from training.feedback_analytics.prediction.train_predictive_models import (
    train_classifiers,
    train_regressors,
)


def test_generate_prediction_dataset_contains_required_features():
    rows = generate_synthetic_prediction_rows(row_count=25, random_state=7)

    assert len(rows) == 25
    assert set(FEATURE_COLUMNS).issubset(rows[0].keys())
    assert "target_next_score" in rows[0]
    assert "target_risk_level" in rows[0]


def test_prediction_dataset_save_and_load_roundtrip():
    output_path = Path(__file__).with_name("_predictive_training_dataset.csv")
    rows = generate_synthetic_prediction_rows(row_count=20, random_state=8)
    try:
        summary = save_prediction_dataset(rows, output_path)
        loaded = load_prediction_dataset(output_path)

        assert summary.row_count == 20
        assert len(loaded) == 20
        assert set(FEATURE_COLUMNS).issubset(loaded[0].keys())
    finally:
        output_path.unlink(missing_ok=True)


def test_kaggle_employee_dataset_is_transformed_when_raw_files_exist():
    raw_dir = REPO_ROOT / "training" / "feedback_analytics" / "datasets" / "raw"
    required_files = ["structured_data.csv", "behavior_logs.csv", "audio_features.csv"]
    if not all((raw_dir / file_name).exists() for file_name in required_files):
        return

    rows = load_kaggle_employee_performance_rows(raw_dir)

    assert len(rows) > 0
    assert set(FEATURE_COLUMNS).issubset(rows[0].keys())
    assert "target_next_score" in rows[0]
    assert "target_risk_level" in rows[0]
    assert {row["target_risk_level"] for row in rows}.issubset({"high", "medium", "low"})


def test_kaggle_preprocessing_summary_reports_cleaning_steps_when_raw_files_exist():
    raw_dir = REPO_ROOT / "training" / "feedback_analytics" / "datasets" / "raw"
    required_files = ["structured_data.csv", "behavior_logs.csv", "audio_features.csv"]
    if not all((raw_dir / file_name).exists() for file_name in required_files):
        return

    rows, summary = build_kaggle_employee_performance_dataset(raw_dir)

    assert summary.raw_structured_rows > 0
    assert summary.raw_behavior_rows > 0
    assert summary.raw_audio_rows > 0
    assert summary.final_processed_rows == len(rows)
    assert summary.merged_employee_records == len(rows)
    assert summary.risk_distribution == {
        "low": sum(1 for row in rows if row["target_risk_level"] == "low"),
        "medium": sum(1 for row in rows if row["target_risk_level"] == "medium"),
        "high": sum(1 for row in rows if row["target_risk_level"] == "high"),
    }


def test_predictive_models_train_and_return_comparison_results():
    rows = generate_synthetic_prediction_rows(row_count=150, random_state=9)
    x = [[float(row[column]) for column in FEATURE_COLUMNS] for row in rows]
    y_score = [float(row["target_next_score"]) for row in rows]
    risk_labels = {"high": 0, "medium": 1, "low": 2}
    y_risk = [risk_labels[str(row["target_risk_level"])] for row in rows]

    regression_results, best_regressor_name, _ = train_regressors(x, y_score, random_state=9)
    classification_results, best_classifier_name, _ = train_classifiers(
        x,
        y_risk,
        _FakeLabelEncoder(),
        random_state=9,
    )

    assert len(regression_results) == 3
    assert best_regressor_name in {row["model_name"] for row in regression_results}
    assert len(classification_results) == 3
    assert best_classifier_name in {row["model_name"] for row in classification_results}


class _FakeLabelEncoder:
    classes_ = ["high", "medium", "low"]
