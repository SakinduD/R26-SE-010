"""
Train the MCA CNN Speech Emotion Recognition model on the combined
RAVDESS + SUBESCO dataset.

Architecture: 2-D Convolutional Neural Network on log-mel spectrograms.
Input shape : (batch, 1, 128, 128)
Output      : 7-class emotion logits

The saved artifact is a CNNEmotionWrapper (sklearn-compatible) stored with
joblib — drop-in replacement for the SVM pipeline in
Backend/app/models/affect_fusion/svm_model.pkl.

Backend label contract (must match nudge_engine.py SerAnalyzer.EMOTION_MAP):
    0 neutral  1 happy  2 sad  3 angry  4 fearful  5 disgust  6 surprised

Usage:
    python train_cnn.py --data mel_features_combined.npz --output cnn_model_combined.pkl
    python train_cnn.py --data mel_features_combined.npz --output cnn_model_combined.pkl --epochs 100 --batch-size 64

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
from torch.optim.lr_scheduler import CosineAnnealingLR
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler


LABEL_NAMES = ["neutral", "happy", "sad", "angry", "fearful", "disgust", "surprised"]
N_CLASSES   = len(LABEL_NAMES)
RANDOM_SEED = 42
DATA_PATH   = "mel_features_combined.npz"
OUTPUT_PATH = "cnn_model_combined.pkl"


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
        """SpecAugment: random time/frequency masking (Park et al., 2019)
        plus a circular time-shift, regenerated fresh on every sample draw."""
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

        # Circular time-shift: up to ~15% of the clip, wrapped around rather
        # than zero-padded so no information is discarded, just repositioned.
        max_shift = max(1, n_frames // 7)
        shift = np.random.randint(-max_shift, max_shift + 1)
        if shift != 0:
            x = torch.roll(x, shifts=shift, dims=2)

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
    Blocks : ConvBlock(1→32→64→128→256), each MaxPool-halved
    GAP → (B, 256) → FC(256→128) → ReLU → Dropout → FC(128→7)

    1.2M params. Shrink experiments (300K, 679K) on the RAVDESS-only
    baseline both scored worse on the test holdout despite a smaller
    train/val gap -- shrinking traded real signal for a smaller gap number.
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
    """Wraps EmotionCNN to expose sklearn-style predict / predict_proba.

    Accepts (N, 16384) flat or (N, 1, 128, 128) spectrogram input.
    model_type lets NudgeEngine pick the right feature at inference time.
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

    data        = np.load(data_path, allow_pickle=True)
    X           = data["X"].astype(np.float32)          # (N, 1, 128, 128)
    y           = data["y"].astype(np.int64)
    actor       = data["actor"] if "actor" in data.files else None
    is_original = data["is_original"] if "is_original" in data.files else None
    source      = data["source"] if "source" in data.files else None  # RAVDESS/SUBESCO tag

    if X.ndim != 4 or X.shape[1:] != (1, 128, 128):
        raise ValueError(f"Expected (N, 1, 128, 128) data, got {X.shape}")
    if not np.all(np.isfinite(X)):
        raise ValueError("Dataset contains NaN or Inf values.")
    if len(np.unique(y)) != N_CLASSES:
        raise ValueError(f"Expected {N_CLASSES} classes, got {len(np.unique(y))}.")

    return X, y, actor, is_original, source


def _split_indices_single_group(idx, y, actor, val_size: float, test_size: float):
    """Actor-grouped (or sample-stratified if actor is None) 3-way split over
    one pool of indices. Returns absolute indices into the full-size arrays;
    idx is the pool this call may choose from (e.g. one source's rows)."""
    y_sub = y[idx]
    if actor is not None:
        actor_sub = actor[idx]
        n_splits = max(2, round(1 / test_size))
        splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True,
                                        random_state=RANDOM_SEED)
        trainval_rel, test_rel = next(splitter.split(idx, y_sub, actor_sub))

        val_frac_of_remaining = val_size / (1 - test_size)
        n_splits_val = max(2, round(1 / val_frac_of_remaining))
        splitter_val = StratifiedGroupKFold(n_splits=n_splits_val, shuffle=True,
                                            random_state=RANDOM_SEED)
        tr_rel2, val_rel2 = next(splitter_val.split(
            idx[trainval_rel], y_sub[trainval_rel], actor_sub[trainval_rel]
        ))
        train_rel = trainval_rel[tr_rel2]
        val_rel   = trainval_rel[val_rel2]
    else:
        from sklearn.model_selection import train_test_split
        pool = np.arange(len(idx))
        trainval_rel, test_rel = train_test_split(
            pool, test_size=test_size, stratify=y_sub[pool], random_state=RANDOM_SEED
        )
        val_frac_of_remaining = val_size / (1 - test_size)
        train_rel, val_rel = train_test_split(
            trainval_rel, test_size=val_frac_of_remaining,
            stratify=y_sub[trainval_rel], random_state=RANDOM_SEED,
        )

    return idx[train_rel], idx[val_rel], idx[test_rel]


