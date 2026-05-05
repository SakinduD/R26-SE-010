from __future__ import annotations

import argparse
import csv
import json
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor, RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import KFold, StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler

from training.feedback_analytics.prediction.predictive_dataset import (
    FEATURE_COLUMNS,
    LABEL_COLUMN,
    REGRESSION_TARGET,
    build_kaggle_employee_performance_dataset,
    generate_synthetic_prediction_rows,
    load_prediction_dataset,
    save_prediction_dataset,
    summarize_prediction_dataset,
)

MODEL_VERSION = "ml-predictive-behavioral-analytics-v1"
RISK_LABELS = ["high", "medium", "low"]


def main() -> None:
    args = parse_args()
    rows, preprocessing_summary = _load_or_generate_dataset(args)
    summary = summarize_prediction_dataset(rows)

    x = np.array([[float(row[column]) for column in FEATURE_COLUMNS] for row in rows])
    y_score = np.array([float(row[REGRESSION_TARGET]) for row in rows])
    label_encoder = LabelEncoder()
    y_risk = label_encoder.fit_transform([str(row[LABEL_COLUMN]) for row in rows])

    regressor_results, best_regressor_name, best_regressor = train_regressors(
        x,
        y_score,
        args.random_state,
    )
    classifier_results, best_classifier_name, best_classifier = train_classifiers(
        x,
        y_risk,
        label_encoder,
        args.random_state,
    )

    metadata = {
        "model_version": MODEL_VERSION,
        "trained_at": datetime.now(UTC).isoformat(),
        "dataset_path": str(args.dataset),
        "data_source": _data_source_label(args),
        "row_count": summary.row_count,
        "feature_columns": summary.feature_columns,
        "regression_target": summary.regression_target,
        "classification_target": summary.classification_target,
        "risk_distribution": summary.risk_distribution,
        "selected_regressor": best_regressor_name,
        "selected_classifier": best_classifier_name,
        "selection_rule": "lowest RMSE for regression, highest weighted F1 for classification",
        "target_note": (
            "Kaggle raw performance_rating was not used directly because the provided files contain a single class. "
            "Targets are derived from real structured, behavioral, and audio feature signals."
        ),
        "preprocessing_summary": preprocessing_summary,
    }

    output = {
        **metadata,
        "regression_model_comparison": regressor_results,
        "classification_model_comparison": classifier_results,
    }

    args.output_model.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "regressor": best_regressor,
            "classifier": best_classifier,
            "label_encoder": label_encoder,
            "metadata": metadata,
        },
        args.output_model,
    )
    write_json(args.output_evaluation, output)
    write_json(args.output_preprocessing_summary, preprocessing_summary)
    write_comparison_csv(args.output_comparison_csv, regressor_results, classifier_results)

    print(f"Rows used: {summary.row_count}")
    print(f"Best regressor: {best_regressor_name}")
    print(f"Best classifier: {best_classifier_name}")
    print(f"Model saved: {args.output_model}")
    print(f"Evaluation saved: {args.output_evaluation}")
    print(f"Preprocessing summary saved: {args.output_preprocessing_summary}")
    print(f"Comparison CSV saved: {args.output_comparison_csv}")


def _load_or_generate_dataset(args: argparse.Namespace) -> tuple[list[dict], dict]:
    if args.dataset.exists() and not args.regenerate:
        rows = load_prediction_dataset(args.dataset)
        return rows, _processed_dataset_summary(rows, "existing_processed_dataset")

    rows, preprocessing_summary = _build_training_rows(args)
    save_prediction_dataset(rows, args.dataset)
    return rows, preprocessing_summary


def _build_training_rows(args: argparse.Namespace) -> tuple[list[dict], dict]:
    if args.source in {"auto", "kaggle"}:
        try:
            rows, preprocessing_summary = build_kaggle_employee_performance_dataset(args.raw_dir)
            if rows:
                return rows, preprocessing_summary.__dict__
        except FileNotFoundError:
            if args.source == "kaggle":
                raise

    rows = generate_synthetic_prediction_rows(args.rows, args.random_state)
    return rows, _processed_dataset_summary(rows, "synthetic_system_simulation")


def _processed_dataset_summary(rows: list[dict], source: str) -> dict:
    summary = summarize_prediction_dataset(rows)
    return {
        "source": source,
        "raw_structured_rows": None,
        "raw_behavior_rows": None,
        "raw_audio_rows": None,
        "duplicate_employee_ids_removed": 0,
        "invalid_or_missing_rows_removed": 0,
        "incomplete_employee_records_removed": 0,
        "merged_employee_records": summary.row_count,
        "final_processed_rows": summary.row_count,
        "risk_distribution": summary.risk_distribution,
        "original_rating_distribution": {},
        "notes": [
            "This summary was generated from an already processed or synthetic dataset.",
        ],
    }


def _data_source_label(args: argparse.Namespace) -> str:
    if args.source == "synthetic":
        return "synthetic_system_simulation"
    if all((args.raw_dir / file_name).exists() for file_name in ["structured_data.csv", "behavior_logs.csv", "audio_features.csv"]):
        return "kaggle_employee_performance_evaluation_transformed"
    return "synthetic_system_simulation"


