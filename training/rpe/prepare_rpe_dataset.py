"""
prepare_rpe_dataset.py
Maps GoEmotions + DailyDialog labels to RPE schema,
merges with existing synthetic rows.
Run after download_datasets.py.
"""
from pathlib import Path

import pandas as pd

DATASET_DIR = Path(__file__).parent / "dataset"
RAW_DIR     = DATASET_DIR / "raw"

# ── Label mappings ────────────────────────────────────────────────────────────

GO_EMOTIONS_MAP: dict[str, str] = {
    "anger":         "frustrated",
    "annoyance":     "frustrated",
    "disapproval":   "frustrated",
    "disgust":       "frustrated",
    "nervousness":   "anxious",
    "fear":          "anxious",
    "embarrassment": "anxious",
    "remorse":       "anxious",
    "approval":      "assertive",
    "realization":   "assertive",
    "pride":         "assertive",
    "neutral":       "calm",
    "relief":        "calm",
    "gratitude":     "calm",
    "caring":        "calm",
    "confusion":     "confused",
    "curiosity":     "confused",
    "surprise":      "confused",
    # Unmapped (dropped): joy, love, excitement, amusement, grief, sadness, optimism
}

DAILY_DIALOG_MAP: dict[str, str] = {
    "anger":   "frustrated",
    "disgust": "frustrated",
    "fear":    "anxious",
    "neutral": "calm",
    "surprise":"confused",
    # Dropped: happiness, sadness
}

TRUST_DELTA_MAP: dict[str, int] = {
    "assertive": 2, "calm": 1, "confused": 0,
    "anxious": -1,  "frustrated": -2,
}

ESCALATION_MAP: dict[str, int] = {
    "frustrated": 2, "anxious": 1, "confused": 1,
    "calm": 0,       "assertive": 0,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def map_dataset(
    df: pd.DataFrame, label_col: str, label_map: dict[str, str]
) -> pd.DataFrame:
    df = df.copy()
    df["emotion_label"] = df[label_col].map(label_map)
    df = df.dropna(subset=["emotion_label"])
    df = df.rename(columns={"text": "user_input"})
    df["trust_delta"]      = df["emotion_label"].map(TRUST_DELTA_MAP)
    df["escalation_label"] = df["emotion_label"].map(ESCALATION_MAP)
    return df[["user_input", "emotion_label", "trust_delta", "escalation_label"]]


def balance_dataset(df: pd.DataFrame, max_per_class: int = 2000) -> pd.DataFrame:
    """Cap each emotion class to avoid severe imbalance."""
    parts = [
        group.sample(min(len(group), max_per_class), random_state=42)
        for _, group in df.groupby("emotion_label")
    ]
    return pd.concat(parts, ignore_index=True)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    # Load GoEmotions
    ge_raw = pd.read_csv(RAW_DIR / "go_emotions_raw.csv")
    ge_df  = map_dataset(ge_raw, "label_name", GO_EMOTIONS_MAP)
    print(f"GoEmotions mapped: {len(ge_df)} rows")

    # Load DailyDialog (optional — skipped if file not present)
    dd_path = RAW_DIR / "daily_dialog_raw.csv"
    sources = [ge_df]
    if dd_path.exists():
        dd_raw = pd.read_csv(dd_path)
        dd_df  = map_dataset(dd_raw, "label_name", DAILY_DIALOG_MAP)
        print(f"DailyDialog mapped: {len(dd_df)} rows")
        sources.append(dd_df)
    else:
        print("DailyDialog not found — skipping.")

    # Load existing synthetic dataset (preserve all RPE-specific rows)
    existing = pd.read_csv(DATASET_DIR / "soft_skills_dataset.csv")[
        ["user_input", "emotion_label", "trust_delta", "escalation_label"]
    ]
    print(f"Existing synthetic rows: {len(existing)}")
    sources.append(existing)

    # Merge all available sources
    merged = pd.concat(sources, ignore_index=True)

    # Balance — cap large classes, synthetic rows always included
    balanced = balance_dataset(merged, max_per_class=2000)

    # Shuffle
    balanced = balanced.sample(frac=1, random_state=42).reset_index(drop=True)

    out = DATASET_DIR / "merged_rpe_dataset.csv"
    balanced.to_csv(out, index=False)
    print(f"\nMerged dataset: {len(balanced)} rows -> {out}")
    print("\nClass distribution:")
    print(balanced["emotion_label"].value_counts())


if __name__ == "__main__":
    main()
