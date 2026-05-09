"""
RAVDESS-only preprocessing for the MCA Speech Emotion Recognition baseline.

This script intentionally preserves the backend label contract:
    0 neutral, 1 happy, 2 sad, 3 angry, 4 fearful, 5 disgust, 6 surprised

RAVDESS code "02" is mapped to "neutral" because the MCA affect-fusion rules use
neutral as the calm/baseline speaking state.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
from tqdm import tqdm


SAMPLE_RATE = 22050
MIN_DURATION_SECONDS = 0.5
OUTPUT_PATH = "features.npz"

LABEL_NAMES = [
    "neutral",
    "happy",
    "sad",
    "angry",
    "fearful",
    "disgust",
    "surprised",
]
LABEL_TO_ID = {label: idx for idx, label in enumerate(LABEL_NAMES)}

# RAVDESS filename emotion code. Code 02 is "calm", kept as neutral for MCA.
RAVDESS_EMOTION_MAP = {
    "01": "neutral",
    "02": "neutral",
    "03": "happy",
    "04": "sad",
    "05": "angry",
    "06": "fearful",
    "07": "disgust",
    "08": "surprised",
}


@dataclass(frozen=True)
class RavdessRecord:
    path: Path
    emotion_code: str
    label: str
    actor_id: str


def parse_ravdess_filename(path: Path) -> RavdessRecord | None:
    """
    RAVDESS audio filenames follow:
    modality-vocal_channel-emotion-intensity-statement-repetition-actor.wav
    Example: 03-01-02-01-01-01-12.wav
    """
    parts = path.stem.split("-")
    if len(parts) != 7:
        return None

    emotion_code = parts[2]
    label = RAVDESS_EMOTION_MAP.get(emotion_code)
    if label is None:
        return None

    return RavdessRecord(
        path=path,
        emotion_code=emotion_code,
        label=label,
        actor_id=parts[6],
    )


def load_audio(path: Path, sample_rate: int = SAMPLE_RATE) -> np.ndarray | None:
    y, _ = librosa.load(path, sr=sample_rate, mono=True)

    if y.size == 0:
        return None

    y, _ = librosa.effects.trim(y, top_db=40)
    if y.size < int(MIN_DURATION_SECONDS * sample_rate):
        return None

    peak = np.max(np.abs(y))
    if peak > 0:
        y = y / peak

    return y.astype(np.float32)


def extract_features_from_array(y: np.ndarray) -> np.ndarray | None:
    mfcc_features = librosa.feature.mfcc(y=y, sr=SAMPLE_RATE, n_mfcc=40).T
    mfcc_mean = np.mean(mfcc_features, axis=0)
    mfcc_std = np.std(mfcc_features, axis=0)

    stft = np.abs(librosa.stft(y))
    chroma_features = librosa.feature.chroma_stft(S=stft, sr=SAMPLE_RATE).T
    chroma_mean = np.mean(chroma_features, axis=0)
    chroma_std = np.std(chroma_features, axis=0)

    mel_features = librosa.feature.melspectrogram(y=y, sr=SAMPLE_RATE).T
    mel_mean = np.mean(mel_features, axis=0)
    mel_std = np.std(mel_features, axis=0)

    f0 = librosa.yin(
        y,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C7"),
    )
    voiced_f0 = f0[np.isfinite(f0) & (f0 > 0)]
    pitch_mean = float(np.mean(voiced_f0)) if voiced_f0.size else 0.0
    pitch_std = float(np.std(voiced_f0)) if voiced_f0.size else 0.0

    features = np.hstack((
        mfcc_mean, mfcc_std,
        chroma_mean, chroma_std,
        mel_mean, mel_std,
        np.array([pitch_mean, pitch_std], dtype=np.float32)
    ))
    if features.shape[0] != 362 or not np.all(np.isfinite(features)):
        return None

    return features.astype(np.float32)

def extract_features(path: Path) -> list[np.ndarray]:
    try:
        y = load_audio(path)
        if y is None:
            return []

        augmented_waveforms = [y]
        
        # 1. Add subtle white noise
        noise_amp = 0.005 * np.random.uniform() * np.amax(y)
        y_noise = y + noise_amp * np.random.normal(size=y.shape[0])
        augmented_waveforms.append(y_noise)

        # 2. Pitch shift up (+2 semitones)
        y_pitch_up = librosa.effects.pitch_shift(y, sr=SAMPLE_RATE, n_steps=2)
        augmented_waveforms.append(y_pitch_up)
        
        # 3. Pitch shift down (-2 semitones)
        y_pitch_down = librosa.effects.pitch_shift(y, sr=SAMPLE_RATE, n_steps=-2)
        augmented_waveforms.append(y_pitch_down)
        
        features_list = []
        for wave in augmented_waveforms:
            feat = extract_features_from_array(wave)
            if feat is not None:
                features_list.append(feat)

        return features_list
    except Exception as exc:
        print(f"Skipped {path}: {exc}")
        return []


def collect_records(ravdess_dir: Path) -> list[RavdessRecord]:
    wav_files = sorted(ravdess_dir.rglob("*.wav"))
    records = []
    for path in wav_files:
        record = parse_ravdess_filename(path)
        if record is not None:
            records.append(record)
    return records


def save_metadata(output_path: Path, metadata: dict) -> None:
    metadata_path = output_path.with_suffix(".metadata.json")
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Preprocess RAVDESS audio into MCA-compatible SER features."
    )
    parser.add_argument("--ravdess", required=True, help="Path to the RAVDESS root directory")
    parser.add_argument(
        "--output",
        default=OUTPUT_PATH,
        help=f"Output .npz path. Defaults to {OUTPUT_PATH} for train_svm.py compatibility.",
    )
    args = parser.parse_args()

    ravdess_dir = Path(args.ravdess)
    output_path = Path(args.output)

    if not ravdess_dir.exists():
        raise FileNotFoundError(f"RAVDESS directory does not exist: {ravdess_dir}")

    print("=== MCA SER Preprocessing: RAVDESS Only ===")
    print("Label contract:", LABEL_TO_ID)
    print('RAVDESS code "02" is mapped to "neutral".')

    records = collect_records(ravdess_dir)
    if not records:
        raise RuntimeError(f"No valid RAVDESS .wav files found under: {ravdess_dir}")

    X, y, actor_ids, emotion_codes, file_paths = [], [], [], [], []
    skipped = 0

    for record in tqdm(records, desc="Extracting RAVDESS features"):
        features_list = extract_features(record.path)
        if not features_list:
            skipped += 1
            continue

        for features in features_list:
            X.append(features)
            y.append(LABEL_TO_ID[record.label])
            actor_ids.append(record.actor_id)
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
        ravdess_emotion_code=code_array,
        file_path=path_array,
        label_names=np.asarray(LABEL_NAMES),
        sample_rate=np.asarray(SAMPLE_RATE),
        source=np.asarray(["RAVDESS"] * len(y_array)),
    )

    class_counts = Counter(y_array)
    code_counts = Counter(code_array)
    metadata = {
        "dataset": "RAVDESS",
        "output": str(output_path),
        "sample_rate": SAMPLE_RATE,
        "feature_order": ["mfcc_mean_40", "mfcc_std_40", "chroma_mean_12", "chroma_std_12", "mel_mean_128", "mel_std_128", "pitch_mean_1", "pitch_std_1"],
        "feature_dimensions": int(X_array.shape[1]),
        "label_to_id": LABEL_TO_ID,
        "ravdess_emotion_map": RAVDESS_EMOTION_MAP,
        "samples": int(len(y_array)),
        "actors": int(len(set(actor_array.tolist()))),
        "skipped_files": int(skipped),
        "removed_duplicates": int(duplicate_count),
        "class_counts": {LABEL_NAMES[idx]: int(class_counts[idx]) for idx in sorted(class_counts)},
        "ravdess_code_counts": {code: int(code_counts[code]) for code in sorted(code_counts)},
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
