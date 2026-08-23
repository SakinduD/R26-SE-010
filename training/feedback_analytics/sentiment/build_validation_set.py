"""Assemble the workplace sentiment validation set for hand labelling.

Why this exists
---------------
The serving model is trained on Sentiment140: 2009 tweets, auto-labelled by the
emoticons they contained. The text it is actually asked about is a Gen Z employee
reflecting on a soft-skills practice session. Its reported 78.01% accuracy is
accuracy *on tweets*, and says nothing about how it does here.

Nothing can be improved before it can be measured, so this builds the instrument:
a CSV of workplace-domain sentences with an empty ``label`` column for a human to
fill in. It assigns no labels itself. An evaluation set labelled by a model
measures agreement between models, not correctness.

Two sources, kept apart on purpose
----------------------------------
``learner``  - real reflections written by real users, read out of the database.
               The only rows that are unarguably the target domain, so results
               are always reported for them separately.
``authored`` - sentences written to cover the phrasings the learner set is too
               small to contain: hedging, mixed praise-and-complaint, flat
               description. Disclosed as authored so no reader mistakes them for
               collected data.

Re-running is safe: labels already entered are preserved, and only genuinely new
sentences are appended.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_BACKEND = _ROOT / "Backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

DEFAULT_OUTPUT = (
    _ROOT
    / "training"
    / "feedback_analytics"
    / "datasets"
    / "validation"
    / "workplace_sentiment_validation.csv"
)

FIELDNAMES = ["id", "source", "text", "label", "labelled_by", "notes"]

# Written to cover phrasings the six real reflections cannot: hedged approval,
# praise followed by a complaint, plain description with no evaluation in it.
# Deliberately unlabelled - see the module docstring.
AUTHORED_SENTENCES = [
    # clear positive
    "I felt confident throughout and kept eye contact the whole way through.",
    "My voice was steady and I did not rush a single answer.",
    "This was the best session so far, I finally stopped filling silences with um.",
    "I listened properly before replying and it made the conversation easier.",
    "I am proud of how I handled the difficult question at the end.",
    "I stayed calm even when the scenario got uncomfortable.",
    "Speaking clearly is getting easier and I noticed it today.",
    "I enjoyed this session and I want to do another one soon.",
    # clear negative
    "I rushed everything and my answers made no sense.",
    "I could not keep eye contact at all and it showed.",
    "I froze completely when they pushed back on my point.",
    "My voice was shaking the entire time and I hated it.",
    "This session was frustrating and I felt worse afterwards.",
    "I keep making the same mistake and nothing is improving.",
    "I was unprepared and it was obvious from the first minute.",
    "I lost my train of thought repeatedly and could not recover.",
    # hedged positive
    "I think I did okay but I am not really sure.",
    "It was probably fine, nothing went badly wrong.",
    "I guess I performed reasonably well today.",
    "Maybe a little better than last time, hard to tell.",
    "Not my worst session, I suppose.",
    # hedged negative
    "I do not think that went particularly well.",
    "It could have been a lot better if I am honest.",
    "I am not happy with how I came across.",
    "Something felt off but I cannot say exactly what.",
    # mixed - the shape the real reflections actually take
    "I spoke clearly but I ran out of time before finishing.",
    "I perform well but I did not have enough time to engage properly.",
    "My content was good although my body language was closed.",
    "I answered confidently, however I interrupted them twice.",
    "The session was useful but I was too tired to focus.",
    "I liked the scenario but my delivery was weak.",
    "Good eye contact, poor pacing.",
    "I improved on volume but my filler words got worse.",
    # flat description, no evaluation in it at all
    "I completed the session and answered all the questions.",
    "The scenario was about handling a late delivery.",
    "It lasted about ten minutes.",
    "I used the practice plan that was assigned to me.",
]


def main() -> None:
    args = parse_args()
    existing = read_existing(args.output)
    rows = list(existing.values())
    seen = set(existing)

    added_learner = 0
    for text in learner_comments(limit=args.learner_limit):
        key = normalise(text)
        if key in seen:
            continue
        rows.append({"id": "", "source": "learner", "text": text, "label": "", "labelled_by": "", "notes": ""})
        seen.add(key)
        added_learner += 1

    added_authored = 0
    if not args.learner_only:
        for text in AUTHORED_SENTENCES:
            key = normalise(text)
            if key in seen:
                continue
            rows.append({"id": "", "source": "authored", "text": text, "label": "", "labelled_by": "", "notes": ""})
            seen.add(key)
            added_authored += 1

    for index, row in enumerate(rows, start=1):
        row["id"] = index

    write_rows(args.output, rows)

    labelled = sum(1 for row in rows if (row.get("label") or "").strip())
    learner_total = sum(1 for row in rows if row["source"] == "learner")
    print(f"Validation set: {args.output}")
    print(
        f"  rows total       {len(rows)}"
        f"  ({learner_total} learner, {len(rows) - learner_total} authored)"
    )
    print(f"  newly added      {added_learner} learner, {added_authored} authored")
    print(f"  already labelled {labelled}   awaiting a label {len(rows) - labelled}")
    print()
    print("Open the CSV and fill the `label` column with one of:")
    print("  positive | negative | mixed | neutral")
    print("Leave a row blank to exclude it. `mixed` and `neutral` are scored")
    print("separately - the model has only two classes and cannot express them.")


def learner_comments(limit: int | None = None) -> list[str]:
    """Real, human-written reflections from the database.

    Only ``self`` entries: everything else in that table is generated by this
    codebase from templates, so scoring a model on it would measure the model
    against our own wording rather than against a learner's.
    """
    try:
        # The application resolves its settings from a .env beside its own code.
        # This script runs from the repo root, so that file has to be named
        # explicitly rather than found by relative path.
        from dotenv import load_dotenv

        load_dotenv(_BACKEND / ".env")

        from sqlalchemy import text as sql

        from app.db.database import engine
    except Exception as exc:  # pragma: no cover - developer convenience
        print(f"  (skipping database: {exc})")
        return []

    query = (
        "SELECT DISTINCT trim(comment) FROM feedback_entries "
        "WHERE feedback_type = 'self' AND comment IS NOT NULL "
        "AND length(trim(comment)) >= 4 ORDER BY 1"
    )
    try:
        with engine.connect() as connection:
            rows = [row[0] for row in connection.execute(sql(query))]
    except Exception as exc:  # pragma: no cover - developer convenience
        print(f"  (could not read learner comments: {exc})")
        return []
    return rows[:limit] if limit else rows


def read_existing(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8", newline="") as file:
        return {normalise(row["text"]): row for row in csv.DictReader(file)}


def write_rows(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows({key: row.get(key, "") for key in FIELDNAMES} for row in rows)


def normalise(text: str) -> str:
    return " ".join((text or "").lower().split())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Assemble the workplace sentiment validation set for hand labelling."
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--learner-limit", type=int, default=None)
    parser.add_argument(
        "--learner-only",
        action="store_true",
        help="Collect only real reflections, adding none of the authored sentences.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
