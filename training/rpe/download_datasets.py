"""
download_datasets.py
Downloads GoEmotions and DailyDialog datasets from HuggingFace.
Run once: python training/rpe/download_datasets.py
"""
from pathlib import Path

import pandas as pd
from datasets import load_dataset

RAW_DIR = Path(__file__).parent / "dataset" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)


def download_go_emotions() -> None:
    print("Downloading GoEmotions...")
    ds = load_dataset("go_emotions", "simplified")
    rows = []
    for split in ["train", "validation", "test"]:
        for item in ds[split]:
            rows.append({
                "text":  item["text"],
                "label": item["labels"][0] if item["labels"] else 0,
            })
    df = pd.DataFrame(rows)
    label_names = ds["train"].features["labels"].feature.names
    df["label_name"] = df["label"].apply(
        lambda i: label_names[i] if i < len(label_names) else "neutral"
    )
    out = RAW_DIR / "go_emotions_raw.csv"
    df.to_csv(out, index=False)
    print(f"GoEmotions saved: {len(df)} rows -> {out}")


def download_daily_dialog() -> None:
    print("Downloading DailyDialog...")
    ds = load_dataset("daily_dialog", trust_remote_code=True)
    # DailyDialog emotion labels:
    # 0=no emotion, 1=anger, 2=disgust, 3=fear,
    # 4=happiness, 5=sadness, 6=surprise
    emotion_map = {
        0: "neutral", 1: "anger",   2: "disgust",
        3: "fear",    4: "happiness", 5: "sadness", 6: "surprise",
    }
    rows = []
    for split in ["train", "validation", "test"]:
        for dialog in ds[split]:
            utterances = dialog["dialog"]
            emotions   = dialog["emotion"]
            for utt, emo in zip(utterances, emotions):
                if utt.strip():
                    rows.append({
                        "text":       utt.strip(),
                        "label_name": emotion_map.get(emo, "neutral"),
                    })
    df = pd.DataFrame(rows)
    out = RAW_DIR / "daily_dialog_raw.csv"
    df.to_csv(out, index=False)
    print(f"DailyDialog saved: {len(df)} rows -> {out}")


if __name__ == "__main__":
    download_go_emotions()
    try:
        download_daily_dialog()
    except Exception as exc:
        print(f"DailyDialog download failed (non-fatal): {exc}")
        print("Continuing with GoEmotions only.")
    print("Download complete.")
