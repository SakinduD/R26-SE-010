"""
SUBESCO-only preprocessing for the MCA Speech Emotion Recognition baseline.

Preserves the backend label/feature contract used by ../ravdess/preprocess.py:
    362-dim vector: MFCC(40 mean+std) + chroma(12 mean+std) + mel(128 mean+std) + pitch(mean+std)
    0 neutral, 1 happy, 2 sad, 3 angry, 4 fearful, 5 disgust, 6 surprised

Reuses ../ravdess/preprocess.py's audio-loading/feature-extraction (including
its 4x noise/pitch-shift augmentation) so the two datasets never drift apart.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ravdess"))
from preprocess import (  # noqa: E402
    LABEL_NAMES,
    LABEL_TO_ID,
    SAMPLE_RATE,
    extract_features,
    extract_features_from_array,
    load_audio,
    save_metadata,
)

OUTPUT_PATH = "features.npz"

# SUBESCO filenames encode emotion in upper case; maps onto the same 7-class
# contract used by RAVDESS_EMOTION_MAP in ../ravdess/preprocess.py.
SUBESCO_EMOTION_MAP = {
    "ANGRY": "angry",
    "DISGUST": "disgust",
    "FEAR": "fearful",
    "HAPPY": "happy",
    "NEUTRAL": "neutral",
    "SAD": "sad",
    "SURPRISE": "surprised",
}


@dataclass(frozen=True)
class SubescoRecord:
    path: Path
    emotion_code: str
    label: str
    speaker_id: str  # namespaced, e.g. "subesco_F01"


def parse_subesco_filename(path: Path) -> SubescoRecord | None:
    """
    SUBESCO audio filenames follow:
        GENDER_SPEAKERID_NAME_S_SENTENCEID_EMOTION_TAKE.wav
    Example: F_01_OISHI_S_10_ANGRY_1.wav

    One known file in the corpus has a stray "]" before the extension
    (F_02_MONIKA_S_2_SURPRISE_3].wav) -- stripped before parsing.
    """
    stem = path.stem.rstrip("]")
    parts = stem.split("_")
    if len(parts) != 7:
        return None

    gender, speaker_num = parts[0], parts[1]
    emotion_code = parts[5]
    label = SUBESCO_EMOTION_MAP.get(emotion_code)
    if label is None:
        return None

    return SubescoRecord(
        path=path,
        emotion_code=emotion_code,
        label=label,
        speaker_id=f"subesco_{gender}{speaker_num}",
    )


def collect_records(subesco_dir: Path) -> list[SubescoRecord]:
    records = []
    skipped_names = []
    for path in sorted(subesco_dir.glob("*.wav")):
        record = parse_subesco_filename(path)
        if record is not None:
            records.append(record)
        else:
            skipped_names.append(path.name)
    if skipped_names:
        print(f"Could not parse {len(skipped_names)} SUBESCO filename(s): {skipped_names[:5]}")
    return records


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Preprocess SUBESCO audio into MCA-compatible SER features."
    )
    parser.add_argument(
        "--subesco",
        default="../../data/subesco",
        help="Path to the flat SUBESCO directory of .wav files.",
    )
    parser.add_argument(
        "--output",
        default=OUTPUT_PATH,
        help=f"Output .npz path. Defaults to {OUTPUT_PATH} for train_svm.py compatibility.",
    )
    parser.add_argument(
        "--no-augment",
        action="store_true",
        help="Skip the noise/pitch-shift augmentation and use raw SUBESCO clips only.",
    )
    args = parser.parse_args()

    subesco_dir = Path(args.subesco)
    output_path = Path(args.output)

    if not subesco_dir.exists():
        raise FileNotFoundError(f"SUBESCO directory does not exist: {subesco_dir}")

    augment = not args.no_augment
    print("=== MCA SER Preprocessing: SUBESCO Only ===")
    print("Label contract:", LABEL_TO_ID)
    print(f"Augmentation: {'on (4x: original + noise + pitch+2 + pitch-2)' if augment else 'off (originals only)'}")

    records = collect_records(subesco_dir)
    if not records:
        raise RuntimeError(f"No valid SUBESCO .wav files found under: {subesco_dir}")

    X, y, actor_ids, emotion_codes, file_paths = [], [], [], [], []
    skipped = 0

    for record in tqdm(records, desc="Extracting SUBESCO features"):
        if augment:
            feats = extract_features(record.path)
        else:
            try:
                waveform = load_audio(record.path, sample_rate=SAMPLE_RATE)
            except Exception as exc:
                print(f"Skipped {record.path}: {exc}")
                waveform = None
            feat = extract_features_from_array(waveform) if waveform is not None else None
            feats = [feat] if feat is not None else []

        if not feats:
            skipped += 1
            continue

        for feat in feats:
            X.append(feat)
            y.append(LABEL_TO_ID[record.label])
            actor_ids.append(record.speaker_id)
            emotion_codes.append(record.emotion_code)
            file_paths.append(str(record.path))

    if not X:
        raise RuntimeError("Feature extraction produced no usable samples.")

    X_array = np.vstack(X).astype(np.float32)
    y_array = np.asarray(y, dtype=np.int64)
    actor_array = np.asarray(actor_ids)
    code_array = np.asarray(emotion_codes)
    path_array = np.asarray(file_paths)

    _, unique_indices = np.unique(X_array, axis=0, return_index=True)
    duplicate_count = len(X_array) - len(unique_indices)
    if duplicate_count:
        unique_indices = np.sort(unique_indices)
        X_array = X_array[unique_indices]
        y_array = y_array[unique_indices]
        actor_array = actor_array[unique_indices]
        code_array = code_array[unique_indices]
        path_array = path_array[unique_indices]

    np.savez_compressed(
        output_path,
        X=X_array,
        y=y_array,
        actor=actor_array,
        subesco_emotion_code=code_array,
        file_path=path_array,
        label_names=np.asarray(LABEL_NAMES),
        sample_rate=np.asarray(SAMPLE_RATE),
        source=np.asarray(["SUBESCO"] * len(y_array)),
    )

    class_counts = Counter(y_array)
    metadata = {
        "dataset": "SUBESCO",
        "output": str(output_path),
        "augmented": augment,
        "sample_rate": SAMPLE_RATE,
        "feature_order": ["mfcc_mean_40", "mfcc_std_40", "chroma_mean_12", "chroma_std_12", "mel_mean_128", "mel_std_128", "pitch_mean_1", "pitch_std_1"],
        "feature_dimensions": int(X_array.shape[1]),
        "label_to_id": LABEL_TO_ID,
        "subesco_emotion_map": SUBESCO_EMOTION_MAP,
        "samples": int(len(y_array)),
        "actors": int(len(set(actor_array.tolist()))),
        "skipped_files": int(skipped),
        "removed_duplicates": int(duplicate_count),
        "class_counts": {LABEL_NAMES[idx]: int(class_counts[idx]) for idx in sorted(class_counts)},
    }
    save_metadata(output_path, metadata)

    print("\nClass distribution")
    print(f"{'Emotion':<12} | {'Count':<7} | {'Ratio'}")
    print("-" * 36)
    for idx in range(len(LABEL_NAMES)):
        count = class_counts.get(idx, 0)
        ratio = (count / len(y_array)) * 100
        print(f"{LABEL_NAMES[idx]:<12} | {count:<7} | {ratio:>5.2f}%")

    print(f"\nSaved features: {output_path}")
    print(f"Saved metadata: {output_path.with_suffix('.metadata.json')}")
    print(f"Usable samples: {len(y_array)} | skipped: {skipped} | duplicates removed: {duplicate_count}")


if __name__ == "__main__":
    main()
