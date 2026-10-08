"""
End-to-end fine-tuning of Wav2Vec 2.0 for Speech Emotion Recognition
using Hugging Face Trainer and AutoModelForAudioClassification.
Preserves speaker-independent (actor-grouped) evaluation across RAVDESS + SUBESCO.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import evaluate
import librosa
import numpy as np
import torch
from datasets import Dataset
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import StratifiedGroupKFold
from transformers import (
    AutoConfig,
    AutoFeatureExtractor,
    AutoModelForAudioClassification,
    Trainer,
    TrainingArguments,
    set_seed,
)

# Wav2Vec2 expects 16kHz audio (backend SVM/CNN pipeline uses 22050Hz)
TARGET_SR = 16000
MODEL_ID = "facebook/wav2vec2-base"
# Order/index matches Backend/app/api/v1/mca/nudge_engine.py EMOTION_MAP
LABEL_NAMES = ["neutral", "happy", "sad", "angry", "fearful", "disgust", "surprised"]
N_CLASSES = len(LABEL_NAMES)
LABEL_TO_ID = {name: idx for idx, name in enumerate(LABEL_NAMES)}
ID_TO_LABEL = {idx: name for idx, name in enumerate(LABEL_NAMES)}

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
class AudioRecord:
    path: str
    label_id: int
    actor_id: str
    source: str


def parse_ravdess_filename(path: Path) -> AudioRecord | None:
    """RAVDESS filenames are 7 dash-separated codes; index 2 is emotion, index 6 is actor."""
    parts = path.stem.split("-")
    if len(parts) != 7:
        return None
    emotion_code = parts[2]
    label = RAVDESS_EMOTION_MAP.get(emotion_code)
    if label is None:
        return None
    return AudioRecord(
        path=str(path),
        label_id=LABEL_TO_ID[label],
        actor_id=f"ravdess_{parts[6]}",
        source="RAVDESS",
    )


def parse_subesco_filename(path: Path) -> AudioRecord | None:
    """SUBESCO filenames are underscore-separated; index 5 is emotion, 0+1 is actor id."""
    stem = path.stem.rstrip("]")
    parts = stem.split("_")
    if len(parts) != 7:
        return None
    label = SUBESCO_EMOTION_MAP.get(parts[5])
    if label is None:
        return None
    return AudioRecord(
        path=str(path),
        label_id=LABEL_TO_ID[label],
        actor_id=f"subesco_{parts[0]}{parts[1]}",
        source="SUBESCO",
    )


def collect_records(ravdess_dir: Path, subesco_dir: Path, skip_calm: bool = False) -> list[AudioRecord]:
    records = []
    for p in sorted(ravdess_dir.rglob("*.wav")):
        r = parse_ravdess_filename(p)
        if r and not (skip_calm and p.stem.split("-")[2] == "02"):
            records.append(r)

    for p in sorted(subesco_dir.rglob("*.wav")):
        r = parse_subesco_filename(p)
        if r:
            records.append(r)
    return records


def make_splits(records: list[AudioRecord], val_size: float = 0.15, test_size: float = 0.20, seed: int = 42):
    """Speaker-independent train/val/test split, grouped by actor and stratified per source dataset."""
    y = np.array([r.label_id for r in records])
    actors = np.array([r.actor_id for r in records])
    sources = np.array([r.source for r in records])

    def _split_pool(idx):
        y_sub, act_sub = y[idx], actors[idx]
        n_splits = max(2, round(1 / test_size))
        splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
        tr_val_rel, test_rel = next(splitter.split(idx, y_sub, act_sub))

        val_frac = val_size / (1 - test_size)
        n_splits_val = max(2, round(1 / val_frac))
        splitter_val = StratifiedGroupKFold(n_splits=n_splits_val, shuffle=True, random_state=seed)
        tr_rel, val_rel = next(splitter_val.split(idx[tr_val_rel], y_sub[tr_val_rel], act_sub[tr_val_rel]))

        return idx[tr_val_rel[tr_rel]], idx[tr_val_rel[val_rel]], idx[test_rel]

    train_idx, val_idx, test_idx = [], [], []
    for src in sorted(set(sources)):
        idx = np.where(sources == src)[0]
        tr, va, te = _split_pool(idx)
        train_idx.append(tr)
        val_idx.append(va)
        test_idx.append(te)

    train_idx = np.concatenate(train_idx)
    val_idx = np.concatenate(val_idx)
    test_idx = np.concatenate(test_idx)

    train_records = [records[i] for i in train_idx]
    val_records = [records[i] for i in val_idx]
    test_records = [records[i] for i in test_idx]

    return train_records, val_records, test_records


class DataCollatorCTCWithPadding:
    """Dynamic padding of input audio arrays for mini-batches."""
    def __init__(self, feature_extractor, max_duration_s: float = 6.0):
        self.feature_extractor = feature_extractor
        self.max_length = int(max_duration_s * TARGET_SR)

    def __call__(self, features: list[dict[str, list[float] | torch.Tensor]]) -> dict[str, torch.Tensor]:
        input_features = [{"input_values": f["input_values"][:self.max_length]} for f in features]
        label_features = [f["label"] for f in features]

        batch = self.feature_extractor.pad(
            input_features,
            padding=True,
            return_tensors="pt",
        )
        batch["labels"] = torch.tensor(label_features, dtype=torch.long)
        return batch


def compute_metrics_fn(eval_pred):
    accuracy_metric = evaluate.load("accuracy")
    f1_metric = evaluate.load("f1")

    logits, labels = eval_pred
    preds = np.argmax(logits, axis=1)

    acc = accuracy_metric.compute(predictions=preds, references=labels)["accuracy"]
    f1_macro = f1_metric.compute(predictions=preds, references=labels, average="macro")["f1"]
    return {"accuracy": acc, "macro_f1": f1_macro}


def load_audio_file(path_str: str) -> np.ndarray:
    """Load, resample to 16kHz mono, and trim leading/trailing silence."""
    y, _ = librosa.load(path_str, sr=TARGET_SR, mono=True)
    y, _ = librosa.effects.trim(y, top_db=40)
    if y.size == 0:
        y = np.zeros(TARGET_SR, dtype=np.float32)
    return y.astype(np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ravdess", required=True)
    parser.add_argument("--subesco", required=True)
    parser.add_argument("--output-dir", default="/kaggle/working/wav2vec2_ser_finetuned")
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=2)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--warmup-ratio", type=float, default=0.1)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    args = parser.parse_args()

    set_seed(42)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print("=== End-to-End Wav2Vec 2.0 Fine-Tuning ===")
    records = collect_records(Path(args.ravdess), Path(args.subesco))
    print(f"Total audio files found: {len(records)}")

    train_rec, val_rec, test_rec = make_splits(records)
    print(f"Split sizes -> Train: {len(train_rec)} | Val: {len(val_rec)} | Test: {len(test_rec)}")
    print("Train class balance:", dict(Counter([r.label_id for r in train_rec])))

    feature_extractor = AutoFeatureExtractor.from_pretrained(MODEL_ID)

    def prepare_dataset(recs: list[AudioRecord]) -> Dataset:
        data_dict = {"input_values": [], "label": []}
        for r in recs:
            audio_array = load_audio_file(r.path)
            inputs = feature_extractor(
                audio_array,
                sampling_rate=TARGET_SR,
                return_tensors=None,
            )
            data_dict["input_values"].append(inputs.input_values[0])
            data_dict["label"].append(r.label_id)
        return Dataset.from_dict(data_dict)

    print("\nPre-loading audio waveforms into Hugging Face Datasets...")
    train_dataset = prepare_dataset(train_rec)
    val_dataset = prepare_dataset(val_rec)
    test_dataset = prepare_dataset(test_rec)

    config = AutoConfig.from_pretrained(
        MODEL_ID,
        num_labels=N_CLASSES,
        label2id=LABEL_TO_ID,
        id2label=ID_TO_LABEL,
        finetuning_task="audio-classification",
        classifier_proj_size=256,
    )

    model = AutoModelForAudioClassification.from_pretrained(
        MODEL_ID,
        config=config,
    )

    # Freeze raw CNN waveform extractor to stabilize training
    model.freeze_feature_encoder()

    data_collator = DataCollatorCTCWithPadding(feature_extractor=feature_extractor, max_duration_s=5.0)

    training_args = TrainingArguments(
        output_dir=str(output_dir / "checkpoints"),
        eval_strategy="epoch",  
        save_strategy="epoch",
        learning_rate=args.lr,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size * 2,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        num_train_epochs=args.epochs,
        warmup_ratio=args.warmup_ratio,
        weight_decay=args.weight_decay,
        logging_strategy="steps",
        logging_steps=50,
        load_best_model_at_end=True,
        metric_for_best_model="macro_f1",
        greater_is_better=True,
        fp16=torch.cuda.is_available(),
        report_to="none",
        save_total_limit=2,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        processing_class=feature_extractor,
        data_collator=data_collator,
        compute_metrics=compute_metrics_fn,
    )

    print("\nStarting Fine-Tuning...")
    trainer.train()

    # Calculate Train Accuracy
    print("\n=== Evaluating on Train Speakers (This may take a few minutes) ===")
    train_predictions = trainer.predict(train_dataset)
    y_train_pred = np.argmax(train_predictions.predictions, axis=1)
    y_train_true = np.array(train_dataset["label"])
    train_acc = float(np.mean(y_train_pred == y_train_true))

    # Final Holdout Evaluation
    print("\n=== Evaluating on Unseen Test Speakers ===")
    test_predictions = trainer.predict(test_dataset)
    y_pred = np.argmax(test_predictions.predictions, axis=1)
    y_true = np.array(test_dataset["label"])

    test_acc = float(np.mean(y_pred == y_true))
    test_f1 = float(evaluate.load("f1").compute(predictions=y_pred, references=y_true, average="macro")["f1"])
    matrix = confusion_matrix(y_true, y_pred)
    
    overfit_gap = train_acc - test_acc

    print(f"\nFinal Train Accuracy: {train_acc * 100:.2f}%")
    print(f"Final Test Accuracy: {test_acc * 100:.2f}%")
    print(f"Overfit Gap: {overfit_gap * 100:.2f}%")
    print(f"Final Test Macro F1: {test_f1:.4f}\n")
    print(classification_report(y_true, y_pred, target_names=LABEL_NAMES, zero_division=0))

    # Save final model + feature extractor
    final_model_dir = output_dir / "final_model"
    model.save_pretrained(final_model_dir)
    feature_extractor.save_pretrained(final_model_dir)
    print(f"Saved fine-tuned model and feature extractor to: {final_model_dir}")

    # Save evaluation report JSON
    report = {
        "model_type": "wav2vec2_finetuned",
        "base_model": MODEL_ID,
        "train_accuracy": train_acc,
        "test_accuracy": test_acc,
        "overfit_gap": overfit_gap,
        "test_macro_f1": test_f1,
        "classification_report": classification_report(
            y_true, y_pred, target_names=LABEL_NAMES, zero_division=0, output_dict=True
        ),
        "confusion_matrix": matrix.tolist(),
        "training_args": {
            "epochs": args.epochs,
            "learning_rate": args.lr,
            "batch_size": args.batch_size,
            "gradient_accumulation_steps": args.gradient_accumulation_steps,
        },
    }
    report_path = final_model_dir / "finetune_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Saved report JSON to: {report_path}")


if __name__ == "__main__":
    main()