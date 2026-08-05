"""
RAVDESS preprocessing for the MCA CNN Speech Emotion Recognition model.

Produces fixed-size (1, 128, 128) log-mel spectrograms instead of the
362-dim statistical feature vectors used by the SVM baseline.

Label contract is identical to the SVM baseline:
    0 neutral, 1 happy, 2 sad, 3 angry, 4 fearful, 5 disgust, 6 surprised

Usage:
    python preprocess_cnn.py --ravdess /path/to/ravdess --output mel_features.npz
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


# Audio parameters (must match inference in nudge_engine.py)
SAMPLE_RATE     = 22050
N_FFT           = 2048
HOP_LENGTH      = 512
N_MELS          = 128
TARGET_FRAMES   = 128   # fixed time dimension  →  (1, 128, 128) spectrogram
TARGET_SAMPLES  = (TARGET_FRAMES - 1) * HOP_LENGTH + N_FFT  # 67072 ≈ 3.04 s
MIN_DURATION_S  = 0.5

OUTPUT_PATH = "mel_features.npz"

LABEL_NAMES = ["neutral", "happy", "sad", "angry", "fearful", "disgust", "surprised"]
LABEL_TO_ID = {name: idx for idx, name in enumerate(LABEL_NAMES)}

RAVDESS_EMOTION_MAP = {
    "01": "neutral",
    "02": "neutral",  # calm → neutral (same as SVM baseline)
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


# File parsing
def parse_ravdess_filename(path: Path) -> RavdessRecord | None:
    parts = path.stem.split("-")
    if len(parts) != 7:
        return None
    emotion_code = parts[2]
    label = RAVDESS_EMOTION_MAP.get(emotion_code)
    if label is None:
        return None
    return RavdessRecord(path=path, emotion_code=emotion_code,
                         label=label, actor_id=parts[6])


def collect_records(ravdess_dir: Path) -> list[RavdessRecord]:
    return [
        r for path in sorted(ravdess_dir.rglob("*.wav"))
        if (r := parse_ravdess_filename(path)) is not None
    ]


# Audio loading
def load_audio(path: Path) -> np.ndarray | None:
    y, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    if y.size == 0:
        return None
    y, _ = librosa.effects.trim(y, top_db=40)
    if y.size < int(MIN_DURATION_S * SAMPLE_RATE):
        return None
    peak = np.max(np.abs(y))
    if peak > 0:
        y /= peak
    return y.astype(np.float32)


# Spectrogram extraction
def waveform_to_mel(y: np.ndarray) -> np.ndarray:
    """
    Convert a waveform to a fixed-size (1, N_MELS, TARGET_FRAMES) log-mel
    spectrogram normalised to [0, 1].

    Padding / truncation:
        - Short clips are zero-padded on the right.
        - Long clips are centre-cropped to TARGET_SAMPLES.
    """
    # Pad or centre-crop to TARGET_SAMPLES
    if y.size < TARGET_SAMPLES:
        pad = TARGET_SAMPLES - y.size
        y = np.pad(y, (0, pad), mode="constant")
    elif y.size > TARGET_SAMPLES:
        start = (y.size - TARGET_SAMPLES) // 2
        y = y[start: start + TARGET_SAMPLES]

    mel = librosa.feature.melspectrogram(
        y=y, sr=SAMPLE_RATE,
        n_fft=N_FFT, hop_length=HOP_LENGTH, n_mels=N_MELS,
    )
    mel_db = librosa.power_to_db(mel, ref=np.max)       # (N_MELS, frames)
    mel_db = mel_db[:, :TARGET_FRAMES]                   # exact truncation guard

    # Normalise to [0, 1]
    mel_min, mel_max = mel_db.min(), mel_db.max()
    if mel_max > mel_min:
        mel_db = (mel_db - mel_min) / (mel_max - mel_min)
    else:
        mel_db = np.zeros_like(mel_db)

    return mel_db[np.newaxis].astype(np.float32)         # (1, 128, 128)


# Augmentation
def augment_waveforms(y: np.ndarray) -> list[np.ndarray]:
    """Return original + 5 augmented versions (6× total)."""
    waves = [y]

    # 1. Additive white noise
    noise_amp = 0.005 * np.random.uniform() * np.amax(np.abs(y))
    waves.append(y + noise_amp * np.random.normal(size=y.shape[0]).astype(np.float32))

    # 2. Pitch shift +2 semitones
    try:
        waves.append(librosa.effects.pitch_shift(y, sr=SAMPLE_RATE, n_steps=2).astype(np.float32))
    except Exception:
        pass

    # 3. Pitch shift -2 semitones
    try:
        waves.append(librosa.effects.pitch_shift(y, sr=SAMPLE_RATE, n_steps=-2).astype(np.float32))
    except Exception:
        pass

    # 4. Time stretch slow (0.9×) — longer duration, lower perceived energy
    try:
        waves.append(librosa.effects.time_stretch(y, rate=0.9).astype(np.float32))
    except Exception:
        pass

    # 5. Time stretch fast (1.1×) — shorter duration, higher perceived energy
    try:
        waves.append(librosa.effects.time_stretch(y, rate=1.1).astype(np.float32))
    except Exception:
        pass

    return waves


def extract_spectrograms(path: Path) -> list[np.ndarray]:
    try:
        y = load_audio(path)
        if y is None:
            return []
        spectrograms = []
        for wave in augment_waveforms(y):
            mel = waveform_to_mel(wave)
            if np.all(np.isfinite(mel)):
                spectrograms.append(mel)
        return spectrograms
    except Exception as exc:
        print(f"Skipped {path}: {exc}")
        return []

# Main
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Preprocess RAVDESS into fixed-size mel spectrograms for the MCA CNN."
    )
    parser.add_argument("--ravdess", required=True,
                        help="Path to the RAVDESS root directory.")
    parser.add_argument("--output", default=OUTPUT_PATH,
                        help=f"Output .npz path. Default: {OUTPUT_PATH}")
    parser.add_argument("--skip-calm", action="store_true",
                        help="Drop RAVDESS code-02 (calm) files so neutral class has "
                             "~380 samples like other classes instead of ~1140.")
    args = parser.parse_args()

    ravdess_dir = Path(args.ravdess)
    output_path = Path(args.output)

    if not ravdess_dir.exists():
        raise FileNotFoundError(f"RAVDESS directory not found: {ravdess_dir}")

    print("=== MCA CNN Preprocessing: RAVDESS Mel Spectrograms ===")
    print(f"Label contract  : {LABEL_TO_ID}")
    print(f"Spectrogram shape: (1, {N_MELS}, {TARGET_FRAMES})")
    print(f"Audio parameters: sr={SAMPLE_RATE}, n_fft={N_FFT}, hop={HOP_LENGTH}")
    if args.skip_calm:
        print("skip-calm=True  : Dropping code-02 (calm) to balance neutral class")

    records = collect_records(ravdess_dir)
    if args.skip_calm:
        records = [r for r in records if r.emotion_code != "02"]
    if not records:
        raise RuntimeError(f"No valid RAVDESS .wav files found under: {ravdess_dir}")

    X, y_list, actor_ids, emotion_codes = [], [], [], []
    skipped = 0

    for record in tqdm(records, desc="Extracting mel spectrograms"):
        spectrograms = extract_spectrograms(record.path)
        if not spectrograms:
            skipped += 1
            continue
        for mel in spectrograms:
            X.append(mel)
            y_list.append(LABEL_TO_ID[record.label])
            actor_ids.append(record.actor_id)
            emotion_codes.append(record.emotion_code)

    if not X:
        raise RuntimeError("Spectrogram extraction produced no usable samples.")

    X_array    = np.stack(X, axis=0).astype(np.float32)   # (N, 1, 128, 128)
    y_array    = np.asarray(y_list, dtype=np.int64)
    actor_arr  = np.asarray(actor_ids)
    code_arr   = np.asarray(emotion_codes)

    # Remove exact duplicate spectrograms (same flat pixel values)
    X_flat = X_array.reshape(len(X_array), -1)
    _, unique_indices = np.unique(X_flat, axis=0, return_index=True)
    duplicate_count = len(X_array) - len(unique_indices)
    if duplicate_count:
        unique_indices = np.sort(unique_indices)
        X_array   = X_array[unique_indices]
        y_array   = y_array[unique_indices]
        actor_arr = actor_arr[unique_indices]
        code_arr  = code_arr[unique_indices]
        print(f"Removed {duplicate_count} duplicate spectrograms.")

    print(f"\nFinal dataset shape: {X_array.shape}")

    np.savez_compressed(
        output_path,
        X=X_array,
        y=y_array,
        actor=actor_arr,
        ravdess_emotion_code=code_arr,
        label_names=np.asarray(LABEL_NAMES),
        sample_rate=np.asarray(SAMPLE_RATE),
        n_mels=np.asarray(N_MELS),
        target_frames=np.asarray(TARGET_FRAMES),
        n_fft=np.asarray(N_FFT),
        hop_length=np.asarray(HOP_LENGTH),
    )

    class_counts = Counter(y_array)
    metadata = {
        "dataset": "RAVDESS",
        "model_type": "cnn",
        "output": str(output_path),
        "spectrogram_shape": [1, N_MELS, TARGET_FRAMES],
        "removed_duplicates": int(duplicate_count),
        "audio_params": {
            "sample_rate": SAMPLE_RATE, "n_fft": N_FFT,
            "hop_length": HOP_LENGTH, "n_mels": N_MELS,
            "target_frames": TARGET_FRAMES,
            "target_samples": TARGET_SAMPLES,
        },
        "label_to_id": LABEL_TO_ID,
        "ravdess_emotion_map": RAVDESS_EMOTION_MAP,
        "samples": int(len(y_array)),
        "skipped_files": int(skipped),
        "class_counts": {
            LABEL_NAMES[i]: int(class_counts.get(i, 0))
            for i in range(len(LABEL_NAMES))
        },
    }
    meta_path = output_path.with_suffix(".metadata.json")
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print("\nClass distribution")
    print(f"{'Emotion':<12} | {'Count':<7} | Ratio")
    print("-" * 36)
    total = len(y_array)
    for idx, name in enumerate(LABEL_NAMES):
        count = class_counts.get(idx, 0)
        print(f"{name:<12} | {count:<7} | {count / total * 100:>5.2f}%")

    print(f"\nSaved spectrograms : {output_path}")
    print(f"Saved metadata     : {meta_path}")
    print(f"Usable samples     : {total} | skipped: {skipped}")


if __name__ == "__main__":
    main()
