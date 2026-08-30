"""
Trains a regularized MLP on Wav2Vec 2.0 embeddings for Speech Emotion Recognition.

Anti-overfitting strategy (v2):
  - Smaller head:        768 -> 128 -> 64  (down from 768->256->128)
  - Gaussian noise aug:  sigma=0.05 injected at the input during training
  - Higher weight decay: 0.05  (up from 0.02)
  - SWA:                 Stochastic Weight Averaging over the last N epochs
  - MC Dropout:          10-sample Monte Carlo dropout at inference time
"""

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
from sklearn.model_selection import StratifiedGroupKFold
from torch.optim.lr_scheduler import CosineAnnealingLR
from torch.optim.swa_utils import AveragedModel, SWALR, update_bn
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

LABEL_NAMES = ["neutral", "happy", "sad", "angry", "fearful", "disgust", "surprised"]
N_CLASSES   = len(LABEL_NAMES)
RANDOM_SEED = 42

# Model
class EmotionMLP(nn.Module):
    """Smaller, more heavily regularized MLP head over W2V embeddings."""
    def __init__(self, input_dim: int = 768, n_classes: int = N_CLASSES, dropout: float = 0.6):
        super().__init__()
        self.net = nn.Sequential(
            nn.LayerNorm(input_dim),

            nn.Linear(input_dim, 128),
            nn.BatchNorm1d(128),
            nn.GELU(),
            nn.Dropout(dropout),

            nn.Linear(128, 64),
            nn.BatchNorm1d(64),
            nn.GELU(),
            nn.Dropout(dropout),

            nn.Linear(64, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


# Dataset with Gaussian noise augmentation
class NoisyTensorDataset(torch.utils.data.Dataset):
    """Wraps a TensorDataset and injects Gaussian noise into features during training."""
    def __init__(self, X: torch.Tensor, y: torch.Tensor, noise_std: float = 0.05, training: bool = True):
        self.X = X
        self.y = y
        self.noise_std = noise_std
        self.training  = training

    def __len__(self) -> int:
        return len(self.y)

    def __getitem__(self, idx):
        x = self.X[idx]
        if self.training and self.noise_std > 0:
            x = x + torch.randn_like(x) * self.noise_std
        return x, self.y[idx]


# Wrapper with MC Dropout inference
class W2VEmotionWrapper:
    model_type = "wav2vec_mlp"

    def __init__(self, model: nn.Module, device: str = "cpu", mc_samples: int = 10):
        self.model      = model
        self.device     = device
        self.mc_samples = mc_samples
        self.model.to(device)

    @torch.no_grad()
    def predict_proba(self, X: np.ndarray, batch_size: int = 128) -> np.ndarray:
        """
        Monte Carlo Dropout: run `mc_samples` forward passes with dropout *active*,
        then average the softmax probabilities. Falls back to a single deterministic
        pass when mc_samples == 1.
        """
        X_t = torch.from_numpy(X.astype(np.float32)).to(self.device)

        if self.mc_samples > 1:
            # Enable dropout layers during inference
            self.model.train()
            # Freeze BatchNorm in eval mode to keep running stats stable
            for m in self.model.modules():
                if isinstance(m, nn.BatchNorm1d):
                    m.eval()
        else:
            self.model.eval()

        sample_probs = []
        for _ in range(self.mc_samples):
            batch_probs = []
            for i in range(0, len(X_t), batch_size):
                batch  = X_t[i: i + batch_size]
                logits = self.model(batch)
                batch_probs.append(F.softmax(logits, dim=1).cpu().numpy())
            sample_probs.append(np.concatenate(batch_probs, axis=0))

        proba = np.mean(sample_probs, axis=0)
        self.model.eval()
        return proba

    def predict(self, X: np.ndarray, batch_size: int = 128) -> np.ndarray:
        return self.predict_proba(X, batch_size=batch_size).argmax(axis=1)


# Data splitting (actor-stratified, source-stratified)
def make_splits(X, y, actor, val_size, test_size, source):
    def _split_group(idx):
        y_sub, actor_sub = y[idx], actor[idx]
        splitter = StratifiedGroupKFold(
            n_splits=max(2, round(1 / test_size)), shuffle=True, random_state=RANDOM_SEED
        )
        trainval_rel, test_rel = next(splitter.split(idx, y_sub, actor_sub))

        val_frac     = val_size / (1 - test_size)
        splitter_val = StratifiedGroupKFold(
            n_splits=max(2, round(1 / val_frac)), shuffle=True, random_state=RANDOM_SEED
        )
        tr_rel, val_rel = next(
            splitter_val.split(idx[trainval_rel], y_sub[trainval_rel], actor_sub[trainval_rel])
        )
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

    return X[train_idx], X[val_idx], X[test_idx], y[train_idx], y[val_idx], y[test_idx]


# Main
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data",       default="/kaggle/working/wav2vec_features_combined.npz")
    parser.add_argument("--output",     default="/kaggle/working/w2v_model_combined.pkl")
    parser.add_argument("--epochs",     type=int,   default=120)
    parser.add_argument("--patience",   type=int,   default=20)
    parser.add_argument("--dropout",    type=float, default=0.6)
    parser.add_argument("--noise-std",  type=float, default=0.05,
                        help="Gaussian noise std added to embeddings during training (0 = disabled)")
    parser.add_argument("--wd",         type=float, default=0.05,  help="AdamW weight decay")
    parser.add_argument("--swa-start",  type=int,   default=80,
                        help="Epoch at which SWA kicks in (set > --epochs to disable)")
    parser.add_argument("--swa-lr",     type=float, default=1e-4,  help="SWA constant learning rate")
    parser.add_argument("--mc-samples", type=int,   default=10,    help="MC Dropout samples at inference")
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    data   = np.load(args.data, allow_pickle=True)
    X, y, actor, source = data["X"], data["y"], data["actor"], data["source"]

    X_train, X_val, X_test, y_train, y_val, y_test = make_splits(
        X, y, actor, 0.15, 0.2, source
    )

    # Weighted sampler for class imbalance
    counts  = Counter(y_train.tolist())
    weights = np.array([1.0 / counts[label] for label in y_train], dtype=np.float32)
    sampler = WeightedRandomSampler(weights, num_samples=len(weights), replacement=True)

    train_ds = NoisyTensorDataset(
        torch.from_numpy(X_train), torch.from_numpy(y_train),
        noise_std=args.noise_std, training=True
    )
    val_ds = NoisyTensorDataset(
        torch.from_numpy(X_val), torch.from_numpy(y_val),
        noise_std=0.0, training=False
    )

    train_loader = DataLoader(train_ds, batch_size=64, sampler=sampler)
    val_loader   = DataLoader(val_ds,   batch_size=128, shuffle=False)

    # Model, optimizer, scheduler
    model     = EmotionMLP(input_dim=768, n_classes=N_CLASSES, dropout=args.dropout).to(device)
    criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=args.wd)
    scheduler = CosineAnnealingLR(optimizer, T_max=args.swa_start, eta_min=1e-5)

    # SWA setup
    swa_model    = AveragedModel(model)
    swa_scheduler = SWALR(optimizer, swa_lr=args.swa_lr, anneal_epochs=5)
    swa_started  = False

    best_val_f1  = 0.0
    best_val_acc = 0.0
    best_state   = None
    patience_left = args.patience
    history       = []

    print(f"\nTraining W2V MLP v2 on {device}  "
          f"(noise_std={args.noise_std}, dropout={args.dropout}, wd={args.wd}, "
          f"swa_start={args.swa_start}, mc_samples={args.mc_samples})")

    for epoch in range(1, args.epochs + 1):
        # Training
        model.train()
        train_loss = 0.0
        for X_batch, y_batch in train_loader:
            X_batch, y_batch = X_batch.to(device), y_batch.to(device)
            optimizer.zero_grad()
            loss = criterion(model(X_batch), y_batch)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(y_batch)
        train_loss /= len(train_loader.dataset)

        # Scheduler step
        if epoch >= args.swa_start:
            if not swa_started:
                swa_started = True
                print(f"  [SWA] Started at epoch {epoch}")
            swa_model.update_parameters(model)
            swa_scheduler.step()
        else:
            scheduler.step()

        # Validation (always on the base model)
        model.eval()
        val_loss = 0.0
        all_preds, all_targets = [], []
        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                X_batch, y_batch_d = X_batch.to(device), y_batch.to(device)
                logits   = model(X_batch)
                val_loss += criterion(logits, y_batch_d).item() * len(y_batch)
                all_preds.append(logits.argmax(dim=1).cpu())
                all_targets.append(y_batch)

        val_loss /= len(val_loader.dataset)
        preds_np   = torch.cat(all_preds).numpy()
        targets_np = torch.cat(all_targets).numpy()

        val_acc = accuracy_score(targets_np, preds_np)
        val_f1  = f1_score(targets_np, preds_np, average="macro")
        lr_now  = optimizer.param_groups[0]["lr"]

        history.append({
            "epoch": epoch, "train_loss": train_loss, "val_loss": val_loss,
            "val_acc": val_acc, "val_f1": val_f1, "lr": lr_now,
            "swa_active": swa_started,
        })
        print(f"Epoch {epoch:03d} | TrLoss: {train_loss:.4f} | ValLoss: {val_loss:.4f} "
              f"| ValAcc: {val_acc*100:.2f}% | ValF1: {val_f1:.4f}"
              + (" [SWA]" if swa_started else ""))

        # Early stopping (only before SWA; SWA runs to completion)
        if not swa_started:
            if val_f1 > best_val_f1:
                best_val_f1  = val_f1
                best_val_acc = val_acc
                best_state   = {k: v.cpu().clone() for k, v in model.state_dict().items()}
                patience_left = args.patience
            else:
                patience_left -= 1
                if patience_left == 0:
                    print(f"\nEarly stopping triggered at epoch {epoch} (before SWA).")
                    break

    # Finalise: prefer SWA model if it ran, otherwise best checkpoint
    if swa_started:
        print("\nUpdating BatchNorm statistics for SWA model …")
        # Feed training data through swa_model to recalibrate BN running stats
        swa_model.train()
        with torch.no_grad():
            for X_batch, _ in train_loader:
                swa_model(X_batch.to(device))
        final_model = swa_model
        print("Using SWA-averaged model for evaluation.")
    else:
        if best_state is not None:
            model.load_state_dict(best_state)
        final_model = model
        print("Using best-checkpoint model (SWA did not start).")

    wrapper = W2VEmotionWrapper(final_model, device=device, mc_samples=args.mc_samples)

    # Holdout evaluation
    y_pred       = wrapper.predict(X_test)
    y_train_pred = wrapper.predict(X_train)

    test_acc    = accuracy_score(y_test, y_pred)
    train_acc   = accuracy_score(y_train, y_train_pred)
    overfit_gap = train_acc - test_acc

    print("\n=== Holdout Evaluation ===")
    print(f"Test Accuracy  : {test_acc * 100:.2f}%")
    print(f"Train Accuracy : {train_acc * 100:.2f}%")
    print(f"Overfit Gap    : {overfit_gap * 100:.2f}%\n")
    print(classification_report(y_test, y_pred, target_names=LABEL_NAMES, zero_division=0))

    # Save model artifact
    out_path = Path(args.output)
    joblib.dump(wrapper, out_path)
    print(f"Saved model to {out_path}")

    # Save JSON report
    matrix = confusion_matrix(y_test, y_pred)
    report = {
        "model_type":     "wav2vec_mlp",
        "version":        2,
        "input_dim":      768,
        "n_classes":      N_CLASSES,
        "label_names":    LABEL_NAMES,
        "hyperparams": {
            "dropout":    args.dropout,
            "noise_std":  args.noise_std,
            "weight_decay": args.wd,
            "swa_start":  args.swa_start,
            "mc_samples": args.mc_samples,
        },
        "best_val_acc":   float(best_val_acc),
        "best_val_f1":    float(best_val_f1),
        "test_accuracy":  float(test_acc),
        "test_macro_f1":  float(f1_score(y_test, y_pred, average="macro")),
        "train_accuracy": float(train_acc),
        "overfit_gap":    float(overfit_gap),
        "classification_report": classification_report(
            y_test, y_pred, target_names=LABEL_NAMES, zero_division=0, output_dict=True
        ),
        "confusion_matrix":  matrix.tolist(),
        "training_history":  history,
    }

    report_path = out_path.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Saved JSON report to {report_path}")


if __name__ == "__main__":
    main()