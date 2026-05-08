"""
Train the MCA RAVDESS-only SVM Speech Emotion Recognition model.

The saved artifact is a sklearn Pipeline:
    StandardScaler -> SVC(probability=True)

It is backend-compatible with SerAnalyzer.EMOTION_MAP in
Backend/app/api/v1/mca/nudge_engine.py.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
from scipy.stats import loguniform
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import RandomizedSearchCV, StratifiedGroupKFold, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.svm import SVC


DATA_PATH = "features.npz"
OUTPUT_MODEL = "svm_model.pkl"
RANDOM_STATE = 42
LABEL_NAMES = [
    "neutral",
    "happy",
    "sad",
    "angry",
    "fearful",
    "disgust",
    "surprised",
]


def load_dataset(data_path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray | None]:
    if not data_path.exists():
        raise FileNotFoundError(f"{data_path} not found. Run preprocess.py first.")

    data = np.load(data_path, allow_pickle=True)
    X = data["X"].astype(np.float32)
    y = data["y"].astype(np.int64)
    groups = data["actor"] if "actor" in data.files else None

    if X.ndim != 2 or X.shape[1] != 362:
        raise ValueError(f"Expected feature matrix shape (n, 362), got {X.shape}")
    if not np.all(np.isfinite(X)):
        raise ValueError("Feature matrix contains NaN or infinite values.")
    if len(np.unique(y)) != len(LABEL_NAMES):
        raise ValueError(f"Expected {len(LABEL_NAMES)} classes, found {len(np.unique(y))}.")

    return X, y, groups


def print_distribution(title: str, y: np.ndarray) -> None:
    counts = Counter(y)
    print(f"\n{title}")
    for idx, name in enumerate(LABEL_NAMES):
        print(f"  {name:<10}: {counts.get(idx, 0)}")


def json_safe_params(params: dict) -> dict:
    safe = {}
    for key, value in params.items():
        if isinstance(value, np.generic):
            safe[key] = value.item()
        else:
            safe[key] = value
    return safe


def make_holdout_split(
    X: np.ndarray,
    y: np.ndarray,
    groups: np.ndarray | None,
    test_size: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray | None]:
    if groups is None:
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=test_size,
            stratify=y,
            random_state=RANDOM_STATE,
        )
        return X_train, X_test, y_train, y_test, None

    # Speaker-independent test set. RAVDESS actors stay entirely in train or test.
    n_splits = max(2, round(1 / test_size))
    splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=RANDOM_STATE)
    train_idx, test_idx = next(splitter.split(X, y, groups))
    return X[train_idx], X[test_idx], y[train_idx], y[test_idx], groups[train_idx]


def build_search_pipeline() -> Pipeline:
    return Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            ("pca", PCA(random_state=RANDOM_STATE)),
            ("svm", SVC(class_weight="balanced", probability=False)),
        ]
    )


def build_final_pipeline(best_params: dict) -> Pipeline:
    svm_kwargs = {
        "C": best_params["svm__C"],
        "kernel": best_params["svm__kernel"],
        "class_weight": "balanced",
        "probability": True,
        "random_state": RANDOM_STATE,
    }
    if best_params["svm__kernel"] == "rbf":
        svm_kwargs["gamma"] = best_params["svm__gamma"]

    steps = [("scaler", StandardScaler())]
    if best_params.get("pca__n_components") is not None:
        steps.append(("pca", PCA(n_components=best_params["pca__n_components"], random_state=RANDOM_STATE)))
    
    steps.append(("svm", SVC(**svm_kwargs)))

    return Pipeline(steps=steps)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a RAVDESS-only MCA SVM SER model.")
    parser.add_argument("--data", default=DATA_PATH, help=f"Feature .npz path. Default: {DATA_PATH}")
    parser.add_argument("--output", default=OUTPUT_MODEL, help=f"Model output path. Default: {OUTPUT_MODEL}")
    parser.add_argument("--test-size", type=float, default=0.2, help="Holdout size. Default: 0.2")
    parser.add_argument("--n-iter", type=int, default=100, help="Random search iterations. Default: 100")
    parser.add_argument(
        "--no-group-split",
        action="store_true",
        help="Use sample-level stratified split instead of speaker-independent actor split.",
    )
    args = parser.parse_args()

    data_path = Path(args.data)
    output_model = Path(args.output)
    report_path = output_model.with_suffix(".report.json")

    X, y, groups = load_dataset(data_path)
    if args.no_group_split:
        groups = None

    print("=== MCA SER Training: RAVDESS-only SVM ===")
    print(f"Loaded {X.shape[0]} samples, {X.shape[1]} features")
    print("Backend label contract:", {idx: name for idx, name in enumerate(LABEL_NAMES)})
    print_distribution("Full dataset distribution", y)

    X_train, X_test, y_train, y_test, train_groups = make_holdout_split(
        X,
        y,
        groups,
        test_size=args.test_size,
    )
    print_distribution("Train distribution", y_train)
    print_distribution("Test distribution", y_test)

    param_dist = {
        "pca__n_components": [0.90, 0.95, 0.98],
        "svm__C": loguniform(0.1, 100.0),
        "svm__gamma": loguniform(1e-5, 1e-2),
        "svm__kernel": ["rbf"],
    }

    if train_groups is not None:
        cv = StratifiedGroupKFold(n_splits=4, shuffle=True, random_state=RANDOM_STATE)
        fit_groups = train_groups
        print("\nUsing speaker-independent cross-validation by actor.")
    else:
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
        fit_groups = None
        print("\nUsing sample-level stratified cross-validation.")

    search = RandomizedSearchCV(
        estimator=build_search_pipeline(),
        param_distributions=param_dist,
        n_iter=args.n_iter,
        scoring="f1_macro",
        cv=cv,
        n_jobs=-1,
        verbose=2,
        refit=True,
        random_state=RANDOM_STATE,
    )

    print(f"\n[1/3] Hyperparameter search ({args.n_iter} trials, macro F1)...")
    search.fit(X_train, y_train, groups=fit_groups)
    print(f"Best CV macro F1: {search.best_score_:.4f}")
    print(f"Best parameters : {search.best_params_}")

    print("\n[2/3] Final fit with probability calibration enabled...")
    model = build_final_pipeline(search.best_params_)
    model.fit(X_train, y_train)

    print("\n[3/3] Holdout evaluation...")
    y_pred = model.predict(X_test)
    y_train_pred = model.predict(X_train)

    test_accuracy = accuracy_score(y_test, y_pred)
    test_macro_f1 = f1_score(y_test, y_pred, average="macro")
    train_accuracy = accuracy_score(y_train, y_train_pred)
    overfit_gap = train_accuracy - test_accuracy
    report = classification_report(
        y_test,
        y_pred,
        labels=list(range(len(LABEL_NAMES))),
        target_names=LABEL_NAMES,
        zero_division=0,
        output_dict=True,
    )
    matrix = confusion_matrix(y_test, y_pred, labels=list(range(len(LABEL_NAMES))))

    print("\nClassification report")
    print(
        classification_report(
            y_test,
            y_pred,
            labels=list(range(len(LABEL_NAMES))),
            target_names=LABEL_NAMES,
            zero_division=0,
        )
    )
    print("Confusion matrix rows=true, cols=pred")
    print(matrix)
    print(f"\nTest accuracy : {test_accuracy * 100:.2f}%")
    print(f"Test macro F1 : {test_macro_f1:.4f}")
    print(f"Train accuracy: {train_accuracy * 100:.2f}%")
    print(f"Overfit gap   : {overfit_gap * 100:.2f}%")

    output_model.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, output_model)

    report_payload = {
        "data_path": str(data_path),
        "model_path": str(output_model),
        "label_names": LABEL_NAMES,
        "label_contract": {str(idx): name for idx, name in enumerate(LABEL_NAMES)},
        "best_cv_macro_f1": float(search.best_score_),
        "best_params": json_safe_params(search.best_params_),
        "test_accuracy": float(test_accuracy),
        "test_macro_f1": float(test_macro_f1),
        "train_accuracy": float(train_accuracy),
        "overfit_gap": float(overfit_gap),
        "classification_report": report,
        "confusion_matrix": matrix.tolist(),
        "split": "actor_grouped" if groups is not None else "sample_stratified",
    }
    report_path.write_text(json.dumps(report_payload, indent=2), encoding="utf-8")

    text_report_path = output_model.with_suffix(".report.txt")
    text_report = f"""=== MCA SER Training Report ===
Test accuracy : {test_accuracy * 100:.2f}%
Test macro F1 : {test_macro_f1:.4f}
Train accuracy: {train_accuracy * 100:.2f}%
Overfit gap   : {overfit_gap * 100:.2f}%

Classification Report:
{classification_report(y_test, y_pred, labels=list(range(len(LABEL_NAMES))), target_names=LABEL_NAMES, zero_division=0)}

Confusion Matrix (rows=true, cols=pred):
{matrix}
"""
    text_report_path.write_text(text_report, encoding="utf-8")

    print(f"\nSaved model : {output_model}")
    print(f"Saved report: {report_path}")
    print("Backend target path: Backend/app/models/affect_fusion/svm_model.pkl")


if __name__ == "__main__":
    main()
