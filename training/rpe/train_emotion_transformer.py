"""
train_emotion_transformer.py
Fine-tunes distilbert-base-uncased for RPE 5-class emotion detection.
Expected training time: 20-40 minutes on CPU, 5-10 min on GPU.
Run: python training/rpe/train_emotion_transformer.py
"""
from pathlib import Path

import pandas as pd
import torch
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from torch.utils.data import Dataset
from transformers import (
    DistilBertForSequenceClassification,
    DistilBertTokenizerFast,
    Trainer,
    TrainingArguments,
)

DATASET_PATH = Path(__file__).parent / "dataset" / "merged_rpe_dataset.csv"
MODEL_OUT = (
    Path(__file__).resolve().parent.parent.parent
    / "Backend" / "app" / "models" / "rpe" / "ml" / "transformer"
)
MODEL_OUT.mkdir(parents=True, exist_ok=True)

LABELS   = ["assertive", "anxious", "calm", "confused", "frustrated"]
LABEL2ID = {label: i for i, label in enumerate(LABELS)}
ID2LABEL = {i: label for i, label in enumerate(LABELS)}


class RpeEmotionDataset(Dataset):
    def __init__(self, encodings: dict, labels: list[int]) -> None:
        self.encodings = encodings
        self.labels    = labels

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, idx: int) -> dict:
        item = {k: torch.tensor(v[idx]) for k, v in self.encodings.items()}
        item["labels"] = torch.tensor(self.labels[idx])
        return item


def main() -> None:
    print("Loading dataset...")
    df = pd.read_csv(DATASET_PATH)
    df = df.dropna(subset=["user_input", "emotion_label"])
    df = df[df["emotion_label"].isin(LABELS)]

    texts  = df["user_input"].tolist()
    labels = df["emotion_label"].map(LABEL2ID).tolist()

    X_train, X_val, y_train, y_val = train_test_split(
        texts, labels, test_size=0.15, random_state=42, stratify=labels
    )
    print(f"Train: {len(X_train)}  Val: {len(X_val)}")

    print("Loading tokenizer...")
    tokenizer = DistilBertTokenizerFast.from_pretrained("distilbert-base-uncased")
    train_enc = tokenizer(X_train, truncation=True, padding=True, max_length=128)
    val_enc   = tokenizer(X_val,   truncation=True, padding=True, max_length=128)

    train_ds = RpeEmotionDataset(train_enc, y_train)
    val_ds   = RpeEmotionDataset(val_enc,   y_val)

    print("Loading model...")
    model = DistilBertForSequenceClassification.from_pretrained(
        "distilbert-base-uncased",
        num_labels = len(LABELS),
        id2label   = ID2LABEL,
        label2id   = LABEL2ID,
    )

    args = TrainingArguments(
        output_dir                  = str(MODEL_OUT / "checkpoints"),
        num_train_epochs            = 3,
        per_device_train_batch_size = 16,
        per_device_eval_batch_size  = 32,
        evaluation_strategy         = "epoch",
        save_strategy               = "epoch",
        load_best_model_at_end      = True,
        metric_for_best_model       = "eval_loss",
        logging_steps               = 50,
        warmup_steps                = 100,
        weight_decay                = 0.01,
        report_to                   = "none",
    )

    trainer = Trainer(
        model         = model,
        args          = args,
        train_dataset = train_ds,
        eval_dataset  = val_ds,
    )

    print("Training...")
    trainer.train()

    # Save final model + tokenizer
    model.save_pretrained(str(MODEL_OUT))
    tokenizer.save_pretrained(str(MODEL_OUT))
    print(f"\nModel saved to {MODEL_OUT}")

    # Evaluation report
    preds_raw = trainer.predict(val_ds)
    preds     = preds_raw.predictions.argmax(-1)
    print("\nClassification Report:")
    print(classification_report(y_val, preds, target_names=LABELS))


if __name__ == "__main__":
    main()
