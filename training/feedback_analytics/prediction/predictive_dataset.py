from __future__ import annotations

import csv
import random
from dataclasses import dataclass
from pathlib import Path

RAW_DATASET_FILES = {
    "structured": "structured_data.csv",
    "behavior": "behavior_logs.csv",
    "audio": "audio_features.csv",
}

REQUIRED_RAW_COLUMNS = {
    "structured": [
        "employee_id",
        "average_task_quality",
        "client_satisfaction_score",
        "deadline_met_score",
        "innovation_score",
        "efficiency_score",
    ],
    "behavior": [
        "employee_id",
        "collaboration_score",
        "punctuality_score",
        "training_hours_completed",
        "work_engagement_score",
        "peer_interaction_score",
        "initiative_score",
        "task_followup_score",
    ],
    "audio": [
        "employee_id",
        "speech_sentiment_score",
        "speech_energy_level",
        "speech_clarity_score",
        "tone_consistency_score",
        "speaking_speed",
        "pause_frequency",
        "pitch_variation",
        "volume_stability_score",
    ],
}

FEATURE_COLUMNS = [
    "current_score",
    "previous_score",
    "trend_slope",
    "average_feedback_rating",
    "sentiment_score",
    "blind_spot_count",
    "session_count",
    "engagement_score",
]

REGRESSION_TARGET = "target_next_score"
LABEL_COLUMN = "target_risk_level"
CSV_COLUMNS = [*FEATURE_COLUMNS, REGRESSION_TARGET, LABEL_COLUMN]

MIN_SCORE = 0.0
MAX_SCORE = 100.0


@dataclass(frozen=True)
class PredictionDatasetSummary:
    row_count: int
    feature_columns: list[str]
    regression_target: str
    classification_target: str
    risk_distribution: dict[str, int]


@dataclass(frozen=True)
class KagglePreprocessingSummary:
    raw_structured_rows: int
    raw_behavior_rows: int
    raw_audio_rows: int
    duplicate_employee_ids_removed: int
    invalid_or_missing_rows_removed: int
    incomplete_employee_records_removed: int
    merged_employee_records: int
    final_processed_rows: int
    risk_distribution: dict[str, int]
    original_rating_distribution: dict[str, int]
    notes: list[str]


def generate_synthetic_prediction_rows(
    row_count: int = 3000,
    random_state: int = 42,
) -> list[dict[str, float | int | str]]:
    """Generate a realistic soft-skills prediction dataset for research training.

    This creates controlled behavioral records until enough real longitudinal
    user sessions are available. The target score is derived from current skill
    level, recent trend, feedback, sentiment, engagement, and blind spots.
    """
    rng = random.Random(random_state)
    rows: list[dict[str, float | int | str]] = []

    for _ in range(row_count):
        previous_score = rng.uniform(35, 95)
        trend_slope = rng.uniform(-12, 12)
        current_score = _clamp(previous_score + trend_slope + rng.gauss(0, 4))
        average_feedback_rating = _clamp(current_score + rng.gauss(0, 9))
        sentiment_score = rng.uniform(-1, 1)
        blind_spot_count = rng.choices([0, 1, 2, 3], weights=[0.48, 0.31, 0.16, 0.05])[0]
        session_count = rng.randint(2, 12)
        engagement_score = _clamp(rng.uniform(45, 100) - (blind_spot_count * 4))

        next_score = _clamp(
            (current_score * 0.58)
            + (previous_score * 0.12)
            + (average_feedback_rating * 0.12)
            + (trend_slope * 1.6)
            + (sentiment_score * 8)
            + (engagement_score * 0.08)
            - (blind_spot_count * 6)
            + rng.gauss(0, 5)
        )
        risk_level = _risk_level(next_score, trend_slope, blind_spot_count)

        rows.append(
            {
                "current_score": round(current_score, 3),
                "previous_score": round(previous_score, 3),
                "trend_slope": round(trend_slope, 3),
                "average_feedback_rating": round(average_feedback_rating, 3),
                "sentiment_score": round(sentiment_score, 3),
                "blind_spot_count": blind_spot_count,
                "session_count": session_count,
                "engagement_score": round(engagement_score, 3),
                REGRESSION_TARGET: round(next_score, 3),
                LABEL_COLUMN: risk_level,
            }
        )

    return rows


