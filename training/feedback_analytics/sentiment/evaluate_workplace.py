"""Score the serving sentiment model against hand-labelled workplace text.

This is the measurement the project does not yet have. ``sentiment_evaluation.json``
reports 78.01% accuracy, but that number was produced on a held-out slice of
Sentiment140 - tweets, scored against tweets. It is not evidence about the
sentences this system is actually given.

Run this before changing anything about the model, and again afterwards, against
the same labelled file. Two numbers from one instrument are the only way to show
that a change was an improvement rather than a rearrangement.

Three things are reported, and the second two matter as much as the first:

1. Accuracy, precision, recall and F1 on rows a human labelled positive or
   negative - split by ``learner`` and ``authored`` source, because a result
   carried by authored sentences is a result about the author.

2. Confidence, and how much of it clears the 0.60 gate that blind-spot detection
   requires. A prediction below that gate is discarded by the application, so a
   model that is right but unconfident is, in production, a model that is silent.

3. What the model does with rows labelled ``mixed`` or ``neutral``. It has two
   classes and no way to abstain, so it must answer something. How confidently it
   answers text that has no single correct answer says whether the two-class
   design is holding up - the real reflections collected so far are mostly of
   exactly this shape.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_BACKEND = _ROOT / "Backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from research.nlp_sentiment.sentiment_baseline import (  # noqa: E402
    load_model,
    predict_sentiment,
)

DEFAULT_INPUT = (
    _ROOT
    / "training"
    / "feedback_analytics"
    / "datasets"
    / "validation"
    / "workplace_sentiment_validation.csv"
)
DEFAULT_MODEL = (
    _ROOT / "training" / "feedback_analytics" / "models" / "sentiment_model.joblib"
)
DEFAULT_OUTPUT = (
    _ROOT
    / "training"
    / "feedback_analytics"
    / "evaluation"
    / "sentiment_workplace_evaluation.json"
)

# The confidence blind-spot detection demands before it will use a reading.
# Mirrors MIN_SENTIMENT_CONFIDENCE in app/services/blind_spot_service.py.
PRODUCTION_CONFIDENCE_GATE = 0.60

BINARY_LABELS = {"positive", "negative"}
UNSCORABLE_LABELS = {"mixed", "neutral"}


def main() -> None:
    args = parse_args()
    rows = read_labelled_rows(args.input)
    if not rows:
        raise SystemExit(
            f"No labelled rows in {args.input}.\n"
            "Fill the `label` column with positive / negative / mixed / neutral first."
        )

    model, metadata = load_model(args.model)
    for row in rows:
        prediction = predict_sentiment(model, row["text"])
        row["predicted"] = prediction["sentiment"]
        row["confidence"] = prediction["confidence"]

    # A label is scorable when the model is capable of predicting it. The
    # two-class Sentiment140 model cannot answer "mixed" at all, so scoring it on
    # mixed rows would only measure which wrong box it fell into. A three-class
    # model trained on workplace reviews can, and there it is a fair question.
    predictable = {str(name) for name in model.classes_}
    scorable = [row for row in rows if row["label"] in predictable]
    unscorable = [row for row in rows if row["label"] not in predictable]

    report = {
        "evaluated_at": datetime.now(UTC).isoformat(),
        "validation_set": str(args.input),
        "model_path": str(args.model),
        "model_version": metadata.get("model_version"),
        "trained_on": metadata.get("dataset_name"),
        "confidence_gate": PRODUCTION_CONFIDENCE_GATE,
        # Ground truth is only as good as whoever decided it. A reader of this
        # report must be able to see that without opening the CSV.
        "ground_truth": {
            "labelled_by": dict(Counter(row["labelled_by"] for row in rows)),
            "human_reviewed_share": rounded(
                sum(1 for row in rows if row["labelled_by"] == "human") / len(rows)
            ),
        },
        "row_counts": {
            "labelled_total": len(rows),
            "scored": len(scorable),
            "unscorable_mixed_or_neutral": len(unscorable),
            "by_source": dict(Counter(row["source"] for row in rows)),
        },
        "overall": score(scorable),
        "by_source": {
            source: score([row for row in scorable if row["source"] == source])
            for source in sorted({row["source"] for row in scorable})
        },
        "unscorable_behaviour": unscorable_behaviour(unscorable),
        "errors": [
            {
                "text": row["text"],
                "source": row["source"],
                "expected": row["label"],
                "predicted": row["predicted"],
                "confidence": row["confidence"],
            }
            for row in scorable
            if row["predicted"] != row["label"]
        ],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print_report(report)
    print(f"\nSaved: {args.output}")


def score(rows: list[dict]) -> dict | None:
    """Accuracy plus per-class precision/recall/F1, computed without sklearn.

    Small hand-labelled sets are frequently missing a class entirely; the metric
    functions in sklearn warn or return zero silently in that case. Doing the
    arithmetic here keeps an absent class visibly absent.
    """
    if not rows:
        return None

    correct = sum(1 for row in rows if row["predicted"] == row["label"])
    confidences = [row["confidence"] for row in rows]
    above_gate = [row for row in rows if row["confidence"] >= PRODUCTION_CONFIDENCE_GATE]
    correct_above_gate = sum(1 for row in above_gate if row["predicted"] == row["label"])

    per_class = {}
    labels_present = sorted({row["label"] for row in rows} | {row["predicted"] for row in rows})
    for label in labels_present:
        true_positive = sum(
            1 for row in rows if row["label"] == label and row["predicted"] == label
        )
        predicted_count = sum(1 for row in rows if row["predicted"] == label)
        actual_count = sum(1 for row in rows if row["label"] == label)
        precision = true_positive / predicted_count if predicted_count else None
        recall = true_positive / actual_count if actual_count else None
        f1 = (
            2 * precision * recall / (precision + recall)
            if precision and recall
            else (0.0 if actual_count or predicted_count else None)
        )
        per_class[label] = {
            "support": actual_count,
            "precision": rounded(precision),
            "recall": rounded(recall),
            "f1": rounded(f1),
        }

    return {
        "count": len(rows),
        "accuracy": rounded(correct / len(rows)),
        "correct": correct,
        "per_class": per_class,
        "confidence": {
            "mean": rounded(statistics.fmean(confidences)),
            "median": rounded(statistics.median(confidences)),
            "min": rounded(min(confidences)),
            "max": rounded(max(confidences)),
        },
        "production_gate": {
            "reached_gate": len(above_gate),
            "below_gate_discarded": len(rows) - len(above_gate),
            "share_usable": rounded(len(above_gate) / len(rows)),
            "accuracy_when_used": rounded(
                correct_above_gate / len(above_gate) if above_gate else None
            ),
        },
    }


def unscorable_behaviour(rows: list[dict]) -> dict | None:
    """What the model claims about text that has no single right answer."""
    if not rows:
        return None
    confidences = [row["confidence"] for row in rows]
    confident = [row for row in rows if row["confidence"] >= PRODUCTION_CONFIDENCE_GATE]
    return {
        "count": len(rows),
        "labels": dict(Counter(row["label"] for row in rows)),
        "predicted_distribution": dict(Counter(row["predicted"] for row in rows)),
        "mean_confidence": rounded(statistics.fmean(confidences)),
        "asserted_above_gate": len(confident),
        "note": (
            "Rows carrying a label this model has no class for. It must answer "
            "something, so predictions above the gate are cases where the "
            "application would act on a confident answer to a question the model "
            "was never able to answer."
        ),
    }


def print_report(report: dict) -> None:
    counts = report["row_counts"]
    truth = report["ground_truth"]
    print(f"Model      {report['model_version']}  (trained on {report['trained_on']})")
    print(f"Labels by  {truth['labelled_by']}   human-reviewed {truth['human_reviewed_share']}")
    if truth["human_reviewed_share"] < 1.0:
        print(
            "           NOTE: labels not reviewed by a person are a weaker\n"
            "           ground truth. Review them before citing these figures."
        )
    print(
        f"Rows       {counts['labelled_total']} labelled"
        f"   {counts['scored']} scored"
        f"   {counts['unscorable_mixed_or_neutral']} mixed/neutral"
    )
    print()

    for title, block in [("OVERALL", report["overall"])] + [
        (f"SOURCE: {name}", block) for name, block in report["by_source"].items()
    ]:
        if not block:
            continue
        gate = block["production_gate"]
        print(f"{title}  (n={block['count']})")
        print(f"  accuracy            {block['accuracy']}   ({block['correct']}/{block['count']})")
        for label, stats in block["per_class"].items():
            print(
                f"  {label:<10} support={stats['support']:<3}"
                f" precision={stats['precision']} recall={stats['recall']} f1={stats['f1']}"
            )
        print(
            f"  confidence          mean {block['confidence']['mean']}"
            f"  min {block['confidence']['min']}  max {block['confidence']['max']}"
        )
        print(
            f"  clears 0.60 gate    {gate['reached_gate']}/{block['count']}"
            f"  ({gate['share_usable']})"
            f"   discarded: {gate['below_gate_discarded']}"
        )
        print(f"  accuracy when used  {gate['accuracy_when_used']}")
        print()

    ambiguous = report["unscorable_behaviour"]
    if ambiguous:
        print(f"NOT PREDICTABLE BY THIS MODEL  (n={ambiguous['count']})")
        print(f"  true labels         {ambiguous['labels']}")
        print(f"  model predicted     {ambiguous['predicted_distribution']}")
        print(f"  mean confidence     {ambiguous['mean_confidence']}")
        print(f"  asserted above gate {ambiguous['asserted_above_gate']}")
        print()

    if report["errors"]:
        print(f"MISCLASSIFIED  ({len(report['errors'])})")
        for error in report["errors"]:
            print(
                f"  [{error['source']}] expected {error['expected']}"
                f" got {error['predicted']} @ {error['confidence']}"
            )
            print(f"      {error['text']}")


def read_labelled_rows(path: Path) -> list[dict]:
    if not path.exists():
        raise SystemExit(
            f"{path} does not exist. Run build_validation_set.py first."
        )
    with path.open("r", encoding="utf-8", newline="") as file:
        rows = []
        for row in csv.DictReader(file):
            label = (row.get("label") or "").strip().lower()
            if label not in BINARY_LABELS | UNSCORABLE_LABELS:
                continue
            rows.append(
                {
                    "id": row.get("id"),
                    "source": (row.get("source") or "unknown").strip(),
                    "text": row["text"],
                    "label": label,
                    "labelled_by": (row.get("labelled_by") or "unknown").strip(),
                }
            )
    return rows


def rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 4)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Score the serving sentiment model against hand-labelled workplace text."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


if __name__ == "__main__":
    main()
