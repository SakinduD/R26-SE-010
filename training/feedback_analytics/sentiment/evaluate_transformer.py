"""Score a pretrained transformer on the same workplace validation set.

Why a transformer at all
------------------------
The classical models fail on one specific thing, and the training data explains
why. Of the workplace examples labelled positive, 3.1% contain a negation word;
of those labelled negative, 33.9% do. A bag-of-words model therefore learns that
"not", "no" and "never" mean complaint, and reads

    "My voice was steady and I did not rush a single answer"

as negative. No amount of additional data fixes this, because TF-IDF has no
mechanism for one word to change the meaning of the next - it counts them
independently. Handling negation requires a model that reads words in context.

Nothing is trained here. A published model is downloaded and asked the same
questions, scored by the same code, against the same hand-labelled file. That
keeps the comparison honest: any difference in the numbers is a difference in the
model, not in how it was measured.

The candidate is a three-class model, so its `neutral` needs mapping onto the
label scheme used here. See NEUTRAL_MAPS_TO.
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

from training.feedback_analytics.sentiment.evaluate_workplace import (  # noqa: E402
    PRODUCTION_CONFIDENCE_GATE,
    read_labelled_rows,
    rounded,
    score,
    unscorable_behaviour,
)

DEFAULT_MODEL = "cardiffnlp/twitter-roberta-base-sentiment-latest"
DEFAULT_INPUT = (
    _ROOT
    / "training"
    / "feedback_analytics"
    / "datasets"
    / "validation"
    / "workplace_sentiment_validation.csv"
)
DEFAULT_OUTPUT = (
    _ROOT
    / "training"
    / "feedback_analytics"
    / "evaluation"
    / "sentiment_workplace_evaluation_transformer.json"
)

# The candidate predicts negative / neutral / positive. This project's scheme has
# no `neutral`; it has `mixed`, which is a different thing - text carrying two
# opposite judgements rather than none. They are mapped together anyway, because
# both mean "do not treat this as leaning one way", which is the decision the
# application actually makes with the answer. The mapping is recorded in the
# report so nobody reads the mixed score as evidence the model understands
# mixedness. It does not; it understands "not clearly either".
NEUTRAL_MAPS_TO = "mixed"

# Normalises the various label vocabularies published models use.
LABEL_ALIASES = {
    "label_0": "negative",
    "label_1": "neutral",
    "label_2": "positive",
    "neg": "negative",
    "neu": "neutral",
    "pos": "positive",
    "negative": "negative",
    "neutral": "neutral",
    "positive": "positive",
}


def main() -> None:
    args = parse_args()
    rows = read_labelled_rows(args.input)
    if not rows:
        raise SystemExit(f"No labelled rows in {args.input}.")

    predict, model_labels = build_predictor(args.model)
    for row in rows:
        label, confidence = predict(row["text"])
        row["predicted"] = label
        row["confidence"] = confidence

    predictable = {NEUTRAL_MAPS_TO if name == "neutral" else name for name in model_labels}
    scorable = [row for row in rows if row["label"] in predictable]
    unscorable = [row for row in rows if row["label"] not in predictable]

    report = {
        "evaluated_at": datetime.now(UTC).isoformat(),
        "validation_set": str(args.input),
        "model_path": args.model,
        "model_version": args.model,
        "trained_on": "pretrained, not fine-tuned on this project's data",
        "confidence_gate": PRODUCTION_CONFIDENCE_GATE,
        "label_mapping": {
            "model_labels": sorted(model_labels),
            "neutral_scored_as": NEUTRAL_MAPS_TO,
            "caveat": (
                "This model has no `mixed` class. Its `neutral` is mapped to "
                "`mixed` because both mean the text should not be treated as "
                "leaning one way - not because the model detects two opposing "
                "judgements."
            ),
        },
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


def build_predictor(model_name: str):
    """Returns (predict, model_labels). Downloads the model on first use."""
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    print(f"Loading {model_name} ...")
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name)
    model.eval()

    id_to_label = {
        index: LABEL_ALIASES.get(str(name).lower(), str(name).lower())
        for index, name in model.config.id2label.items()
    }
    print(f"  labels: {sorted(id_to_label.values())}")

    def predict(text: str) -> tuple[str, float]:
        encoded = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
        with torch.no_grad():
            logits = model(**encoded).logits[0]
        probabilities = torch.softmax(logits, dim=-1)
        best = int(probabilities.argmax())
        label = id_to_label[best]
        if label == "neutral":
            label = NEUTRAL_MAPS_TO
        return label, round(float(probabilities[best]), 4)

    return predict, set(id_to_label.values())


def print_report(report: dict) -> None:
    counts = report["row_counts"]
    mapping = report["label_mapping"]
    print()
    print(f"Model      {report['model_version']}")
    print(f"           {report['trained_on']}")
    print(f"Labels     {mapping['model_labels']}  (neutral scored as {mapping['neutral_scored_as']})")
    print(
        f"Rows       {counts['labelled_total']} labelled"
        f"   {counts['scored']} scored"
        f"   {counts['unscorable_mixed_or_neutral']} not predictable"
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
            f"  ({gate['share_usable']})   discarded: {gate['below_gate_discarded']}"
        )
        print(f"  accuracy when used  {gate['accuracy_when_used']}")
        print()

    if report["errors"]:
        print(f"MISCLASSIFIED  ({len(report['errors'])})")
        for error in sorted(report["errors"], key=lambda item: -item["confidence"]):
            print(
                f"  [{error['source'][:4]}] {error['expected']:<8} -> "
                f"{error['predicted']:<8} @{error['confidence']:.3f}  {error['text'][:58]}"
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Score a pretrained transformer on the workplace validation set."
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


if __name__ == "__main__":
    main()