def load_kaggle_employee_performance_rows(raw_dir: str | Path) -> list[dict[str, float | int | str]]:
    """Build prediction rows from the Kaggle employee performance evaluation dataset.

    The dataset contains three files keyed by employee_id. The provided
    performance_rating column can be unsuitable when a downloaded sample has only
    one class, so the training target is derived from the real behavioral,
    structured, and audio features.
    """
    rows, _summary = build_kaggle_employee_performance_dataset(raw_dir)
    return rows


def build_kaggle_employee_performance_dataset(
    raw_dir: str | Path,
) -> tuple[list[dict[str, float | int | str]], KagglePreprocessingSummary]:
    raw_path = Path(raw_dir)
    structured_rows, structured_stats = _read_csv_by_employee_id(
        raw_path / RAW_DATASET_FILES["structured"],
        REQUIRED_RAW_COLUMNS["structured"],
    )
    behavior_rows, behavior_stats = _read_csv_by_employee_id(
        raw_path / RAW_DATASET_FILES["behavior"],
        REQUIRED_RAW_COLUMNS["behavior"],
    )
    audio_rows, audio_stats = _read_csv_by_employee_id(
        raw_path / RAW_DATASET_FILES["audio"],
        REQUIRED_RAW_COLUMNS["audio"],
    )

    rows: list[dict[str, float | int | str]] = []
    common_employee_ids = sorted(set(structured_rows) & set(behavior_rows) & set(audio_rows))
    for employee_id in common_employee_ids:
        structured = structured_rows[employee_id]
        behavior = behavior_rows[employee_id]
        audio = audio_rows[employee_id]

        structured_score = _structured_score(structured)
        behavior_score = _behavior_score(behavior)
        audio_score = _audio_score(audio)

        current_score = _clamp((structured_score * 0.35) + (behavior_score * 0.4) + (audio_score * 0.25))
        previous_score = _clamp(current_score - (_float(behavior, "training_hours_completed") * 0.25) + 4)
        trend_slope = _clamp_delta(current_score - previous_score)
        average_feedback_rating = _clamp(
            (_float(structured, "client_satisfaction_score") * 0.45)
            + (_float(behavior, "peer_interaction_score") * 5.5)
        )
        sentiment_score = _float(audio, "speech_sentiment_score")
        blind_spot_count = _blind_spot_count(structured, behavior, audio)
        session_count = max(2, int(round(_float(behavior, "training_hours_completed") / 4)))
        engagement_score = _clamp(
            (_float(behavior, "work_engagement_score") * 7.0)
            + (_float(behavior, "initiative_score") * 2.0)
            + (_float(behavior, "task_followup_score") * 1.0)
        )

        employee_noise = random.Random(int(employee_id)).gauss(0, 4.5)
        target_next_score = _clamp(
            (current_score * 0.42)
            + (average_feedback_rating * 0.13)
            + (engagement_score * 0.17)
            + (structured_score * 0.08)
            + (audio_score * 0.08)
            + (sentiment_score * 5.5)
            + (trend_slope * 1.15)
            - (blind_spot_count * 4.5)
            + employee_noise
        )
        target_risk_level = _risk_level(target_next_score, trend_slope, blind_spot_count)

        rows.append(
            {
                "current_score": round(current_score, 3),
                "previous_score": round(previous_score, 3),
                "trend_slope": round(trend_slope, 3),
                "average_feedback_rating": round(average_feedback_rating, 3),
                "sentiment_score": round(sentiment_score, 3),
                "blind_spot_count": blind_spot_count,
                "session_count": session_count,
                "engagement_score": round(engagement_score, 3),
                REGRESSION_TARGET: round(target_next_score, 3),
                LABEL_COLUMN: target_risk_level,
            }
        )

    unique_employee_ids = set(structured_rows) | set(behavior_rows) | set(audio_rows)
    risk_distribution = summarize_prediction_dataset(rows).risk_distribution
    preprocessing_summary = KagglePreprocessingSummary(
        raw_structured_rows=structured_stats["raw_rows"],
        raw_behavior_rows=behavior_stats["raw_rows"],
        raw_audio_rows=audio_stats["raw_rows"],
        duplicate_employee_ids_removed=(
            structured_stats["duplicate_employee_ids_removed"]
            + behavior_stats["duplicate_employee_ids_removed"]
            + audio_stats["duplicate_employee_ids_removed"]
        ),
        invalid_or_missing_rows_removed=(
            structured_stats["invalid_or_missing_rows_removed"]
            + behavior_stats["invalid_or_missing_rows_removed"]
            + audio_stats["invalid_or_missing_rows_removed"]
        ),
        incomplete_employee_records_removed=len(unique_employee_ids) - len(common_employee_ids),
        merged_employee_records=len(common_employee_ids),
        final_processed_rows=len(rows),
        risk_distribution=risk_distribution,
        original_rating_distribution=_combine_distributions(
            structured_stats["original_rating_distribution"],
            behavior_stats["original_rating_distribution"],
            audio_stats["original_rating_distribution"],
        ),
        notes=[
            "Rows are merged by employee_id across structured, behavior, and audio feature files.",
            "Duplicate employee_id rows are removed by keeping the first valid record.",
            "Rows with missing employee_id or invalid required numeric values are removed.",
            "Raw performance_rating is recorded but not used as the final target because the provided files contain a single class.",
            "target_next_score and target_risk_level are derived from real structured, behavioral, and audio feature signals.",
        ],
    )
    return rows, preprocessing_summary


