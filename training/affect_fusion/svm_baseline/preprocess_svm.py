import os
import glob
import numpy as np
import librosa
from tqdm import tqdm

def extract_features(file_path):
    """Extracts MFCC, Chroma, Mel, and Pitch and aggregates via mean()."""
    # Load audio natively (no hardcoded offset/duration!)
    y, sr = librosa.load(file_path, sr=22050) 
    
    # DYNAMIC SILENCE REMOVAL (This is the critical fix)
    y, _ = librosa.effects.trim(y, top_db=20)
    
    # MFCC
    mfcc = np.mean(librosa.feature.mfcc(y=y, sr=sr, n_mfcc=40).T, axis=0)
    
    # Chroma
    stft = np.abs(librosa.stft(y))
    chroma = np.mean(librosa.feature.chroma_stft(S=stft, sr=sr).T, axis=0)
    
    # Mel-spectrogram
    mel = np.mean(librosa.feature.melspectrogram(y=y, sr=sr).T, axis=0)
    
    # Pitch (F0)
    f0 = librosa.yin(y, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'))
    f0 = np.nan_to_num(f0) # Replace NaNs with 0
    pitch = np.mean(f0)
    
    # Concatenate into a fixed-length 1D numpy array
    return np.hstack((mfcc, chroma, mel, np.array([pitch])))

if __name__ == "__main__":
    print("=== EmpowerZ: Local Data Preprocessing ===")
    
    emotion_dict = {
        '01': 'neutral', '02': 'calm', '03': 'happy', '04': 'sad',
        '05': 'angry', '06': 'fearful', '07': 'disgust', '08': 'surprised'
    }

    # 1. Find all .wav files in the shared data directory (one level up)
    print("Searching for extracted RAVDESS .wav files in shared ../data/ folder...")
    file_list = glob.glob("../data/**/*.wav", recursive=True)
    
    if not file_list:
        print("ERROR: No .wav files found! Make sure your data is in 'training/affect_fusion/data/'.")
        exit(1)
        
    print(f"Found {len(file_list)} audio files. Extracting acoustic features... (This might take a few minutes)")
    
    X, y_labels = [], []
    processed_files = set()
    
    for file_path in tqdm(file_list, desc="Processing Audio"):
        filename = os.path.basename(file_path)
        
        if filename in processed_files:
            continue
            
        parts = filename.split('.')[0].split('-')
        if len(parts) == 7:
            emotion = emotion_dict.get(parts[2], "unknown")
            features = extract_features(file_path)
            
            X.append(features)
            y_labels.append(emotion)
            processed_files.add(filename)

    print(f"\nProcessed {len(processed_files)} unique audio files.")

    # Save as a highly compressed numpy array
    output_file = "ravdess_features.npz"
    np.savez(output_file, X=np.array(X), y=np.array(y_labels))
    
    print(f"\n Preprocessing Complete!")
    print(f"Successfully converted 1GB of audio into a tiny feature matrix.")
    print(f"Saved to: {output_file} (Feature Shape: {np.array(X).shape})")