def train_regressors(x: np.ndarray, y: np.ndarray, random_state: int):
    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=0.2,
        random_state=random_state,
    )
    candidates = {
        "linear_regression": Pipeline([("scaler", StandardScaler()), ("model", LinearRegression())]),
        "random_forest_regressor": RandomForestRegressor(
            n_estimators=180,
            random_state=random_state,
            min_samples_leaf=3,
        ),
        "gradient_boosting_regressor": GradientBoostingRegressor(random_state=random_state),
    }
    results = []
    trained = {}
    for name, model in candidates.items():
        started = perf_counter()
        model.fit(x_train, y_train)
        predictions = model.predict(x_test)
        rmse = mean_squared_error(y_test, predictions) ** 0.5
        cv = KFold(n_splits=5, shuffle=True, random_state=random_state)
        cv_rmse = (-cross_val_score(model, x, y, cv=cv, scoring="neg_root_mean_squared_error")).mean()
        results.append(
            {
                "model_name": name,
                "task": "next_score_regression",
                "mae": round(float(mean_absolute_error(y_test, predictions)), 4),
                "mse": round(float(mean_squared_error(y_test, predictions)), 4),
                "rmse": round(float(rmse), 4),
                "r2": round(float(r2_score(y_test, predictions)), 4),
                "cv_rmse": round(float(cv_rmse), 4),
                "training_seconds": round(perf_counter() - started, 4),
            }
        )
        trained[name] = model

    results.sort(key=lambda item: (item["rmse"], item["cv_rmse"]))
    best_name = results[0]["model_name"]
    return results, best_name, trained[best_name]


def train_classifiers(x: np.ndarray, y: np.ndarray, label_encoder: LabelEncoder, random_state: int):
    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=0.2,
        random_state=random_state,
        stratify=y,
    )
    candidates = {
        "logistic_regression": Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "model",
                    LogisticRegression(
                        class_weight="balanced",
                        max_iter=1000,
                        random_state=random_state,
                    ),
                ),
            ]
        ),
        "random_forest_classifier": RandomForestClassifier(
            n_estimators=180,
            random_state=random_state,
            min_samples_leaf=3,
            class_weight="balanced",
        ),
        "gradient_boosting_classifier": GradientBoostingClassifier(random_state=random_state),
    }
    results = []
    trained = {}
    for name, model in candidates.items():
        started = perf_counter()
        model.fit(x_train, y_train)
        predictions = model.predict(x_test)
        probabilities = model.predict_proba(x_test)
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=random_state)
        cv_f1 = cross_val_score(model, x, y, cv=cv, scoring="f1_weighted").mean()
        results.append(
            {
                "model_name": name,
                "task": "risk_level_classification",
                "accuracy": round(float(accuracy_score(y_test, predictions)), 4),
                "precision": round(float(precision_score(y_test, predictions, average="weighted", zero_division=0)), 4),
                "recall": round(float(recall_score(y_test, predictions, average="weighted", zero_division=0)), 4),
                "f1": round(float(f1_score(y_test, predictions, average="weighted", zero_division=0)), 4),
                "roc_auc": round(float(_safe_multiclass_roc_auc(y_test, probabilities)), 4),
                "cv_f1": round(float(cv_f1), 4),
                "labels": list(label_encoder.classes_),
                "training_seconds": round(perf_counter() - started, 4),
            }
        )
        trained[name] = model

    results.sort(key=lambda item: (item["f1"], item["roc_auc"], item["accuracy"]), reverse=True)
    best_name = results[0]["model_name"]
    return results, best_name, trained[best_name]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train predictive behavioral analytics ML models.")
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("training/feedback_analytics/datasets/processed/predictive_training_dataset.csv"),
    )
    parser.add_argument(
        "--output-model",
        type=Path,
        default=Path("training/feedback_analytics/models/predictive_behavior_model.joblib"),
    )
    parser.add_argument(
        "--output-evaluation",
        type=Path,
        default=Path("training/feedback_analytics/evaluation/predictive_model_evaluation.json"),
    )
    parser.add_argument(
        "--output-comparison-csv",
        type=Path,
        default=Path("training/feedback_analytics/evaluation/predictive_model_comparison.csv"),
    )
    parser.add_argument(
        "--output-preprocessing-summary",
        type=Path,
        default=Path("training/feedback_analytics/evaluation/predictive_preprocessing_summary.json"),
    )
    parser.add_argument("--rows", type=int, default=3000)
    parser.add_argument("--random-state", type=int, default=42)
    parser.add_argument("--regenerate", action="store_true")
    parser.add_argument(
        "--source",
        choices=["auto", "kaggle", "synthetic"],
        default="auto",
        help="Training data source. auto uses Kaggle raw files when present, otherwise synthetic fallback.",
    )
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=Path("training/feedback_analytics/datasets/raw"),
        help="Folder containing structured_data.csv, behavior_logs.csv, and audio_features.csv.",
    )
    return parser.parse_args()


def _safe_multiclass_roc_auc(y_true: np.ndarray, probabilities: np.ndarray) -> float:
    try:
        return roc_auc_score(y_true, probabilities, multi_class="ovr", average="weighted")
    except ValueError:
        return 0.0


def write_json(output_path: Path, data: dict) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def write_comparison_csv(output_path: Path, regression_rows: list[dict], classification_rows: list[dict]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as file:
        fieldnames = [
            "model_name",
            "task",
            "mae",
            "mse",
            "rmse",
            "r2",
            "cv_rmse",
            "accuracy",
            "precision",
            "recall",
            "f1",
            "roc_auc",
            "cv_f1",
            "training_seconds",
        ]
        writer = csv.DictWriter(file, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(regression_rows)
        writer.writerows(classification_rows)


if __name__ == "__main__":
    main()
