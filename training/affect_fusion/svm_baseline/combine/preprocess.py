"""
RAVDESS + SUBESCO combined preprocessing for the MCA Speech Emotion
Recognition baseline.

Reuses ../ravdess/preprocess.py and ../subesco/preprocess.py so all three
legs share one source of truth for the 362-dim feature layout and 0-6 label
contract the backend hardcodes. Both datasets get the same 4x augmentation.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from tqdm import tqdm

_ROOT = Path(__file__).resolve().parent.parent


def _load_module(name: str, path: Path):
    """Load a sibling preprocess.py by file path (both are named "preprocess.py",
    so a plain import would collide via sys.modules)."""
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    # Must register before exec_module for dataclass forward-ref resolution.
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_ravdess_preprocess = _load_module("ravdess_preprocess", _ROOT / "ravdess" / "preprocess.py")
_subesco_preprocess = _load_module("subesco_preprocess", _ROOT / "subesco" / "preprocess.py")

LABEL_NAMES = _ravdess_preprocess.LABEL_NAMES
LABEL_TO_ID = _ravdess_preprocess.LABEL_TO_ID
SAMPLE_RATE = _ravdess_preprocess.SAMPLE_RATE
collect_ravdess_records = _ravdess_preprocess.collect_records
extract_ravdess_features = _ravdess_preprocess.extract_features

OUTPUT_PATH = "features.npz"


def save_metadata(output_path: Path, metadata: dict) -> None:
    metadata_path = output_path.with_suffix(".metadata.json")
    metadata_path.write_text(__import__("json").dumps(metadata, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Preprocess RAVDESS + SUBESCO audio into MCA-compatible SER features."
    )
    parser.add_argument(
        "--ravdess",
        default="../../data/ravdess/audio_speech_actors_01-24",
        help="Path to the RAVDESS root directory (Actor_01..Actor_24).",
    )
    parser.add_argument(
        "--subesco",
        default="../../data/subesco",
        help="Path to the flat SUBESCO directory of .wav files.",
    )
    parser.add_argument(
        "--output",
        default=OUTPUT_PATH,
        help=f"Output .npz path. Defaults to {OUTPUT_PATH}.",
    )
    args = parser.parse_args()

    ravdess_dir = Path(args.ravdess)
    subesco_dir = Path(args.subesco)
    output_path = Path(args.output)

    if not ravdess_dir.exists():
        raise FileNotFoundError(f"RAVDESS directory does not exist: {ravdess_dir}")
    if not subesco_dir.exists():
        raise FileNotFoundError(f"SUBESCO directory does not exist: {subesco_dir}")

    print("=== MCA SER Preprocessing: RAVDESS + SUBESCO ===")
    print("Label contract:", LABEL_TO_ID)

    ravdess_records = collect_ravdess_records(ravdess_dir)
    if not ravdess_records:
        raise RuntimeError(f"No valid RAVDESS .wav files found under: {ravdess_dir}")

    subesco_records = _subesco_preprocess.collect_records(subesco_dir)
    if not subesco_records:
        raise RuntimeError(f"No valid SUBESCO .wav files found under: {subesco_dir}")

    X, y, actor_ids, source, emotion_codes, file_paths = [], [], [], [], [], []
    ravdess_skipped = 0
    subesco_skipped = 0

    for record in tqdm(ravdess_records, desc="Extracting RAVDESS features (augmented)"):
        features_list = extract_ravdess_features(record.path)
        if not features_list:
            ravdess_skipped += 1
            continue
        for features in features_list:
            X.append(features)
            y.append(LABEL_TO_ID[record.label])
            actor_ids.append(f"ravdess_{record.actor_id}")
            source.append("RAVDESS")
            emotion_codes.append(record.emotion_code)
            file_paths.append(str(record.path))

    for record in tqdm(subesco_records, desc="Extracting SUBESCO features (augmented)"):
        # Reuses ravdess's generic augmentation pipeline for SUBESCO too.
        features_list = extract_ravdess_features(record.path)
        if not features_list:
            subesco_skipped += 1
            continue
        for feat in features_list:
            X.append(feat)
            y.append(LABEL_TO_ID[record.label])
            actor_ids.append(record.speaker_id)
            source.append("SUBESCO")
            emotion_codes.append(record.emotion_code)
            file_paths.append(str(record.path))

    if not X:
        raise RuntimeError("Feature extraction produced no usable samples.")

    X_array = np.vstack(X).astype(np.float32)
    y_array = np.asarray(y, dtype=np.int64)
    actor_array = np.asarray(actor_ids)
    source_array = np.asarray(source)
    code_array = np.asarray(emotion_codes)
    path_array = np.asarray(file_paths)

    _, unique_indices = np.unique(X_array, axis=0, return_index=True)
    duplicate_count = len(X_array) - len(unique_indices)
    if duplicate_count:
        unique_indices = np.sort(unique_indices)
        X_array = X_array[unique_indices]
        y_array = y_array[unique_indices]
        actor_array = actor_array[unique_indices]
        source_array = source_array[unique_indices]
        code_array = code_array[unique_indices]
        path_array = path_array[unique_indices]

    np.savez_compressed(
        output_path,
        X=X_array,
        y=y_array,
        actor=actor_array,
        source=source_array,
        emotion_code=code_array,
        file_path=path_array,
        label_names=np.asarray(LABEL_NAMES),
        sample_rate=np.asarray(SAMPLE_RATE),
    )

    class_counts = Counter(y_array)
    class_counts_by_source = {
        src: Counter(y_array[source_array == src].tolist())
        for src in sorted(set(source_array.tolist()))
    }
    metadata = {
        "dataset": "RAVDESS+SUBESCO",
        "output": str(output_path),
        "feature_order": [
            "mfcc_mean_40", "mfcc_std_40",
            "chroma_mean_12", "chroma_std_12",
            "mel_mean_128", "mel_std_128",
            "pitch_mean_1", "pitch_std_1",
        ],
        "feature_dimensions": int(X_array.shape[1]),
        "label_to_id": LABEL_TO_ID,
        "samples": int(len(y_array)),
        "actors": int(len(set(actor_array.tolist()))),
        "ravdess_skipped_files": int(ravdess_skipped),
        "subesco_skipped_files": int(subesco_skipped),
        "removed_duplicates": int(duplicate_count),
        "class_counts": {LABEL_NAMES[idx]: int(class_counts[idx]) for idx in sorted(class_counts)},
        "class_counts_by_source": {
            src: {LABEL_NAMES[idx]: int(counts[idx]) for idx in sorted(counts)}
            for src, counts in class_counts_by_source.items()
        },
        "sample_counts_by_source": {
            src: int((source_array == src).sum()) for src in sorted(set(source_array.tolist()))
        },
    }
    save_metadata(output_path, metadata)

    print("\nClass distribution (combined)")
    print(f"{'Emotion':<12} | {'Count':<7} | {'Ratio'}")
    print("-" * 36)
    for idx in range(len(LABEL_NAMES)):
        count = class_counts.get(idx, 0)
        ratio = (count / len(y_array)) * 100
        print(f"{LABEL_NAMES[idx]:<12} | {count:<7} | {ratio:>5.2f}%")

    print(f"\nSaved features: {output_path}")
    print(f"Saved metadata: {output_path.with_suffix('.metadata.json')}")
    print(
        f"Usable samples: {len(y_array)} "
        f"(RAVDESS skipped: {ravdess_skipped}, SUBESCO skipped: {subesco_skipped}, "
        f"duplicates removed: {duplicate_count})"
    )


if __name__ == "__main__":
    main()