def save_prediction_dataset(rows: list[dict], output_path: str | Path) -> PredictionDatasetSummary:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    return summarize_prediction_dataset(rows)


def load_prediction_dataset(dataset_path: str | Path) -> list[dict[str, float | int | str]]:
    path = Path(dataset_path)
    if not path.exists():
        raise FileNotFoundError(f"Prediction dataset not found: {path}")

    rows: list[dict[str, float | int | str]] = []
    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            rows.append(
                {
                    **{feature: float(row[feature]) for feature in FEATURE_COLUMNS},
                    REGRESSION_TARGET: float(row[REGRESSION_TARGET]),
                    LABEL_COLUMN: row[LABEL_COLUMN],
                }
            )
    return rows


def summarize_prediction_dataset(rows: list[dict]) -> PredictionDatasetSummary:
    risk_distribution = {"low": 0, "medium": 0, "high": 0}
    for row in rows:
        risk_distribution[str(row[LABEL_COLUMN])] += 1

    return PredictionDatasetSummary(
        row_count=len(rows),
        feature_columns=list(FEATURE_COLUMNS),
        regression_target=REGRESSION_TARGET,
        classification_target=LABEL_COLUMN,
        risk_distribution=risk_distribution,
    )


def _risk_level(next_score: float, trend_slope: float, blind_spot_count: int) -> str:
    if next_score < 50 or (trend_slope < -7 and blind_spot_count >= 2):
        return "high"
    if next_score < 70 or trend_slope < -4 or blind_spot_count >= 2:
        return "medium"
    return "low"


def _clamp(value: float) -> float:
    return max(MIN_SCORE, min(MAX_SCORE, value))


def _clamp_delta(value: float, minimum: float = -20.0, maximum: float = 20.0) -> float:
    return max(minimum, min(maximum, value))


