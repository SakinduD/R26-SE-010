"""
RAVDESS + SUBESCO combined preprocessing for the MCA CNN Speech Emotion
Recognition model.

Produces fixed-size (1, 128, 128) log-mel spectrograms instead of the
362-dim statistical feature vectors used by the SVM baseline.

Label contract is identical to the SVM baseline and the RAVDESS-only CNN
baseline (../preprocess_cnn.py):
    0 neutral, 1 happy, 2 sad, 3 angry, 4 fearful, 5 disgust, 6 surprised

Actor IDs are namespaced per source ("ravdess_01", "subesco_F01") so the
actor-grouped split in train_cnn.py never places the same speaker on both
sides of a split or collides across sources.

Usage:
    python preprocess_cnn.py \
        --ravdess /path/to/ravdess --subesco /path/to/subesco \
        --output mel_features_combined.npz --skip-calm
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


# Audio parameters (must match inference in nudge_engine.py and
# ../preprocess_cnn.py -- keep these two files' values in sync)
SAMPLE_RATE     = 22050
N_FFT           = 2048
HOP_LENGTH      = 512
N_MELS          = 128
TARGET_FRAMES   = 128   # fixed time dimension  →  (1, 128, 128) spectrogram
TARGET_SAMPLES  = (TARGET_FRAMES - 1) * HOP_LENGTH + N_FFT  # 67072 ≈ 3.04 s
MIN_DURATION_S  = 0.5

OUTPUT_PATH = "mel_features_combined.npz"

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

# Mirrors ../../svm_baseline/subesco/preprocess.py's SUBESCO_EMOTION_MAP --
# keep these in sync if that one ever changes.
SUBESCO_EMOTION_MAP = {
    "ANGRY":    "angry",
    "DISGUST":  "disgust",
    "FEAR":     "fearful",
    "HAPPY":    "happy",
    "NEUTRAL":  "neutral",
    "SAD":      "sad",
    "SURPRISE": "surprised",
}


@dataclass(frozen=True)
class RavdessRecord:
    path: Path
    emotion_code: str
    label: str
    actor_id: str  # namespaced at collection time: "ravdess_01"


@dataclass(frozen=True)
class SubescoRecord:
    path: Path
    emotion_code: str
    label: str
    actor_id: str  # namespaced, e.g. "subesco_F01"


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
                         label=label, actor_id=f"ravdess_{parts[6]}")


def collect_ravdess_records(ravdess_dir: Path) -> list[RavdessRecord]:
    return [
        r for path in sorted(ravdess_dir.rglob("*.wav"))
        if (r := parse_ravdess_filename(path)) is not None
    ]


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
        path=path, emotion_code=emotion_code, label=label,
        actor_id=f"subesco_{gender}{speaker_num}",
    )


def collect_subesco_records(subesco_dir: Path) -> list[SubescoRecord]:
    records, skipped_names = [], []
    for path in sorted(subesco_dir.glob("*.wav")):
        record = parse_subesco_filename(path)
        if record is not None:
            records.append(record)
        else:
            skipped_names.append(path.name)
    if skipped_names:
        print(f"Could not parse {len(skipped_names)} SUBESCO filename(s): {skipped_names[:5]}")
    return records


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
    """Convert a waveform to a fixed-size (1, N_MELS, TARGET_FRAMES) log-mel
    spectrogram normalised to [0, 1]."""
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
def augment_waveforms(y: np.ndarray, max_variants: int | None = None) -> list[np.ndarray]:
    """Return original + up to 5 augmented versions (6x total by default).

    max_variants short-circuits before the expensive pitch-shift/time-stretch
    steps run. SUBESCO is usually run with a lower cap (--subesco-augment-cap)
    since it already has more raw diversity than RAVDESS.
    """
    waves = [y]
    if max_variants is not None and len(waves) >= max_variants:
        return waves

    # 1. Additive white noise
    noise_amp = 0.005 * np.random.uniform() * np.amax(np.abs(y))
    waves.append(y + noise_amp * np.random.normal(size=y.shape[0]).astype(np.float32))
    if max_variants is not None and len(waves) >= max_variants:
        return waves

    # 2. Pitch shift +2 semitones
    try:
        waves.append(librosa.effects.pitch_shift(y, sr=SAMPLE_RATE, n_steps=2).astype(np.float32))
    except Exception:
        pass
    if max_variants is not None and len(waves) >= max_variants:
        return waves

    # 3. Pitch shift -2 semitones
    try:
        waves.append(librosa.effects.pitch_shift(y, sr=SAMPLE_RATE, n_steps=-2).astype(np.float32))
    except Exception:
        pass
    if max_variants is not None and len(waves) >= max_variants:
        return waves

    # 4. Time stretch slow (0.9×) — longer duration, lower perceived energy
    try:
        waves.append(librosa.effects.time_stretch(y, rate=0.9).astype(np.float32))
    except Exception:
        pass
    if max_variants is not None and len(waves) >= max_variants:
        return waves

    # 5. Time stretch fast (1.1×) — shorter duration, higher perceived energy
    try:
        waves.append(librosa.effects.time_stretch(y, rate=1.1).astype(np.float32))
    except Exception:
        pass

    return waves


def extract_spectrograms(path: Path, max_variants: int | None = None) -> list[np.ndarray]:
    try:
        y = load_audio(path)
        if y is None:
            return []
        spectrograms = []
        for wave in augment_waveforms(y, max_variants=max_variants):
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
        description="Preprocess RAVDESS + SUBESCO audio into MCA-compatible mel spectrograms."
    )
    parser.add_argument("--ravdess", required=True, help="Path to the RAVDESS root directory.")
    parser.add_argument("--subesco", required=True, help="Path to the flat SUBESCO directory of .wav files.")
    parser.add_argument("--output", default=OUTPUT_PATH,
                        help=f"Output .npz path. Default: {OUTPUT_PATH}")
    parser.add_argument("--skip-calm", action="store_true",
                        help="Drop RAVDESS code-02 (calm) files so neutral class has "
                             "~380 samples like other classes instead of ~1140.")
    parser.add_argument("--dedup", action="store_true",
                        help="Run the (memory-heavy) exact-duplicate check across the whole "
                             "combined dataset. Off by default.")
    parser.add_argument("--subesco-augment-cap", type=int, default=None,
                        help="Cap SUBESCO's augmentation multiplier (1-6; RAVDESS always gets "
                             "the full 6x). Default (unset) keeps the full 6x for both sources.")
    args = parser.parse_args()

    ravdess_dir = Path(args.ravdess)
    subesco_dir = Path(args.subesco)
    output_path = Path(args.output)

    if not ravdess_dir.exists():
        raise FileNotFoundError(f"RAVDESS directory not found: {ravdess_dir}")
    if not subesco_dir.exists():
        raise FileNotFoundError(f"SUBESCO directory not found: {subesco_dir}")

    print("=== MCA CNN Preprocessing: RAVDESS + SUBESCO Mel Spectrograms ===")
    print(f"Label contract   : {LABEL_TO_ID}")
    print(f"Spectrogram shape: (1, {N_MELS}, {TARGET_FRAMES})")
    if args.skip_calm:
        print("skip-calm=True   : Dropping RAVDESS code-02 (calm)")

    ravdess_records = collect_ravdess_records(ravdess_dir)
    if args.skip_calm:
        ravdess_records = [r for r in ravdess_records if r.emotion_code != "02"]
    if not ravdess_records:
        raise RuntimeError(f"No valid RAVDESS .wav files found under: {ravdess_dir}")

    subesco_records = collect_subesco_records(subesco_dir)
    if not subesco_records:
        raise RuntimeError(f"No valid SUBESCO .wav files found under: {subesco_dir}")

    print(f"RAVDESS records  : {len(ravdess_records)}")
    print(f"SUBESCO records  : {len(subesco_records)}")

    # Preallocate a fixed-size array and fill in place, instead of
    # list+np.stack() (which peaks at 2x memory and can silently OOM on
    # memory-capped runtimes like free-tier Colab at this dataset size).
    AUGMENT_MULTIPLIER = 6  # matches augment_waveforms(): original + 5 variants
    subesco_multiplier = args.subesco_augment_cap or AUGMENT_MULTIPLIER
    max_samples = (len(ravdess_records) * AUGMENT_MULTIPLIER
                   + len(subesco_records) * subesco_multiplier)

    X_array = np.empty((max_samples, 1, N_MELS, TARGET_FRAMES), dtype=np.float32)
    y_list, actor_ids, source_list, emotion_codes, is_original_list = [], [], [], [], []
    ravdess_skipped = 0
    subesco_skipped = 0
    n = 0  # running fill index into X_array

    for record in tqdm(ravdess_records, desc="Extracting RAVDESS spectrograms"):
        spectrograms = extract_spectrograms(record.path)
        if not spectrograms:
            ravdess_skipped += 1
            continue
        for i, mel in enumerate(spectrograms):
            X_array[n] = mel
            n += 1
            y_list.append(LABEL_TO_ID[record.label])
            actor_ids.append(record.actor_id)
            source_list.append("RAVDESS")
            emotion_codes.append(record.emotion_code)
            is_original_list.append(i == 0)

    for record in tqdm(subesco_records, desc="Extracting SUBESCO spectrograms"):
        spectrograms = extract_spectrograms(record.path, max_variants=args.subesco_augment_cap)
        if not spectrograms:
            subesco_skipped += 1
            continue
        for i, mel in enumerate(spectrograms):
            X_array[n] = mel
            n += 1
            y_list.append(LABEL_TO_ID[record.label])
            actor_ids.append(record.actor_id)
            source_list.append("SUBESCO")
            emotion_codes.append(record.emotion_code)
            is_original_list.append(i == 0)

    if n == 0:
        raise RuntimeError("Spectrogram extraction produced no usable samples.")

    print(f"\nFilled {n:,} / {max_samples:,} preallocated slots "
          f"({(n / max_samples) * 100:.1f}%; the gap is skipped files plus any "
          f"augmentation step that raised and was caught).")

    X_array         = X_array[:n]  # drop unused preallocated tail
    y_array         = np.asarray(y_list, dtype=np.int64)
    actor_arr       = np.asarray(actor_ids)
    source_arr      = np.asarray(source_list)
    code_arr        = np.asarray(emotion_codes)
    is_original_arr = np.asarray(is_original_list, dtype=bool)

    # Off by default: np.unique(axis=0) over tens of thousands of rows adds
    # another large memory spike, and exact duplicates across two different
    # corpora are effectively impossible. Pass --dedup to re-enable.
    duplicate_count = 0
    if args.dedup:
        print("Deduplicating (--dedup passed; this needs extra memory)...")
        X_flat = X_array.reshape(len(X_array), -1)
        _, unique_indices = np.unique(X_flat, axis=0, return_index=True)
        duplicate_count = len(X_array) - len(unique_indices)
        if duplicate_count:
            unique_indices  = np.sort(unique_indices)
            X_array         = X_array[unique_indices]
            y_array         = y_array[unique_indices]
            actor_arr       = actor_arr[unique_indices]
            source_arr      = source_arr[unique_indices]
            code_arr        = code_arr[unique_indices]
            is_original_arr = is_original_arr[unique_indices]
            print(f"Removed {duplicate_count} duplicate spectrograms.")

    print(f"\nFinal dataset shape: {X_array.shape}")
    print("Saving (np.savez_compressed on a several-GB array can take a "
          "few minutes -- this is normal, not a hang)...")

    np.savez_compressed(
        output_path,
        X=X_array,
        y=y_array,
        actor=actor_arr,
        source=source_arr,
        emotion_code=code_arr,
        is_original=is_original_arr,
        label_names=np.asarray(LABEL_NAMES),
        sample_rate=np.asarray(SAMPLE_RATE),
        n_mels=np.asarray(N_MELS),
        target_frames=np.asarray(TARGET_FRAMES),
        n_fft=np.asarray(N_FFT),
        hop_length=np.asarray(HOP_LENGTH),
    )

    class_counts = Counter(y_array.tolist())
    class_counts_by_source = {
        src: Counter(y_array[source_arr == src].tolist())
        for src in sorted(set(source_arr.tolist()))
    }
    metadata = {
        "dataset": "RAVDESS+SUBESCO",
        "model_type": "cnn",
        "output": str(output_path),
        "spectrogram_shape": [1, N_MELS, TARGET_FRAMES],
        "removed_duplicates": int(duplicate_count),
        "audio_params": {
            "sample_rate": SAMPLE_RATE, "n_fft": N_FFT,
            "hop_length": HOP_LENGTH, "n_mels": N_MELS,
            "target_frames": TARGET_FRAMES,
        },
        "label_to_id": LABEL_TO_ID,
        "subesco_emotion_map": SUBESCO_EMOTION_MAP,
        "samples": int(len(y_array)),
        "original_samples": int(is_original_arr.sum()),
        "actors": int(len(set(actor_arr.tolist()))),
        "ravdess_skipped_files": int(ravdess_skipped),
        "subesco_skipped_files": int(subesco_skipped),
        "class_counts": {
            LABEL_NAMES[i]: int(class_counts.get(i, 0)) for i in range(len(LABEL_NAMES))
        },
        "class_counts_by_source": {
            src: {LABEL_NAMES[i]: int(counts.get(i, 0)) for i in range(len(LABEL_NAMES))}
            for src, counts in class_counts_by_source.items()
        },
        "sample_counts_by_source": {
            src: int((source_arr == src).sum()) for src in sorted(set(source_arr.tolist()))
        },
    }
    meta_path = output_path.with_suffix(".metadata.json")
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print("\nClass distribution (combined)")
    print(f"{'Emotion':<12} | {'Count':<7} | Ratio")
    print("-" * 36)
    total = len(y_array)
    for idx, name in enumerate(LABEL_NAMES):
        count = class_counts.get(idx, 0)
        print(f"{name:<12} | {count:<7} | {count / total * 100:>5.2f}%")

    print(f"\nSaved spectrograms : {output_path}")
    print(f"Saved metadata     : {meta_path}")
    print(
        f"Usable samples     : {total} "
        f"(RAVDESS skipped: {ravdess_skipped}, SUBESCO skipped: {subesco_skipped}, "
        f"duplicates removed: {duplicate_count})"
    )


if __name__ == "__main__":
    main()
