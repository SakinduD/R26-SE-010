"""
Extracts 768-dimensional Wav2Vec 2.0 embeddings for RAVDESS + SUBESCO.
Replaces the Mel Spectrogram extraction pipeline.
"""

import argparse
from dataclasses import dataclass
from pathlib import Path
import librosa
import numpy as np
import torch
from tqdm import tqdm
from transformers import Wav2Vec2Processor, Wav2Vec2Model

TARGET_SR = 16000
MODEL_ID = "facebook/wav2vec2-base"

LABEL_NAMES = ["neutral", "happy", "sad", "angry", "fearful", "disgust", "surprised"]
LABEL_TO_ID = {name: idx for idx, name in enumerate(LABEL_NAMES)}

RAVDESS_EMOTION_MAP = {
    "01": "neutral", "02": "neutral", "03": "happy", "04": "sad",
    "05": "angry", "06": "fearful", "07": "disgust", "08": "surprised",
}

SUBESCO_EMOTION_MAP = {
    "ANGRY": "angry", "DISGUST": "disgust", "FEAR": "fearful",
    "HAPPY": "happy", "NEUTRAL": "neutral", "SAD": "sad", "SURPRISE": "surprised",
}

@dataclass(frozen=True)
class Record:
    path: Path
    emotion_code: str
    label: str
    actor_id: str
    source: str

def parse_ravdess_filename(path: Path) -> Record | None:
    parts = path.stem.split("-")
    if len(parts) != 7: return None
    emotion_code = parts[2]
    label = RAVDESS_EMOTION_MAP.get(emotion_code)
    if label is None: return None
    return Record(path, emotion_code, label, f"ravdess_{parts[6]}", "RAVDESS")

def parse_subesco_filename(path: Path) -> Record | None:
    stem = path.stem.rstrip("]")
    parts = stem.split("_")
    if len(parts) != 7: return None
    emotion_code = parts[5]
    label = SUBESCO_EMOTION_MAP.get(emotion_code)
    if label is None: return None
    return Record(path, emotion_code, label, f"subesco_{parts[0]}{parts[1]}", "SUBESCO")

def collect_records(ravdess_dir: Path, subesco_dir: Path, skip_calm: bool) -> list[Record]:
    records = []
    for path in sorted(ravdess_dir.rglob("*.wav")):
        r = parse_ravdess_filename(path)
        if r and not (skip_calm and r.emotion_code == "02"):
            records.append(r)
            
    for path in sorted(subesco_dir.rglob("*.wav")):
        r = parse_subesco_filename(path)
        if r:
            records.append(r)
    return records

def extract_embeddings(records: list[Record], processor, model, device):
    embeddings, y_list, actor_ids, source_list = [], [], [], []
    
    for record in tqdm(records, desc="Extracting Wav2Vec 2.0 Embeddings"):
        try:
            y, _ = librosa.load(record.path, sr=TARGET_SR, mono=True)
            y, _ = librosa.effects.trim(y, top_db=40)
            if len(y) == 0: continue
                
            inputs = processor(y, sampling_rate=TARGET_SR, return_tensors="pt", padding=True)
            input_values = inputs.input_values.to(device)
            
            with torch.no_grad():
                outputs = model(input_values)
                emb = outputs.last_hidden_state.mean(dim=1).squeeze().cpu().numpy()
                
            embeddings.append(emb)
            y_list.append(LABEL_TO_ID[record.label])
            actor_ids.append(record.actor_id)
            source_list.append(record.source)
        except Exception as e:
            print(f"Skipped {record.path}: {e}")
            
    return (np.array(embeddings, dtype=np.float32), 
            np.array(y_list, dtype=np.int64), 
            np.array(actor_ids), 
            np.array(source_list))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ravdess", required=True)
    parser.add_argument("--subesco", required=True)
    parser.add_argument("--output", default="wav2vec_features_combined.npz")
    parser.add_argument("--skip-calm", action="store_true")
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading Wav2Vec 2.0 on {device}...")
    
    processor = Wav2Vec2Processor.from_pretrained(MODEL_ID)
    model = Wav2Vec2Model.from_pretrained(MODEL_ID).to(device)
    model.eval()

    ravdess_path = Path(args.ravdess)
    subesco_path = Path(args.subesco)

    records = collect_records(ravdess_path, subesco_path, args.skip_calm)
    print(f"Found {len(records)} total audio recordings.")

    X, y, actor, source = extract_embeddings(records, processor, model, device)
    print(f"Extracted feature shape: {X.shape}")
    
    np.savez_compressed(args.output, X=X, y=y, actor=actor, source=source)
    print(f"Saved embeddings to {args.output}")

if __name__ == "__main__":
    main()