def _read_csv_by_employee_id(
    path: Path,
    required_columns: list[str],
) -> tuple[dict[str, dict[str, str]], dict]:
    if not path.exists():
        raise FileNotFoundError(f"Required Kaggle dataset file not found: {path}")

    rows: dict[str, dict[str, str]] = {}
    stats = {
        "raw_rows": 0,
        "duplicate_employee_ids_removed": 0,
        "invalid_or_missing_rows_removed": 0,
        "original_rating_distribution": {},
    }
    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            stats["raw_rows"] += 1
            rating = row.get("performance_rating", "unknown") or "unknown"
            stats["original_rating_distribution"][rating] = (
                stats["original_rating_distribution"].get(rating, 0) + 1
            )
            employee_id = row.get("employee_id")
            if not employee_id or not _has_required_values(row, required_columns):
                stats["invalid_or_missing_rows_removed"] += 1
                continue
            if employee_id in rows:
                stats["duplicate_employee_ids_removed"] += 1
                continue
            rows[employee_id] = row
    return rows, stats


def _has_required_values(row: dict[str, str], required_columns: list[str]) -> bool:
    for column in required_columns:
        value = row.get(column)
        if value in (None, ""):
            return False
        if column != "employee_id":
            try:
                float(value)
            except ValueError:
                return False
    return True


def _combine_distributions(*distributions: dict[str, int]) -> dict[str, int]:
    combined: dict[str, int] = {}
    for distribution in distributions:
        for key, value in distribution.items():
            combined[key] = combined.get(key, 0) + value
    return combined


def _structured_score(row: dict[str, str]) -> float:
    return _clamp(
        (_float(row, "average_task_quality") * 10 * 0.22)
        + (_float(row, "client_satisfaction_score") * 0.24)
        + (_float(row, "deadline_met_score") * 10 * 0.18)
        + (_float(row, "innovation_score") * 10 * 0.16)
        + (_float(row, "efficiency_score") * 10 * 0.2)
    )


def _behavior_score(row: dict[str, str]) -> float:
    return _clamp(
        (_float(row, "collaboration_score") * 10 * 0.2)
        + (_float(row, "punctuality_score") * 10 * 0.13)
        + (_float(row, "work_engagement_score") * 10 * 0.18)
        + (_float(row, "peer_interaction_score") * 10 * 0.18)
        + (_float(row, "initiative_score") * 10 * 0.16)
        + (_float(row, "task_followup_score") * 10 * 0.15)
    )


def _audio_score(row: dict[str, str]) -> float:
    sentiment_component = ((_float(row, "speech_sentiment_score") + 1) / 2) * 100
    speed_component = 100 - min(abs(_float(row, "speaking_speed") - 135) * 1.8, 100)
    pause_component = 100 - min(_float(row, "pause_frequency") * 12, 100)
    return _clamp(
        (sentiment_component * 0.18)
        + (_float(row, "speech_energy_level") * 10 * 0.12)
        + (_float(row, "speech_clarity_score") * 10 * 0.22)
        + (_float(row, "tone_consistency_score") * 10 * 0.16)
        + (speed_component * 0.1)
        + (pause_component * 0.08)
        + (_float(row, "pitch_variation") * 10 * 0.06)
        + (_float(row, "volume_stability_score") * 10 * 0.08)
    )


def _blind_spot_count(
    structured: dict[str, str],
    behavior: dict[str, str],
    audio: dict[str, str],
) -> int:
    low_signal_count = 0
    low_signal_count += int(_float(behavior, "collaboration_score") < 5)
    low_signal_count += int(_float(behavior, "peer_interaction_score") < 5)
    low_signal_count += int(_float(audio, "speech_clarity_score") < 5)
    low_signal_count += int(_float(audio, "tone_consistency_score") < 5)
    low_signal_count += int(_float(structured, "client_satisfaction_score") < 55)
    return min(low_signal_count, 5)


def _float(row: dict[str, str], key: str, default: float = 0.0) -> float:
    value = row.get(key)
    if value in (None, ""):
        return default
    try:
        return float(value)
    except ValueError:
        return default
