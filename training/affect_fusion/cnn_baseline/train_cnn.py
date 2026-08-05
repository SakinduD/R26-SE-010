"""
Train the MCA CNN Speech Emotion Recognition model.

Architecture: 2-D Convolutional Neural Network on log-mel spectrograms.
Input shape : (batch, 1, 128, 128)
Output      : 7-class emotion logits

The saved artifact is a CNNEmotionWrapper (sklearn-compatible) stored with
joblib — drop-in replacement for the SVM pipeline in
Backend/app/models/affect_fusion/svm_model.pkl.

Backend label contract (must match nudge_engine.py SerAnalyzer.EMOTION_MAP):
    0 neutral  1 happy  2 sad  3 angry  4 fearful  5 disgust  6 surprised

Usage:
    python train_cnn.py --data mel_features.npz --output cnn_model.pkl
    python train_cnn.py --data mel_features.npz --output cnn_model.pkl --epochs 100 --batch-size 64
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold
from torch.optim.lr_scheduler import CosineAnnealingWarmRestarts
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler


LABEL_NAMES = ["neutral", "happy", "sad", "angry", "fearful", "disgust", "surprised"]
N_CLASSES   = len(LABEL_NAMES)
RANDOM_SEED = 42
DATA_PATH   = "mel_features.npz"
OUTPUT_PATH = "cnn_model.pkl"


# Dataset
class MelDataset(Dataset):
    def __init__(self, X: np.ndarray, y: np.ndarray, augment: bool = False):
        self.X = torch.from_numpy(X)        # (N, 1, 128, 128) float32
        self.y = torch.from_numpy(y.astype(np.int64))
        self.augment = augment

    def __len__(self) -> int:
        return len(self.y)

    def __getitem__(self, idx: int):
        x = self.X[idx].clone()
        if self.augment:
            x = self._spec_augment(x)
        return x, self.y[idx]

    @staticmethod
    def _spec_augment(x: torch.Tensor) -> torch.Tensor:
        """SpecAugment: random time and frequency masking (Park et al., 2019)."""
        _, n_mels, n_frames = x.shape

        # Frequency masking: 2 independent masks up to 27 mel bands each
        for _ in range(2):
            f_mask = np.random.randint(0, 27)
            f_start = np.random.randint(0, max(1, n_mels - f_mask))
            x[:, f_start: f_start + f_mask, :] = 0.0

        # Time masking: 2 independent masks up to 27 frames each
        for _ in range(2):
            t_mask = np.random.randint(0, 27)
            t_start = np.random.randint(0, max(1, n_frames - t_mask))
            x[:, :, t_start: t_start + t_mask] = 0.0

        return x

# Model
class ConvBlock(nn.Module):
    def __init__(self, in_ch: int, out_ch: int, dropout: float = 0.25):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(in_ch,  out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Dropout2d(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class EmotionCNN(nn.Module):
    """
    2-D CNN for speech emotion recognition from log-mel spectrograms.

    Input : (B, 1, 128, 128)
    Blocks :
        ConvBlock(1  → 32)   MaxPool  →  (B, 32,  64, 64)
        ConvBlock(32 → 64)   MaxPool  →  (B, 64,  32, 32)
        ConvBlock(64 → 128)  MaxPool  →  (B, 128, 16, 16)
        ConvBlock(128→ 256)  MaxPool  →  (B, 256,  8,  8)
    GAP → (B, 256)
    FC(256→128) → ReLU → Dropout → FC(128→7)
    """

    def __init__(self, n_classes: int = N_CLASSES, dropout: float = 0.3):
        super().__init__()
        self.block1 = ConvBlock(1,   32,  dropout=dropout / 2)
        self.block2 = ConvBlock(32,  64,  dropout=dropout / 2)
        self.block3 = ConvBlock(64,  128, dropout=dropout / 2)
        self.block4 = ConvBlock(128, 256, dropout=dropout / 2)
        self.gap     = nn.AdaptiveAvgPool2d(1)
        self.head    = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(256, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(128, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.block1(x)
        x = self.block2(x)
        x = self.block3(x)
        x = self.block4(x)
        x = self.gap(x).flatten(1)
        return self.head(x)

# Sklearn-compatible wrapper (drop-in for the SVM pkl)
class CNNEmotionWrapper:
    """
    Wraps EmotionCNN to expose sklearn-style predict / predict_proba.

    Accepts input shapes:
        (N, 16384)       flat mel spectrogram (128 * 128)
        (N, 1, 128, 128) standard spectrogram tensor

    The model_type attribute lets NudgeEngine select the correct
    feature to feed at inference time (mel_spectrogram vs feature_vector).
    """

    model_type = "cnn"

    def __init__(self, model: EmotionCNN, device: str = "cpu"):
        self.model  = model
        self.device = device
        self.model.to(device)
        self.model.eval()

    def _to_tensor(self, X: np.ndarray) -> torch.Tensor:
        if X.ndim == 2:                        # (N, 16384)
            X = X.reshape(-1, 1, 128, 128)
        elif X.ndim == 3:                      # (1, 128, 128) single sample
            X = X[np.newaxis]
        return torch.from_numpy(X.astype(np.float32)).to(self.device)

    @torch.no_grad()
    def predict_proba(self, X: np.ndarray, batch_size: int = 64) -> np.ndarray:
        results = []
        for i in range(0, len(X), batch_size):
            batch = self._to_tensor(X[i: i + batch_size])
            logits = self.model(batch)
            results.append(F.softmax(logits, dim=1).cpu().numpy())
        return np.concatenate(results, axis=0)

    def predict(self, X: np.ndarray, batch_size: int = 64) -> np.ndarray:
        return self.predict_proba(X, batch_size=batch_size).argmax(axis=1)

# Data loading & splitting
def load_dataset(data_path: Path):
    if not data_path.exists():
        raise FileNotFoundError(f"{data_path} not found. Run preprocess_cnn.py first.")

    data  = np.load(data_path, allow_pickle=True)
    X     = data["X"].astype(np.float32)          # (N, 1, 128, 128)
    y     = data["y"].astype(np.int64)
    actor = data["actor"] if "actor" in data.files else None

    if X.ndim != 4 or X.shape[1:] != (1, 128, 128):
        raise ValueError(f"Expected (N, 1, 128, 128) data, got {X.shape}")
    if not np.all(np.isfinite(X)):
        raise ValueError("Dataset contains NaN or Inf values.")
    if len(np.unique(y)) != N_CLASSES:
        raise ValueError(f"Expected {N_CLASSES} classes, got {len(np.unique(y))}.")

    return X, y, actor


def make_split(X, y, actor, test_size: float):
    """Speaker-independent split when actor labels are available."""
    if actor is not None:
        n_splits = max(2, round(1 / test_size))
        splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True,
                                        random_state=RANDOM_SEED)
        train_idx, test_idx = next(splitter.split(X, y, actor))
        return (X[train_idx], X[test_idx],
                y[train_idx], y[test_idx],
                actor[train_idx])

    from sklearn.model_selection import train_test_split
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=test_size, stratify=y, random_state=RANDOM_SEED
    )
    return X_tr, X_te, y_tr, y_te, None


def make_sampler(y_train: np.ndarray) -> WeightedRandomSampler:
    """Over-sample minority classes to compensate for RAVDESS imbalance."""
    counts  = Counter(y_train.tolist())
    weights = np.array([1.0 / counts[label] for label in y_train], dtype=np.float32)
    return WeightedRandomSampler(weights, num_samples=len(weights), replacement=True)



# MixUp
def mixup_data(x: torch.Tensor, y: torch.Tensor, alpha: float = 0.4):
    """Return mixed inputs, pairs of targets, and mixing coefficient."""
    lam = float(np.random.beta(alpha, alpha)) if alpha > 0 else 1.0
    idx = torch.randperm(x.size(0), device=x.device)
    return lam * x + (1 - lam) * x[idx], y, y[idx], lam


def mixup_loss(criterion, logits, y_a, y_b, lam):
    return lam * criterion(logits, y_a) + (1 - lam) * criterion(logits, y_b)


# Training
def train_epoch(model, loader, criterion, optimiser, device, scaler, mixup_alpha=0.4):
    model.train()
    total_loss, n = 0.0, 0
    for X_batch, y_batch in loader:
        X_batch, y_batch = X_batch.to(device), y_batch.to(device)
        X_mix, y_a, y_b, lam = mixup_data(X_batch, y_batch, alpha=mixup_alpha)
        optimiser.zero_grad()
        with torch.autocast(device_type=device if device != "cpu" else "cpu",
                            enabled=(device == "cuda")):
            logits = model(X_mix)
            loss   = mixup_loss(criterion, logits, y_a, y_b, lam)
        if device == "cuda":
            scaler.scale(loss).backward()
            scaler.unscale_(optimiser)
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            scaler.step(optimiser)
            scaler.update()
        else:
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimiser.step()
        total_loss += loss.item() * len(y_batch)
        n          += len(y_batch)
    return total_loss / n, 0.0  # train acc not meaningful with mixed labels


@torch.no_grad()
def eval_epoch(model, loader, criterion, device):
    model.eval()
    total_loss, correct, n = 0.0, 0, 0
    for X_batch, y_batch in loader:
        X_batch, y_batch = X_batch.to(device), y_batch.to(device)
        logits     = model(X_batch)
        loss       = criterion(logits, y_batch)
        total_loss += loss.item() * len(y_batch)
        correct    += (logits.argmax(1) == y_batch).sum().item()
        n          += len(y_batch)
    return total_loss / n, correct / n



# Main
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train the MCA CNN Speech Emotion Recognition model."
    )
    parser.add_argument("--data",       default=DATA_PATH,  help="mel_features.npz path")
    parser.add_argument("--output",     default=OUTPUT_PATH, help="Output .pkl path")
    parser.add_argument("--epochs",     type=int,   default=80,   help="Max training epochs")
    parser.add_argument("--batch-size", type=int,   default=32,   help="Mini-batch size")
    parser.add_argument("--lr",         type=float, default=1e-3, help="Initial learning rate")
    parser.add_argument("--dropout",    type=float, default=0.3,  help="Dropout probability")
    parser.add_argument("--test-size",  type=float, default=0.2,  help="Holdout fraction")
    parser.add_argument("--patience",      type=int,   default=20,    help="Early stopping patience")
    parser.add_argument("--weight-decay",  type=float, default=5e-4,  help="AdamW weight decay (L2 regularisation)")
    parser.add_argument("--mixup-alpha",   type=float, default=0.4,   help="MixUp alpha (0 = disabled)")
    parser.add_argument("--no-group-split", action="store_true",
                        help="Use sample-level split instead of speaker-independent split")
    args = parser.parse_args()

    torch.manual_seed(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"=== MCA SER Training: 2-D CNN ===")
    print(f"Device  : {device}")
    print(f"Epochs  : {args.epochs}  |  Batch: {args.batch_size}  |  LR: {args.lr}")

    # Data
    X, y, actor = load_dataset(Path(args.data))
    if args.no_group_split:
        actor = None
    print(f"Loaded  : {X.shape[0]} samples, shape {X.shape[1:]}")
    print(f"Backend label contract: {dict(enumerate(LABEL_NAMES))}")

    X_train, X_test, y_train, y_test, train_actor = make_split(
        X, y, actor, args.test_size
    )
    print(f"Train   : {len(y_train)}  |  Test : {len(y_test)}")
    print("Train class counts:", Counter(y_train.tolist()))

    train_ds  = MelDataset(X_train, y_train, augment=True)
    test_ds   = MelDataset(X_test,  y_test,  augment=False)
    sampler   = make_sampler(y_train)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size,
                              sampler=sampler, num_workers=0, pin_memory=(device == "cuda"))
    test_loader  = DataLoader(test_ds,  batch_size=args.batch_size * 2,
                              shuffle=False, num_workers=0)

    # Model
    model     = EmotionCNN(n_classes=N_CLASSES, dropout=args.dropout).to(device)
    n_params  = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Params  : {n_params:,}")

    # Label smoothing loss + class weights for hard-to-learn classes
    class_counts = Counter(y_train.tolist())
    class_weights = torch.tensor(
        [len(y_train) / (N_CLASSES * class_counts.get(i, 1)) for i in range(N_CLASSES)],
        dtype=torch.float32, device=device,
    )
    criterion  = nn.CrossEntropyLoss(weight=class_weights, label_smoothing=0.1)
    optimiser  = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler  = CosineAnnealingWarmRestarts(optimiser, T_0=20, T_mult=2, eta_min=1e-6)
    scaler     = torch.amp.GradScaler("cuda", enabled=(device == "cuda"))

    # Training loop
    best_val_acc  = 0.0
    best_state    = None
    patience_left = args.patience
    history       = []

    print(f"\n{'Epoch':>5} | {'TrainLoss':>9} | {'ValLoss':>8} | {'ValAcc':>7} | LR")
    print("-" * 55)

    for epoch in range(1, args.epochs + 1):
        t0 = time.time()
        tr_loss, tr_acc = train_epoch(model, train_loader, criterion, optimiser, device, scaler,
                                      mixup_alpha=args.mixup_alpha)
        va_loss, va_acc = eval_epoch(model, test_loader, criterion, device)
        scheduler.step(epoch)
        lr_now = optimiser.param_groups[0]["lr"]
        elapsed = time.time() - t0

        print(f"{epoch:>5} | {tr_loss:>9.4f} | "
              f"{va_loss:>8.4f} | {va_acc * 100:>6.2f}% | {lr_now:.6f}  [{elapsed:.1f}s]")

        history.append({
            "epoch": epoch, "train_loss": tr_loss, "train_acc": tr_acc,
            "val_loss": va_loss, "val_acc": va_acc, "lr": lr_now,
        })

        if va_acc > best_val_acc:
            best_val_acc  = va_acc
            best_state    = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            patience_left = args.patience
        else:
            patience_left -= 1
            if patience_left == 0:
                print(f"\nEarly stopping at epoch {epoch} (patience={args.patience}).")
                break

    # Load best weights and evaluate
    if best_state is not None:
        model.load_state_dict(best_state)

    model.eval()
    wrapper  = CNNEmotionWrapper(model, device=device)

    X_test_flat   = X_test.reshape(len(X_test), -1)   # (N, 16384)
    X_train_flat  = X_train.reshape(len(X_train), -1)

    y_pred        = wrapper.predict(X_test_flat)
    y_train_pred  = wrapper.predict(X_train_flat)

    test_acc      = accuracy_score(y_test, y_pred)
    test_f1       = f1_score(y_test, y_pred, average="macro")
    train_acc     = accuracy_score(y_train, y_train_pred)
    overfit_gap   = train_acc - test_acc

    print("\n=== Holdout Evaluation ===")
    print(classification_report(
        y_test, y_pred,
        labels=list(range(N_CLASSES)),
        target_names=LABEL_NAMES,
        zero_division=0,
    ))
    matrix = confusion_matrix(y_test, y_pred, labels=list(range(N_CLASSES)))
    print("Confusion matrix (rows=true, cols=pred):")
    print(matrix)
    print(f"\nTest accuracy  : {test_acc * 100:.2f}%")
    print(f"Test macro F1  : {test_f1:.4f}")
    print(f"Train accuracy : {train_acc * 100:.2f}%")
    print(f"Overfit gap    : {overfit_gap * 100:.2f}%")
    print(f"Best val acc   : {best_val_acc * 100:.2f}%")

    # Save
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(wrapper, output_path)
    print(f"\nSaved model : {output_path}")
    print("Backend target: Backend/app/models/affect_fusion/svm_model.pkl")

    report = {
        "model_type": "cnn",
        "architecture": "EmotionCNN_2D",
        "input_shape": [1, 128, 128],
        "data_path": args.data,
        "model_path": str(output_path),
        "label_names": LABEL_NAMES,
        "label_contract": dict(enumerate(LABEL_NAMES)),
        "n_params": n_params,
        "epochs_trained": len(history),
        "best_val_acc": float(best_val_acc),
        "test_accuracy": float(test_acc),
        "test_macro_f1": float(test_f1),
        "train_accuracy": float(train_acc),
        "overfit_gap": float(overfit_gap),
        "classification_report": classification_report(
            y_test, y_pred, labels=list(range(N_CLASSES)),
            target_names=LABEL_NAMES, zero_division=0, output_dict=True,
        ),
        "confusion_matrix": matrix.tolist(),
        "training_history": history,
        "hyperparams": vars(args),
        "split": "actor_grouped" if actor is not None else "sample_stratified",
        "device": device,
    }
    report_path = output_path.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Saved report: {report_path}")


if __name__ == "__main__":
    main()
