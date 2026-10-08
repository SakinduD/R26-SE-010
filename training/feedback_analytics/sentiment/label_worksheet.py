"""Turn the validation CSV into a plain-text worksheet, and read it back.

Labelling by editing the CSV directly means typing into the fourth comma-separated
field of a line whose third field is itself quoted and contains commas. One
misplaced character silently corrupts a row, and the mistake is invisible until
the scorer reads a label that is not there.

The worksheet avoids that entirely: one line per sentence, a fixed slot to type a
single letter into, and nothing else that can be broken. ``--apply`` reads the
letters back and writes them into the CSV, which stays the source of truth.

    python -m training.feedback_analytics.sentiment.label_worksheet            # export
    python -m training.feedback_analytics.sentiment.label_worksheet --apply    # read back
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]

DEFAULT_CSV = (
    _ROOT
    / "training"
    / "feedback_analytics"
    / "datasets"
    / "validation"
    / "workplace_sentiment_validation.csv"
)
DEFAULT_WORKSHEET = DEFAULT_CSV.with_name("workplace_sentiment_labels.txt")

FIELDNAMES = ["id", "source", "text", "label", "labelled_by", "notes"]

SHORTCUTS = {
    "p": "positive",
    "n": "negative",
    "m": "mixed",
    "x": "neutral",
}
LONG_FORMS = {value: value for value in SHORTCUTS.values()}
BLANK_SLOT = "__"

HEADER = """# WORKPLACE SENTIMENT LABELLING WORKSHEET
#
# Replace each __ with ONE letter:
#
#   p  positive   says something good, and only that
#   n  negative   says something bad, and only that
#   m  mixed      two judgements at once - "good BUT bad"
#   x  neutral    describes what happened, judges nothing
#
# Hedging is not mixing. "I think I did okay but I am not sure" hedges how
# confident the writer is, not whether the session went well - that is p.
# Use m only when there are genuinely two opposite judgements.
#
# Leave __ untouched to skip a sentence; it will simply not be scored.
# Lines starting with # are ignored. Save the file, then run:
#
#   python -m training.feedback_analytics.sentiment.label_worksheet --apply
#
# ---------------------------------------------------------------------------
"""


def main() -> None:
    args = parse_args()
    if args.apply:
        apply_worksheet(args.csv, args.worksheet)
    else:
        export_worksheet(args.csv, args.worksheet)


def export_worksheet(csv_path: Path, worksheet_path: Path) -> None:
    rows = read_csv(csv_path)
    if not rows:
        raise SystemExit(f"{csv_path} has no rows. Run build_validation_set.py first.")

    lines = [HEADER]
    for source in ("learner", "authored"):
        group = [row for row in rows if row["source"] == source]
        if not group:
            continue
        lines.append(f"\n# ===== {source.upper()} ({len(group)}) =====\n")
        if source == "learner":
            lines.append("# Written by real users. These are the rows that matter most.\n")
        else:
            lines.append("# Written to cover phrasings the real set is too small to contain.\n")
        lines.append("\n")
        for row in group:
            existing = (row.get("label") or "").strip().lower()
            slot = next(
                (key for key, value in SHORTCUTS.items() if value == existing),
                BLANK_SLOT,
            )
            slot = slot if slot != BLANK_SLOT else BLANK_SLOT
            lines.append(f"{row['id']:>3}  [{slot:<2}]  {row['text']}\n")

    worksheet_path.parent.mkdir(parents=True, exist_ok=True)
    worksheet_path.write_text("".join(lines), encoding="utf-8")

    already = sum(1 for row in rows if (row.get("label") or "").strip())
    print(f"Worksheet: {worksheet_path}")
    print(f"  {len(rows)} sentences   {already} already labelled")
    print()
    print("Open it, replace each __ with p / n / m / x, save, then run:")
    print("  python -m training.feedback_analytics.sentiment.label_worksheet --apply")


def apply_worksheet(csv_path: Path, worksheet_path: Path) -> None:
    if not worksheet_path.exists():
        raise SystemExit(f"{worksheet_path} does not exist. Export it first.")

    labels, problems = parse_worksheet(worksheet_path)
    if problems:
        print("Could not read these lines:")
        for line_number, line, reason in problems:
            print(f"  line {line_number}: {reason}")
            print(f"    {line.strip()}")
        raise SystemExit("Nothing was written. Fix the lines above and run again.")

    rows = read_csv(csv_path)
    known_ids = {row["id"] for row in rows}
    unknown = sorted(set(labels) - known_ids, key=str)
    if unknown:
        raise SystemExit(
            f"Worksheet refers to ids not in the CSV: {', '.join(unknown)}.\n"
            "Re-export the worksheet after rebuilding the validation set."
        )

    changed = 0
    cleared = 0
    for row in rows:
        new_label = labels.get(row["id"])
        old_label = (row.get("label") or "").strip().lower()
        if new_label is None:
            # Slot left blank. An existing label is kept: blanking the worksheet
            # is how a sentence is skipped, not how a decision is withdrawn.
            continue
        if new_label != old_label or row.get("labelled_by") != "human":
            row["label"] = new_label
            # Typing a label into the worksheet is a person deciding. Recording
            # who decided is what lets the evaluation say whether its ground
            # truth was reviewed by a human or merely inherited.
            row["labelled_by"] = "human"
            changed += 1

    write_csv(csv_path, rows)

    counts: dict[str, int] = {}
    for row in rows:
        label = (row.get("label") or "").strip().lower()
        if label:
            counts[label] = counts.get(label, 0) + 1
    total_labelled = sum(counts.values())

    print(f"Wrote {csv_path}")
    print(f"  {changed} labels changed   {cleared} cleared")
    print(f"  {total_labelled}/{len(rows)} rows now labelled")
    for label in sorted(counts):
        print(f"    {label:<9} {counts[label]}")
    remaining = len(rows) - total_labelled
    print()
    if remaining:
        print(f"{remaining} still unlabelled. They will not be scored.")
    print("Measure the model with:")
    print("  python -m training.feedback_analytics.sentiment.evaluate_workplace")


def parse_worksheet(path: Path) -> tuple[dict[str, str], list[tuple[int, str, str]]]:
    pattern = re.compile(r"^\s*(\d+)\s*\[\s*([^\]]*?)\s*\]")
    labels: dict[str, str] = {}
    problems: list[tuple[int, str, str]] = []

    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = pattern.match(line)
        if not match:
            problems.append((line_number, line, "no `NN [x]` marker found"))
            continue

        row_id, raw = match.group(1), match.group(2).strip().lower()
        if not raw or raw == BLANK_SLOT or set(raw) == {"_"}:
            continue
        label = SHORTCUTS.get(raw) or LONG_FORMS.get(raw)
        if label is None:
            problems.append(
                (line_number, line, f"{raw!r} is not one of p / n / m / x")
            )
            continue
        labels[row_id] = label

    return labels, problems


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        raise SystemExit(f"{path} does not exist. Run build_validation_set.py first.")
    with path.open("r", encoding="utf-8", newline="") as file:
        return [dict(row) for row in csv.DictReader(file)]


def write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows({key: row.get(key, "") for key in FIELDNAMES} for row in rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export the validation set as a text worksheet, or read labels back."
    )
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--worksheet", type=Path, default=DEFAULT_WORKSHEET)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Read labels out of the worksheet and write them into the CSV.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
