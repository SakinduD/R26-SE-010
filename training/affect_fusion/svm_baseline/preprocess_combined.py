import os
import glob
import numpy as np
import librosa
import argparse
from tqdm import tqdm
from collections import Counter

# Unified 7-Class Schema
UNIFIED_LABELS = {
    'neutral': 0,
    'happy': 1,
    'sad': 2,
    'angry': 3,
    'fearful': 4,
    'disgust': 5,
    'surprised': 6
}

# RAVDESS Mapping (02: Calm -> Neutral)
RAVDESS_EMOTION_MAP = {
    '01': 'neutral', '02': 'neutral', '03': 'happy', '04': 'sad',
    '05': 'angry', '06': 'fearful', '07': 'disgust', '08': 'surprised'
}

# SUBESCO Mapping (Standard codes)
SUBESCO_EMOTION_MAP = {
    'NE': 'neutral', 'HA': 'happy', 'SA': 'sad', 'AN': 'angry',
    'FE': 'fearful', 'DI': 'disgust', 'SU': 'surprised'
}

def extract_features(file_path):
    """Extracts MFCC(40), Chroma(12), Mel-spectrogram(128), and Pitch(1) = 181 dimensions."""
    try:
        y, sr = librosa.load(file_path, sr=22050)
        y_trimmed, _ = librosa.effects.trim(y, top_db=40)
        if len(y_trimmed) >= int(0.5 * sr):
            y = y_trimmed
        
        # MFCC (40)
        mfcc = np.mean(librosa.feature.mfcc(y=y, sr=sr, n_mfcc=40).T, axis=0)
        # Chroma (12)
        stft = np.abs(librosa.stft(y))
        chroma = np.mean(librosa.feature.chroma_stft(S=stft, sr=sr).T, axis=0)
        # Mel-spectrogram (128)
        mel = np.mean(librosa.feature.melspectrogram(y=y, sr=sr).T, axis=0)
        # Pitch (1)
        f0 = librosa.yin(y, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'))
        f0 = np.nan_to_num(f0)
        voiced_f0 = f0[f0 > 0]
        pitch = np.mean(voiced_f0) if voiced_f0.size > 0 else 0.0
        
        return np.hstack((mfcc, chroma, mel, np.array([pitch])))
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return None

def parse_ravdess(ravdess_dir):
    X, y, sources = [], [], []
    files = glob.glob(os.path.join(ravdess_dir, "**/*.wav"), recursive=True)
    for f in tqdm(files, desc="Processing RAVDESS"):
        filename = os.path.basename(f)
        parts = filename.split('-')
        if len(parts) >= 3:
            emotion_code = parts[2]
            emotion_str = RAVDESS_EMOTION_MAP.get(emotion_code)
            if emotion_str:
                feat = extract_features(f)
                if feat is not None:
                    X.append(feat)
                    y.append(UNIFIED_LABELS[emotion_str])
                    sources.append('RAVDESS')
    return X, y, sources

def parse_subesco(subesco_dir):
    X, y, sources = [], [], []
    files = glob.glob(os.path.join(subesco_dir, "**/*.wav"), recursive=True)
    
    full_map = {
        **SUBESCO_EMOTION_MAP,
        'NEUTRAL': 'neutral', 'HAPPY': 'happy', 'SAD': 'sad', 'ANGRY': 'angry',
        'FEARFUL': 'fearful', 'DISGUST': 'disgust', 'SURPRISED': 'surprised'
    }

    for f in tqdm(files, desc="Processing SUBESCO"):
        filename = os.path.basename(f).upper()
        parts = filename.replace('.WAV', '').split('_')
        
        emotion_str = None
        for part in parts:
            if part in full_map:
                emotion_str = full_map[part]
                break
        
        if emotion_str:
            feat = extract_features(f)
            if feat is not None:
                X.append(feat)
                y.append(UNIFIED_LABELS[emotion_str])
                sources.append('SUBESCO')
                
    return X, y, sources

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Harmonize RAVDESS and SUBESCO datasets.")
    parser.add_argument("--ravdess", type=str, required=True, help="Path to RAVDESS directory")
    parser.add_argument("--subesco", type=str, required=True, help="Path to SUBESCO directory")
    args = parser.parse_args()

    print(f"=== EmpowerZ: Data Harmonization Pivot (7-Class Schema) ===")
    
    X_r, y_r, s_r = parse_ravdess(args.ravdess)
    X_s, y_s, s_s = parse_subesco(args.subesco)
    
    if not X_r and not X_s:
        print("ERROR: No data found in provided directories.")
        exit(1)
        
    X_combined = np.array(X_r + X_s)
    y_combined = np.array(y_r + y_s)
    sources_combined = np.array(s_r + s_s)

    print("\n[1/3] Cleaning Corrupted Data (NaNs/Infs)...")
    # Identify rows with any NaNs or Infs
    invalid_rows = np.isnan(X_combined).any(axis=1) | np.isinf(X_combined).any(axis=1)
    if invalid_rows.any():
        num_invalid = invalid_rows.sum()
        print(f"  -> Removed {num_invalid} corrupted samples.")
        X_combined = X_combined[~invalid_rows]
        y_combined = y_combined[~invalid_rows]
        sources_combined = sources_combined[~invalid_rows]
    else:
        print("  -> Data is clean. No NaNs/Infs found.")

    print("\n[2/3] Deduplication (Exact Feature Matches)...")
    # Find unique rows (removes accidental dataset duplicates)
    X_unique, unique_indices = np.unique(X_combined, axis=0, return_index=True)
    duplicates = len(X_combined) - len(unique_indices)
    
    X_combined = X_combined[unique_indices]
    y_combined = y_combined[unique_indices]
    sources_combined = sources_combined[unique_indices]
    print(f"  -> Removed {duplicates} duplicate samples.")

    print("\n[3/3] Class Distribution Analysis...")
    reverse_map = {v: k for k, v in UNIFIED_LABELS.items()}
    total = len(y_combined)
    class_counts = Counter(y_combined)
    
    print(f"{'Emotion':<12} | {'Count':<7} | {'Ratio'}")
    print("-" * 35)
    for cls_idx in sorted(class_counts.keys()):
        count = class_counts[cls_idx]
        ratio = (count / total) * 100
        print(f"{reverse_map[cls_idx]:<12} | {count:<7} | {ratio:.2f}%")

    output_path = "combined_features.npz"
    np.savez(output_path, X=X_combined, y=y_combined, source=sources_combined)
    
    print(f"\nHarmonization Complete!")
    print(f"Total Usable Samples: {total}")
    print(f"Saved to: {output_path}")
