"""Turn Glassdoor employee reviews into labelled workplace sentiment text.

Why this dataset
----------------
The serving model is trained on Sentiment140 - 2009 tweets, auto-labelled by the
emoticons they contained. Measured against hand-labelled workplace reflections it
scores 71.43%, and worse, it reads "negative" correctly only 9 times in 21. The
words a learner uses to describe their own performance ("I did not rush a single
answer") are built from vocabulary this model learned as complaint.

Glassdoor reviews are employees writing about work. The register is right, and
the structure supplies labels for free: a review has a `pros` field, a `cons`
field, and a 1-5 `overall_rating`.

Three findings shaped how the fields are used, each from looking rather than
assuming:

1. **Three stars is not neutral, it is mixed.** "Great Company, Shocking Salary".
   "Good place to start but limited career prospects & low pay". That is the same
   shape as every real learner reflection collected so far - all six contain a
   "but". No public sentiment dataset ships a `mixed` class; this one has roughly
   27,000 of them hiding under a rating.

2. **`cons` on a happy review is not negative.** On five-star reviews, 17,161
   rows (7.4%) hold text like "I am unable to find any Cons. This is a great
   company". Labelling those negative would teach the model that "unable", "not"
   and "any" signal complaint - which is precisely the defect it already has.
   Taking negatives only from one and two star reviews removes them.

3. **Most three-star headlines are job titles.** "Office administrator".
   "Pension admin". Requiring a contrast marker or a comma-joined pair keeps the
   genuinely mixed ones and drops the rest.

The mapping that results:

    positive  <- pros from 4-5 star reviews
    negative  <- cons from 1-2 star reviews
    mixed     <- 3 star headlines carrying a contrast

Reviews in the middle are not mined for polarity, and reviews at the extremes are
not mined for mixedness. Each label is taken only from where the rating agrees
with it.

One more thing had to be equalised: length
------------------------------------------
Taken whole, the three classes are wildly different sizes - 8.5 words for a
headline, 17.9 for a pros paragraph, 54.5 for a cons paragraph. A classifier
handed that learns length, not sentiment: short text is mixed, long text is
negative. The first model trained this way scored `mixed` recall 1.00 on the
workplace validation set, which looked like success and was not - every one of
those sentences is about ten words long, so all of them were being pushed toward
mixed and the true mixed ones were caught by accident.

Keeping only the first sentence of pros and cons brings the classes to 8.3, 8.5
and 11.7 words. It also matches the target: a learner reflection is one sentence
passing judgement on a session, which is exactly what a review headline or an
opening line is.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_BACKEND = _ROOT / "Backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from research.nlp_sentiment.sentiment_baseline import clean_feedback_text  # noqa: E402

DEFAULT_DATASET = (
    _ROOT / "training" / "feedback_analytics" / "datasets" / "raw" / "glassdoor_reviews.csv"
)

# Long free-text fields; the stdlib default field limit is not enough.
csv.field_size_limit(10_000_000)

POSITIVE_RATINGS = {"4", "5"}
NEGATIVE_RATINGS = {"1", "2"}
MIXED_RATINGS = {"3"}

# Text shorter than this carries no usable signal ("None", "N/A", "-").
MIN_TEXT_LENGTH = 12

# Sentence boundary, plus the semicolons and newlines reviewers use as one.
SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+|\s*[;\n]\s*")

# Two judgements joined together: an explicit contrast word, or a comma pairing
# two evaluations ("Great Company, Shocking Salary").
CONTRAST_PATTERN = re.compile(
    r"\b(but|however|although|though|yet|despite|whilst|while)\b", re.IGNORECASE
)

# Text in the `cons` column that denies there are any. See finding 2.
NO_COMPLAINT_PATTERN = re.compile(
    r"\b(no|none|not any|nothing|n/?a|cannot|can'?t|unable|nil|zero)\b"
    r".{0,30}\b(cons?|downsides?|negatives?|complaints?|issues?|problems?)\b"
    r"|^\s*(none|n/?a|nothing|nil|-|\.)\s*$",
    re.IGNORECASE,
)


@dataclass
class GlassdoorDataset:
    texts: list[str]
    labels: list[str]
    summary: dict = field(default_factory=dict)

    @property
    def label_distribution(self) -> dict[str, int]:
        return dict(Counter(self.labels))

    @property
    def preprocessing_summary(self) -> dict:
        """Named to match SentimentDataset, so either can be trained by the same code."""
        return self.summary


def load_glassdoor_reviews(
    dataset_path: str | Path = DEFAULT_DATASET,
    limit_per_class: int | None = None,
    min_text_length: int = MIN_TEXT_LENGTH,
    remove_duplicates: bool = True,
    first_sentence_only: bool = True,
) -> GlassdoorDataset:
    path = Path(dataset_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found: {path}. Download the Glassdoor reviews CSV to this path."
        )

    texts: list[str] = []
    labels: list[str] = []
    counts: Counter[str] = Counter()
    seen: set[str] = set()
    stats = Counter()

    with path.open("r", encoding="utf-8", newline="", errors="replace") as file:
        for row in csv.DictReader(file):
            stats["rows_scanned"] += 1
            rating = (row.get("overall_rating") or "").strip()
            if not rating:
                stats["skipped_no_rating"] += 1
                continue

            for raw_text, label in _candidates(row, rating, first_sentence_only):
                if limit_per_class is not None and counts[label] >= limit_per_class:
                    stats[f"skipped_over_limit_{label}"] += 1
                    continue

                cleaned = clean_feedback_text(raw_text)
                if len(cleaned) < min_text_length:
                    stats["skipped_too_short"] += 1
                    continue
                if remove_duplicates and cleaned in seen:
                    stats["skipped_duplicate"] += 1
                    continue

                texts.append(cleaned)
                labels.append(label)
                counts[label] += 1
                seen.add(cleaned)

            if limit_per_class is not None and _all_classes_full(counts, limit_per_class):
                break

    if len(set(labels)) < 2:
        raise ValueError("At least two classes are required; check the dataset columns.")

    summary = {
        **dict(stats),
        "rows_used": len(texts),
        "label_distribution": dict(counts),
        "min_text_length": min_text_length,
        "remove_duplicates": remove_duplicates,
        "limit_per_class": limit_per_class,
        "first_sentence_only": first_sentence_only,
        "label_sources": {
            "positive": "pros field, 4-5 star reviews",
            "negative": "cons field, 1-2 star reviews",
            "mixed": "headline with a contrast marker, 3 star reviews",
        },
    }
    return GlassdoorDataset(texts=texts, labels=labels, summary=summary)


def _first_sentence(text: str) -> str:
    parts = [part.strip() for part in SENTENCE_BOUNDARY.split(text) if part.strip()]
    return parts[0] if parts else ""


def _candidates(
    row: dict, rating: str, first_sentence_only: bool = True
) -> list[tuple[str, str]]:
    """Every (text, label) this review legitimately supports.

    A review contributes to at most one class. Mining a five-star review for a
    complaint, or a one-star review for praise, is what produces the label noise
    this loader exists to avoid.
    """
    if rating in POSITIVE_RATINGS:
        pros = (row.get("pros") or "").strip()
        if first_sentence_only:
            pros = _first_sentence(pros)
        return [(pros, "positive")] if pros else []

    if rating in NEGATIVE_RATINGS:
        cons = (row.get("cons") or "").strip()
        if not cons or NO_COMPLAINT_PATTERN.search(cons[:80]):
            return []
        if first_sentence_only:
            cons = _first_sentence(cons)
        return [(cons, "negative")] if cons else []

    if rating in MIXED_RATINGS:
        headline = (row.get("headline") or "").strip()
        if headline and _is_contrastive(headline):
            return [(headline, "mixed")]
        return []

    return []


def _is_contrastive(headline: str) -> bool:
    if CONTRAST_PATTERN.search(headline):
        return True
    # "Great Company, Shocking Salary" - a comma joining two verdicts. Short
    # comma-separated fragments are usually job titles, so require some length.
    return "," in headline and len(headline.split()) >= 4


def _all_classes_full(counts: Counter[str], limit_per_class: int) -> bool:
    expected = {"positive", "negative", "mixed"}
    return all(counts[label] >= limit_per_class for label in expected)


def main() -> None:
    args = parse_args()
    dataset = load_glassdoor_reviews(
        args.dataset,
        limit_per_class=args.limit_per_class,
        min_text_length=args.min_text_length,
        remove_duplicates=not args.keep_duplicates,
        first_sentence_only=not args.whole_field,
    )

    summary = dataset.summary
    print(f"Loaded {len(dataset.texts):,} labelled texts from {args.dataset.name}")
    print()
    print("  label distribution")
    for label, count in sorted(summary["label_distribution"].items()):
        print(f"    {label:<9} {count:>8,}   ({summary['label_sources'][label]})")
    print()
    print("  rows scanned            ", f"{summary.get('rows_scanned', 0):>8,}")
    for key in sorted(k for k in summary if k.startswith("skipped_")):
        print(f"  {key:<24}", f"{summary[key]:>8,}")
    print()
    print("  samples")
    seen_labels: set[str] = set()
    for text, label in zip(dataset.texts, dataset.labels):
        if label in seen_labels:
            continue
        seen_labels.add(label)
        print(f"    [{label}] {text[:70]}")
        if len(seen_labels) == 3:
            break

    if args.output_processed:
        args.output_processed.parent.mkdir(parents=True, exist_ok=True)
        with args.output_processed.open("w", encoding="utf-8", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["label", "cleaned_text"])
            writer.writerows(zip(dataset.labels, dataset.texts))
        print()
        print(f"  written: {args.output_processed}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect the Glassdoor workplace sentiment dataset."
    )
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument(
        "--limit-per-class",
        type=int,
        default=None,
        help="Balanced cap per class. Recommended - the raw classes are very uneven.",
    )
    parser.add_argument("--min-text-length", type=int, default=MIN_TEXT_LENGTH)
    parser.add_argument("--keep-duplicates", action="store_true")
    parser.add_argument(
        "--whole-field",
        action="store_true",
        help="Use the entire pros/cons text instead of its first sentence. Leaves "
             "the classes at very different lengths; see the module docstring.",
    )
    parser.add_argument(
        "--output-processed",
        type=Path,
        default=None,
        help="Optional path to write the cleaned, labelled dataset as CSV.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
