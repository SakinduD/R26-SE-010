"""
Train MCA Speech Emotion Recognition model with:
1. Dynamic 3-Channel Delta/Delta-Delta audio feature extraction (on-the-fly).
2. Adversarial Speaker Disentanglement (GRL) to destroy speaker identity leakage.
3. Residual Squeeze-and-Excitation CNN backbone with Self-Attention Pooling.
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
import torchaudio.functional as ta_F
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedGroupKFold
from torch.autograd import Function
from torch.optim.lr_scheduler import CosineAnnealingLR
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler

LABEL_NAMES = ["neutral", "happy", "sad", "angry", "fearful", "disgust", "surprised"]
N_CLASSES   = len(LABEL_NAMES)
RANDOM_SEED = 42
DATA_PATH   = "mel_features_combined.npz"
OUTPUT_PATH = "cnn_model_combined_grl.pkl"



# Dataset with On-The-Fly Delta & Delta-Delta Computation
class MelDeltaDataset(Dataset):
    def __init__(self, X: np.ndarray, y: np.ndarray, actors: np.ndarray | None = None, augment: bool = False):
        self.X = torch.from_numpy(X)          # (N, 1, 128, 128) float32
        self.y = torch.from_numpy(y.astype(np.int64))
        self.actors = torch.from_numpy(actors.astype(np.int64)) if actors is not None else None
        self.augment = augment

    def __len__(self) -> int:
        return len(self.y)

    def __getitem__(self, idx: int):
        x = self.X[idx].clone()  # (1, 128, 128)

        if self.augment:
            x = self._spec_augment(x)

        # Compute 1st derivative (velocity) & 2nd derivative (acceleration)
        delta  = ta_F.compute_deltas(x)
        delta2 = ta_F.compute_deltas(delta)

        # Stack into 3-channel input: (3, 128, 128)
        x_3ch = torch.cat([x, delta, delta2], dim=0)

        actor_label = self.actors[idx] if self.actors is not None else -1
        return x_3ch, self.y[idx], actor_label

    @staticmethod
    def _spec_augment(x: torch.Tensor) -> torch.Tensor:
        _, n_mels, n_frames = x.shape
        mean_val = x.mean()

        for _ in range(2):
            f_mask = np.random.randint(4, 18)
            f_start = np.random.randint(0, max(1, n_mels - f_mask))
            x[:, f_start: f_start + f_mask, :] = mean_val

        for _ in range(2):
            t_mask = np.random.randint(4, 20)
            t_start = np.random.randint(0, max(1, n_frames - t_mask))
            x[:, :, t_start: t_start + t_mask] = mean_val

        return x


# Gradient Reversal Layer (GRL)
class GradientReversalFunction(Function):
    @staticmethod
    def forward(ctx, x, alpha):
        ctx.alpha = alpha
        return x.view_as(x)

    @staticmethod
    def backward(ctx, grad_output):
        return grad_output.neg() * ctx.alpha, None


def grad_reverse(x, alpha=1.0):
    return GradientReversalFunction.apply(x, alpha)


# Model Architecture (ResNet-SE + Speaker Adversarial Head)
class SEBlock(nn.Module):
    def __init__(self, channels: int, reduction: int = 16):
        super().__init__()
        self.fc = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(channels, channels // reduction, bias=False),
            nn.ReLU(inplace=True),
            nn.Linear(channels // reduction, channels, bias=False),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, c, _, _ = x.shape
        w = self.fc(x).view(b, c, 1, 1)
        return x * w


class ResidualConvBlock(nn.Module):
    def __init__(self, in_ch: int, out_ch: int, dropout: float = 0.25):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
        )
        self.shortcut = nn.Sequential(
            nn.Conv2d(in_ch, out_ch, 1, bias=False),
            nn.BatchNorm2d(out_ch),
        ) if in_ch != out_ch else nn.Identity()

        self.se = SEBlock(out_ch)
        self.relu = nn.ReLU(inplace=True)
        self.pool = nn.MaxPool2d(2)
        self.drop = nn.Dropout2d(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        res = self.shortcut(x)
        out = self.conv(x)
        out = self.se(out)
        out = self.relu(out + res)
        return self.drop(self.pool(out))


class AdversarialEmotionCNN(nn.Module):
    def __init__(self, n_classes: int = N_CLASSES, n_speakers: int = 44, dropout: float = 0.4):
        super().__init__()
        # Backbone processes 3 channels (Mel + Delta + Delta2)
        self.block1 = ResidualConvBlock(3,   32,  dropout=dropout / 2)
        self.block2 = ResidualConvBlock(32,  64,  dropout=dropout / 2)
        self.block3 = ResidualConvBlock(64,  128, dropout=dropout / 2)
        self.block4 = ResidualConvBlock(128, 256, dropout=dropout / 2)

        # Statistical Pooling (Mean + Std) -> 512 dimensions
        self.feat_dim = 512

        # 1. Main Emotion Classifier
        self.emotion_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(self.feat_dim, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(128, n_classes),
        )

        # 2. Adversarial Speaker Classifier (Forces features to be speaker-invariant)
        self.speaker_head = nn.Sequential(
            nn.Linear(self.feat_dim, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.Linear(128, n_speakers),
        )

    def extract_features(self, x: torch.Tensor) -> torch.Tensor:
        x = self.block1(x)
        x = self.block2(x)
        x = self.block3(x)
        x = self.block4(x)
        mean = torch.mean(x, dim=[2, 3])
        std  = torch.std(x, dim=[2, 3], unbiased=False)
        return torch.cat([mean, std], dim=1)

    def forward(self, x: torch.Tensor, grl_alpha: float = 0.0):
        feats = self.extract_features(x)
        emotion_logits = self.emotion_head(feats)

        # Speaker branch receives inverted gradients via GRL
        rev_feats = grad_reverse(feats, grl_alpha)
        speaker_logits = self.speaker_head(rev_feats)

        return emotion_logits, speaker_logits


# Inference Wrapper
class CNNEmotionWrapper:
    model_type = "cnn"

    def __init__(self, model: AdversarialEmotionCNN, device: str = "cpu"):
        self.model = model
        self.device = device
        self.model.to(device)
        self.model.eval()

    def _to_3ch_tensor(self, X: np.ndarray) -> torch.Tensor:
        if X.ndim == 2:
            X = X.reshape(-1, 1, 128, 128)
        elif X.ndim == 3:
            X = X[np.newaxis]

        t = torch.from_numpy(X.astype(np.float32))
        delta  = ta_F.compute_deltas(t)
        delta2 = ta_F.compute_deltas(delta)
        x_3ch  = torch.cat([t, delta, delta2], dim=1)
        return x_3ch.to(self.device)

    @torch.no_grad()
    def predict_proba(self, X: np.ndarray, batch_size: int = 64) -> np.ndarray:
        results = []
        for i in range(0, len(X), batch_size):
            batch = self._to_3ch_tensor(X[i: i + batch_size])
            emotion_logits, _ = self.model(batch, grl_alpha=0.0)
            results.append(F.softmax(emotion_logits, dim=1).cpu().numpy())
        return np.concatenate(results, axis=0)

    def predict(self, X: np.ndarray, batch_size: int = 64) -> np.ndarray:
        return self.predict_proba(X, batch_size=batch_size).argmax(axis=1)


# Data Splitting & Helper Functions
def load_dataset(data_path: Path):
    if not data_path.exists():
        raise FileNotFoundError(f"{data_path} not found.")

    data        = np.load(data_path, allow_pickle=True)
    X           = data["X"].astype(np.float32)
    y           = data["y"].astype(np.int64)
    actor       = data["actor"] if "actor" in data.files else None
    is_original = data["is_original"] if "is_original" in data.files else None
    source      = data["source"] if "source" in data.files else None

    return X, y, actor, is_original, source


def make_splits(X, y, actor, is_original, val_size: float, test_size: float, source=None):
    def _split_group(idx):
        y_sub, actor_sub = y[idx], actor[idx]
        n_splits = max(2, round(1 / test_size))
        splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=RANDOM_SEED)
        trainval_rel, test_rel = next(splitter.split(idx, y_sub, actor_sub))

        val_frac = val_size / (1 - test_size)
        splitter_val = StratifiedGroupKFold(n_splits=max(2, round(1 / val_frac)), shuffle=True, random_state=RANDOM_SEED)
        tr_rel, val_rel = next(splitter_val.split(idx[trainval_rel], y_sub[trainval_rel], actor_sub[trainval_rel]))

        return idx[trainval_rel[tr_rel]], idx[trainval_rel[val_rel]], idx[test_rel]

    train_parts, val_parts, test_parts = [], [], []
    for src in sorted(set(source.tolist())):
        idx = np.where(source == src)[0]
        tr, va, te = _split_group(idx)
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
            actor[train_idx], actor[val_idx], actor[test_idx],
            train_idx, val_idx, test_idx)


def make_sampler(y_train: np.ndarray) -> WeightedRandomSampler:
    counts  = Counter(y_train.tolist())
    weights = np.array([1.0 / counts[label] for label in y_train], dtype=np.float32)
    return WeightedRandomSampler(weights, num_samples=len(weights), replacement=True)


# Training Routine
def train_epoch(model, loader, emotion_crit, speaker_crit, optimiser, device, scaler, epoch, total_epochs, mixup_alpha=0.3):
    model.train()
    total_loss, total_em_loss, total_spk_loss, n = 0.0, 0.0, 0.0, 0

    # Dynamic GRL Alpha schedule (0 -> 1 as training progresses)
    p = float(epoch) / total_epochs
    grl_alpha = 2.0 / (1.0 + np.exp(-10 * p)) - 1.0

    for X_batch, y_batch, spk_batch in loader:
        X_batch, y_batch, spk_batch = X_batch.to(device), y_batch.to(device), spk_batch.to(device)

        # MixUp on emotion only
        lam = float(np.random.beta(mixup_alpha, mixup_alpha)) if mixup_alpha > 0 else 1.0
        idx = torch.randperm(X_batch.size(0), device=device)
        X_mix = lam * X_batch + (1 - lam) * X_batch[idx]
        y_a, y_b = y_batch, y_batch[idx]

        optimiser.zero_grad()
        with torch.autocast(device_type="cuda" if device == "cuda" else "cpu", enabled=(device == "cuda")):
            em_logits, spk_logits = model(X_mix, grl_alpha=grl_alpha)
            em_loss = lam * emotion_crit(em_logits, y_a) + (1 - lam) * emotion_crit(em_logits, y_b)
            spk_loss = speaker_crit(spk_logits, spk_batch)
            loss = em_loss + 0.25 * spk_loss

        scaler.scale(loss).backward()
        scaler.unscale_(optimiser)
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        scaler.step(optimiser)
        scaler.update()

        total_loss     += loss.item() * len(y_batch)
        total_em_loss  += em_loss.item() * len(y_batch)
        total_spk_loss += spk_loss.item() * len(y_batch)
        n              += len(y_batch)

    return total_loss / n, total_em_loss / n, total_spk_loss / n


@torch.no_grad()
def eval_epoch(model, loader, emotion_crit, device):
    model.eval()
    total_loss, n = 0.0, 0
    all_preds, all_targets = [], []
    for X_batch, y_batch, _ in loader:
        X_batch, y_batch = X_batch.to(device), y_batch.to(device)
        em_logits, _ = model(X_batch, grl_alpha=0.0)
        loss = emotion_crit(em_logits, y_batch)
        total_loss += loss.item() * len(y_batch)
        n          += len(y_batch)
        all_preds.append(em_logits.argmax(1).cpu())
        all_targets.append(y_batch.cpu())

    all_preds   = torch.cat(all_preds).numpy()
    all_targets = torch.cat(all_targets).numpy()
    accuracy = float((all_preds == all_targets).mean())
    macro_f1 = f1_score(all_targets, all_preds, average="macro", zero_division=0)
    return total_loss / n, accuracy, macro_f1


# Main Entrypoint
def main() -> None:
    parser = argparse.ArgumentParser(description="Train Adversarial SER Model.")
    parser.add_argument("--data",       default=DATA_PATH)
    parser.add_argument("--output",     default=OUTPUT_PATH)
    parser.add_argument("--epochs",     type=int,   default=100)
    parser.add_argument("--batch-size", type=int,   default=64)
    parser.add_argument("--lr",         type=float, default=0.0008)
    parser.add_argument("--dropout",    type=float, default=0.45)
    parser.add_argument("--test-size",  type=float, default=0.2)
    parser.add_argument("--val-size",   type=float, default=0.2)
    parser.add_argument("--patience",   type=int,   default=40)
    parser.add_argument("--weight-decay", type=float, default=0.001)
    parser.add_argument("--mixup-alpha", type=float, default=0.3)
    args = parser.parse_args()

    torch.manual_seed(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    print("=== Training Speaker-Adversarial SER Model (Delta + GRL) ===")
    X, y, actor, is_original, source = load_dataset(Path(args.data))

    # Integer encode actors for speaker classification head
    unique_actors = sorted(set(actor.tolist()))
    actor_to_id = {name: i for i, name in enumerate(unique_actors)}
    actor_encoded = np.array([actor_to_id[a] for a in actor])
    n_speakers = len(unique_actors)
    print(f"Detected {n_speakers} unique speakers across dataset.")

    (X_train, X_val, X_test,
     y_train, y_val, y_test,
     act_train, act_val, act_test,
     train_idx, val_idx, test_idx) = make_splits(
        X, y, actor_encoded, is_original, args.val_size, args.test_size, source=source
    )

    train_ds = MelDeltaDataset(X_train, y_train, act_train, augment=True)
    val_ds   = MelDeltaDataset(X_val,   y_val,   act_val,   augment=False)
    sampler  = make_sampler(y_train)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, sampler=sampler, num_workers=0, pin_memory=(device == "cuda"))
    val_loader   = DataLoader(val_ds,   batch_size=args.batch_size * 2, shuffle=False, num_workers=0)

    model = AdversarialEmotionCNN(n_classes=N_CLASSES, n_speakers=n_speakers, dropout=args.dropout).to(device)
    print(f"Total Parameters: {sum(p.numel() for p in model.parameters() if p.requires_grad):,}")

    emotion_criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
    speaker_criterion = nn.CrossEntropyLoss()
    optimiser = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = CosineAnnealingLR(optimiser, T_max=args.epochs, eta_min=1e-6)
    scaler    = torch.amp.GradScaler("cuda", enabled=(device == "cuda"))

    best_val_f1, best_val_acc, best_state = 0.0, 0.0, None
    patience_left = args.patience
    history = []

    print(f"\n{'Epoch':>5} | {'Loss':>8} | {'EmLoss':>8} | {'SpkLoss':>8} | {'ValLoss':>8} | {'ValAcc':>7} | {'ValF1':>6} | LR")
    print("-" * 80)

    for epoch in range(1, args.epochs + 1):
        t0 = time.time()
        loss, em_loss, spk_loss = train_epoch(
            model, train_loader, emotion_criterion, speaker_criterion, optimiser, device, scaler, epoch, args.epochs, mixup_alpha=args.mixup_alpha
        )
        va_loss, va_acc, va_f1 = eval_epoch(model, val_loader, emotion_criterion, device)
        scheduler.step()
        lr_now = optimiser.param_groups[0]["lr"]

        print(f"{epoch:>5} | {loss:>8.4f} | {em_loss:>8.4f} | {spk_loss:>8.4f} | {va_loss:>8.4f} | {va_acc * 100:>6.2f}% | {va_f1:>6.4f} | {lr_now:.6f} [{time.time() - t0:.1f}s]")

        history.append({
            "epoch": epoch, "train_loss": em_loss, "val_loss": va_loss, "val_acc": va_acc, "val_f1": va_f1, "lr": lr_now
        })

        if va_f1 > best_val_f1:
            best_val_f1, best_val_acc = va_f1, va_acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            patience_left = args.patience
        else:
            patience_left -= 1
            if patience_left == 0:
                print(f"\nEarly stopping at epoch {epoch}.")
                break

    if best_state is not None:
        model.load_state_dict(best_state)

    wrapper = CNNEmotionWrapper(model, device=device)
    y_pred = wrapper.predict(X_test)
    y_train_pred = wrapper.predict(X_train)

    test_acc    = accuracy_score(y_test, y_pred)
    test_f1     = f1_score(y_test, y_pred, average="macro")
    train_acc   = accuracy_score(y_train, y_train_pred)
    overfit_gap = train_acc - test_acc

    print("\n=== Holdout Evaluation ===")
    print(classification_report(y_test, y_pred, target_names=LABEL_NAMES, zero_division=0))
    matrix = confusion_matrix(y_test, y_pred)
    print(f"Test accuracy  : {test_acc * 100:.2f}%")
    print(f"Test macro F1  : {test_f1:.4f}")
    print(f"Train accuracy : {train_acc * 100:.2f}%")
    print(f"Overfit gap    : {overfit_gap * 100:.2f}%")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(wrapper, output_path)

    report = {
        "model_type": "cnn",
        "architecture": "AdversarialEmotionCNN_GRL_3Ch",
        "best_val_acc": float(best_val_acc),
        "best_val_f1": float(best_val_f1),
        "test_accuracy": float(test_acc),
        "test_macro_f1": float(test_f1),
        "train_accuracy": float(train_acc),
        "overfit_gap": float(overfit_gap),
        "classification_report": classification_report(y_test, y_pred, target_names=LABEL_NAMES, zero_division=0, output_dict=True),
        "confusion_matrix": matrix.tolist(),
        "training_history": history,
    }
    output_path.with_suffix(".report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Saved report to {output_path.with_suffix('.report.json')}")


if __name__ == "__main__":
    main()