def make_splits(X, y, actor, is_original, val_size: float, test_size: float, source=None):
    """Speaker-independent 3-way split: train / val / test, actor-grouped
    and label-stratified. val/test are restricted to clean, unaugmented
    recordings when is_original is available. When source (RAVDESS vs
    SUBESCO) is available, each source is split independently and
    concatenated to keep source proportions consistent across splits."""
    if source is None:
        train_idx, val_idx, test_idx = _split_indices_single_group(
            np.arange(len(y)), y, actor, val_size, test_size
        )
    else:
        train_parts, val_parts, test_parts = [], [], []
        for src in sorted(set(source.tolist())):
            idx = np.where(source == src)[0]
            tr, va, te = _split_indices_single_group(idx, y, actor, val_size, test_size)
            train_parts.append(tr)
            val_parts.append(va)
            test_parts.append(te)
        train_idx = np.concatenate(train_parts)
        val_idx   = np.concatenate(val_parts)
        test_idx  = np.concatenate(test_parts)

    if is_original is not None:
        val_idx  = val_idx[is_original[val_idx]]
        test_idx = test_idx[is_original[test_idx]]

    return (X[train_idx], X[val_idx], X[test_idx],
            y[train_idx], y[val_idx], y[test_idx],
            actor[train_idx] if actor is not None else None,
            train_idx, val_idx, test_idx)


def make_sampler(y_train: np.ndarray) -> WeightedRandomSampler:
    """Over-sample minority classes to compensate for class imbalance."""
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
    """Returns (loss, accuracy, macro_f1). macro_f1 drives checkpoint
    selection (see main()) since it weights all 7 classes equally, unlike
    accuracy which rewards the majority class."""
    model.eval()
    total_loss, n = 0.0, 0
    all_preds, all_targets = [], []
    for X_batch, y_batch in loader:
        X_batch, y_batch = X_batch.to(device), y_batch.to(device)
        logits     = model(X_batch)
        loss       = criterion(logits, y_batch)
        total_loss += loss.item() * len(y_batch)
        n          += len(y_batch)
        all_preds.append(logits.argmax(1).cpu())
        all_targets.append(y_batch.cpu())
    all_preds   = torch.cat(all_preds).numpy()
    all_targets = torch.cat(all_targets).numpy()
    accuracy = float((all_preds == all_targets).mean())
    macro_f1 = f1_score(all_targets, all_preds, average="macro", zero_division=0)
    return total_loss / n, accuracy, macro_f1



