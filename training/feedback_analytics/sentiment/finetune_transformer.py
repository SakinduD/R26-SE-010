"""Fine-tune a small transformer on the three-class workplace corpus.

What this is for
----------------
Three models have now been measured on the same hand-labelled workplace set, and
each wins at a different half of the problem:

    Sentiment140 TF-IDF   positive recall 0.56   no mixed class at all
    Glassdoor TF-IDF      positive recall 0.38   mixed F1 0.80
    RoBERTa (pretrained)  positive recall 0.69   mixed F1 0.40

The split is not accidental. The transformer reads words in context, so it
survives "I did not rush a single answer" where both bag-of-words models call it
negative at 0.86. But it has no `mixed` class - its `neutral` means "no judgement
here", not "two opposing judgements" - so it fails the shape that every real
learner reflection collected so far actually takes.

Fine-tuning a transformer on the Glassdoor three-class data is the one experiment
that could produce both: contextual reading from the pretrained weights, the
mixed class from the data.

Plain PyTorch rather than the Trainer API, deliberately - fewer moving parts to
break across library versions, and the loop is short enough to read.

Usage
-----
    # prove the pipeline works, a couple of minutes
    python -m training.feedback_analytics.sentiment.finetune_transformer --smoke

    # the real run
    python -m training.feedback_analytics.sentiment.finetune_transformer \\
        --limit-per-class 5000 --epochs 2

Then score it with the same instrument as everything else:

    python -m training.feedback_analytics.sentiment.evaluate_transformer \\
        --model training/feedback_analytics/models/sentiment_distilbert
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_BACKEND = _ROOT / "Backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from training.feedback_analytics.sentiment.glassdoor_dataset import (  # noqa: E402
    load_glassdoor_reviews,
)

DEFAULT_BASE_MODEL = "distilbert-base-uncased"
DEFAULT_OUTPUT = _ROOT / "training" / "feedback_analytics" / "models" / "sentiment_distilbert"

# Fixed so the label ids in the saved model never depend on iteration order.
LABELS = ["negative", "mixed", "positive"]
LABEL_TO_ID = {label: index for index, label in enumerate(LABELS)}

# Reflections are single sentences; the Glassdoor first-sentence texts average
# under 12 words. A long window would spend most of its compute on padding.
MAX_LENGTH = 64


def main() -> None:
    args = parse_args()
    import torch

    torch.manual_seed(args.seed)
    random.seed(args.seed)

    limit = 100 if args.smoke else args.limit_per_class
    epochs = 1 if args.smoke else args.epochs

    print(f"Loading Glassdoor corpus (limit_per_class={limit}) ...")
    dataset = load_glassdoor_reviews(limit_per_class=limit)
    texts, labels = dataset.texts, dataset.labels
    print(f"  {len(texts):,} texts   {dataset.label_distribution}")

    train, validation = split(texts, labels, args.validation_share, args.seed)
    print(f"  train {len(train[0]):,}   held-out {len(validation[0]):,}")

    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    print(f"Loading {args.base_model} ...")
    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.base_model,
        num_labels=len(LABELS),
        id2label={index: label for label, index in LABEL_TO_ID.items()},
        label2id=LABEL_TO_ID,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    print(f"  device: {device}")

    optimiser = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    batches_per_epoch = (len(train[0]) + args.batch_size - 1) // args.batch_size
    total_steps = batches_per_epoch * epochs
    print(f"  {batches_per_epoch:,} batches/epoch x {epochs} epochs = {total_steps:,} steps")

    started = time.perf_counter()
    step = 0
    for epoch in range(epochs):
        model.train()
        order = list(range(len(train[0])))
        random.shuffle(order)
        running_loss = 0.0

        for start in range(0, len(order), args.batch_size):
            batch = order[start : start + args.batch_size]
            encoded = tokenizer(
                [train[0][index] for index in batch],
                padding=True,
                truncation=True,
                max_length=MAX_LENGTH,
                return_tensors="pt",
            ).to(device)
            targets = torch.tensor(
                [LABEL_TO_ID[train[1][index]] for index in batch], device=device
            )

            optimiser.zero_grad()
            loss = model(**encoded, labels=targets).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimiser.step()

            running_loss += float(loss)
            step += 1
            if step % args.log_every == 0 or step == total_steps:
                elapsed = time.perf_counter() - started
                rate = step / elapsed
                remaining = (total_steps - step) / rate if rate else 0
                print(
                    f"  step {step:>6,}/{total_steps:,}"
                    f"  loss {running_loss / args.log_every:.4f}"
                    f"  {rate:.2f} steps/s"
                    f"  eta {remaining / 60:.1f} min",
                    flush=True,
                )
                running_loss = 0.0

    training_seconds = round(time.perf_counter() - started, 1)
    print(f"Trained in {training_seconds / 60:.1f} min")

    accuracy, per_class = evaluate(model, tokenizer, validation, device, args.batch_size)
    print(f"Held-out Glassdoor accuracy: {accuracy:.4f}")
    for label, stats in per_class.items():
        print(f"  {label:<9} support={stats['support']:<6} recall={stats['recall']}")

    args.output.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    (args.output / "training_metadata.json").write_text(
        json.dumps(
            {
                "base_model": args.base_model,
                "dataset_name": "Glassdoor Job Reviews",
                "model_version": f"{Path(args.base_model).name}-glassdoor-3class-v1",
                "labels": LABELS,
                "trained_at": datetime.now(UTC).isoformat(),
                "smoke_run": args.smoke,
                "limit_per_class": limit,
                "epochs": epochs,
                "batch_size": args.batch_size,
                "learning_rate": args.learning_rate,
                "max_length": MAX_LENGTH,
                "seed": args.seed,
                "train_rows": len(train[0]),
                "heldout_rows": len(validation[0]),
                "training_seconds": training_seconds,
                "heldout_accuracy": round(accuracy, 4),
                "heldout_per_class": per_class,
                "dataset_summary": dataset.summary,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Saved: {args.output}")
    print()
    print("Score it against the workplace validation set with:")
    print(
        "  python -m training.feedback_analytics.sentiment.evaluate_transformer"
        f" --model {args.output}"
    )


def split(texts, labels, validation_share, seed):
    """Stratified hold-out, so a rare class cannot vanish from either side."""
    by_label: dict[str, list[int]] = {}
    for index, label in enumerate(labels):
        by_label.setdefault(label, []).append(index)

    rng = random.Random(seed)
    train_indices: list[int] = []
    validation_indices: list[int] = []
    for indices in by_label.values():
        shuffled = indices[:]
        rng.shuffle(shuffled)
        cut = max(1, int(len(shuffled) * validation_share))
        validation_indices.extend(shuffled[:cut])
        train_indices.extend(shuffled[cut:])

    rng.shuffle(train_indices)
    return (
        ([texts[i] for i in train_indices], [labels[i] for i in train_indices]),
        ([texts[i] for i in validation_indices], [labels[i] for i in validation_indices]),
    )


def evaluate(model, tokenizer, validation, device, batch_size):
    import torch

    texts, labels = validation
    model.eval()
    predictions: list[str] = []
    with torch.no_grad():
        for start in range(0, len(texts), batch_size):
            encoded = tokenizer(
                texts[start : start + batch_size],
                padding=True,
                truncation=True,
                max_length=MAX_LENGTH,
                return_tensors="pt",
            ).to(device)
            logits = model(**encoded).logits
            predictions.extend(LABELS[int(index)] for index in logits.argmax(dim=-1))

    correct = sum(1 for predicted, actual in zip(predictions, labels) if predicted == actual)
    per_class = {}
    for label in LABELS:
        support = sum(1 for actual in labels if actual == label)
        hits = sum(
            1
            for predicted, actual in zip(predictions, labels)
            if actual == label and predicted == label
        )
        per_class[label] = {
            "support": support,
            "recall": round(hits / support, 4) if support else None,
        }
    return correct / len(labels), per_class


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fine-tune a small transformer on the Glassdoor three-class corpus."
    )
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit-per-class", type=int, default=5000)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=3e-5)
    parser.add_argument("--validation-share", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--log-every", type=int, default=25)
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Tiny run that proves the pipeline end to end before a long one is started.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