# Main
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train the MCA CNN Speech Emotion Recognition model on RAVDESS+SUBESCO."
    )
    parser.add_argument("--data",       default=DATA_PATH,  help="mel_features_combined.npz path")
    parser.add_argument("--output",     default=OUTPUT_PATH, help="Output .pkl path")
    parser.add_argument("--epochs",     type=int,   default=80,   help="Max training epochs")
    parser.add_argument("--batch-size", type=int,   default=32,   help="Mini-batch size")
    parser.add_argument("--lr",         type=float, default=1e-3, help="Initial learning rate")
    parser.add_argument("--dropout",    type=float, default=0.4,  help="Dropout probability")
    parser.add_argument("--test-size",  type=float, default=0.2,  help="Final holdout fraction (touched once, at the end)")
    parser.add_argument("--val-size",   type=float, default=0.15, help="Validation fraction, used for early stopping / checkpoint selection")
    parser.add_argument("--patience",      type=int,   default=25,    help="Early stopping patience")
    parser.add_argument("--weight-decay",  type=float, default=5e-4,  help="AdamW weight decay (L2 regularisation)")
    parser.add_argument("--mixup-alpha",   type=float, default=0.4,   help="MixUp alpha (0 = disabled)")
    parser.add_argument("--no-group-split", action="store_true",
                        help="Use sample-level split instead of speaker-independent split")
    args = parser.parse_args()

    torch.manual_seed(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"=== MCA SER Training: 2-D CNN (RAVDESS+SUBESCO) ===")
    print(f"Device  : {device}")
    print(f"Epochs  : {args.epochs}  |  Batch: {args.batch_size}  |  LR: {args.lr}")

    # Data
    X, y, actor, is_original, source = load_dataset(Path(args.data))
    if args.no_group_split:
        actor = None
    if is_original is None:
        print("WARNING: no 'is_original' flag in this .npz -- val/test will "
              "include augmented near-duplicates, inflating reported metrics.")
    print(f"Loaded  : {X.shape[0]} samples, shape {X.shape[1:]}")
    print(f"Backend label contract: {dict(enumerate(LABEL_NAMES))}")
    if source is not None:
        print("Source mix (whole dataset):", dict(Counter(source.tolist())))

    X_train, X_val, X_test, y_train, y_val, y_test, train_actor, train_idx, val_idx, test_idx = make_splits(
        X, y, actor, is_original, args.val_size, args.test_size, source=source
    )
    print(f"Train   : {len(y_train)}  |  Val : {len(y_val)}  |  Test : {len(y_test)}")
    print("Train class counts:", Counter(y_train.tolist()))
    if source is not None:
        # Sanity check: confirms RAVDESS/SUBESCO stayed proportionally
        # represented in every split (a skew here can masquerade as a
        # modeling problem).
        for split_name, idx in [("Train", train_idx), ("Val", val_idx), ("Test", test_idx)]:
            counts = Counter(source[idx].tolist())
            total = sum(counts.values())
            pct = {k: f"{v} ({v / total * 100:.1f}%)" for k, v in counts.items()}
            print(f"  {split_name} source mix: {pct}")

    train_ds  = MelDataset(X_train, y_train, augment=True)
    val_ds    = MelDataset(X_val,   y_val,   augment=False)
    sampler   = make_sampler(y_train)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size,
                              sampler=sampler, num_workers=0, pin_memory=(device == "cuda"))
    val_loader   = DataLoader(val_ds,   batch_size=args.batch_size * 2,
                              shuffle=False, num_workers=0)
    # X_test/y_test stay untouched until the final wrapper.predict() below.

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
    # Single smooth decay (not warm restarts) so early stopping can't fire
    # right before a scheduled restart.
    scheduler  = CosineAnnealingLR(optimiser, T_max=args.epochs, eta_min=1e-6)
    scaler     = torch.amp.GradScaler("cuda", enabled=(device == "cuda"))

    # Checkpoint selection uses macro F1, not accuracy (see eval_epoch);
    # val_acc is still logged for reference.
    best_val_f1   = 0.0
    best_val_acc  = 0.0
    best_state    = None
    patience_left = args.patience
    history       = []

    print(f"\n{'Epoch':>5} | {'TrainLoss':>9} | {'ValLoss':>8} | {'ValAcc':>7} | {'ValF1':>6} | LR")
    print("-" * 65)

    for epoch in range(1, args.epochs + 1):
        t0 = time.time()
        try:
            tr_loss, tr_acc = train_epoch(model, train_loader, criterion, optimiser, device, scaler,
                                          mixup_alpha=args.mixup_alpha)
            va_loss, va_acc, va_f1 = eval_epoch(model, val_loader, criterion, device)
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            raise RuntimeError(
                f"CUDA out of memory at epoch {epoch}. Try a smaller --batch-size "
                f"(currently {args.batch_size}), or restart the runtime to clear "
                f"any memory held by a previous run."
            ) from None
        scheduler.step()
        lr_now = optimiser.param_groups[0]["lr"]
        elapsed = time.time() - t0

        print(f"{epoch:>5} | {tr_loss:>9.4f} | "
              f"{va_loss:>8.4f} | {va_acc * 100:>6.2f}% | {va_f1:>6.4f} | {lr_now:.6f}  [{elapsed:.1f}s]")

        history.append({
            "epoch": epoch, "train_loss": tr_loss, "train_acc": tr_acc,
            "val_loss": va_loss, "val_acc": va_acc, "val_f1": va_f1, "lr": lr_now,
        })

        if va_f1 > best_val_f1:
            best_val_f1   = va_f1
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
    print(f"Best val F1    : {best_val_f1:.4f}  (checkpoint selection metric)")

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
        "best_val_f1": float(best_val_f1),
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
        "split_sizes": {"train": len(y_train), "val": len(y_val), "test": len(y_test)},
        "split_source_mix": (
            {
                split_name: dict(Counter(source[idx].tolist()))
                for split_name, idx in [("train", train_idx), ("val", val_idx), ("test", test_idx)]
            }
            if source is not None else None
        ),
        "test_set_is_clean_only": bool(is_original is not None),
        "device": device,
    }
    report_path = output_path.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Saved report: {report_path}")


if __name__ == "__main__":
    main()
