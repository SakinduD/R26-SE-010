#!/usr/bin/env python3
"""
Human-agreement check for RPE's live LLM turn scoring (emotion + userBehavior).

Why this exists: RPE's per-turn emotion and userBehavior labels are assigned
by the LLM live, in-session, with nobody ever checking whether those labels
agree with what a human rater would independently assign. That's a real gap
against the research this system is modelled on — e.g. SimPatient (Steenstra
et al. 2025) validated its own LLM scoring agents against human-coded
examples before trusting them. This script is that check for RPE: it can't
do the rating for you (that needs a real, independent human judgement — the
whole point is that it's NOT the same model marking its own homework), but
it handles everything around it: sampling real turns, keeping the LLM's
answers hidden while you rate, and scoring agreement once you're done.

Workflow:
    1. python scripts/rpe_behavior_validation.py export --count 30
       -> writes rpe_rating_sheet.csv (blank your_emotion / your_behavior
          columns for you to fill in) and rpe_answer_key.csv (the LLM's
          actual labels — don't open this until you've rated the sheet).
    2. Open rpe_rating_sheet.csv, read each user_input in context, and fill
       in your_emotion / your_behavior using the label lists printed below.
    3. python scripts/rpe_behavior_validation.py score
       -> joins your ratings against the answer key and reports raw percent
          agreement and Cohen's kappa (chance-corrected agreement) for both
          emotion and userBehavior.

Run from Backend/. No network calls, no API keys needed — reads real turns
straight out of RPE's own JSON session logs (app/models/rpe/logs/sessions/),
which log_turn() writes unconditionally alongside Supabase for every turn.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.rpe_session_service import LOGS_DIR

EMOTION_LABELS = [
    "neutral", "happy", "surprised", "frustrated",
    "sad", "skeptical", "angry", "thinking",
]
BEHAVIOR_LABELS = [
    "assertive_statement", "proposal", "acknowledgment", "de_escalation",
    "clarifying_question", "concession", "deflection", "escalation", "unclear",
]

RATING_SHEET = Path(__file__).resolve().parent / "rpe_rating_sheet.csv"
ANSWER_KEY   = Path(__file__).resolve().parent / "rpe_answer_key.csv"


def _collect_scored_turns() -> list[dict]:
    """
    Every turn, across every session log on disk, that carries both an
    LLM-assigned emotion and userBehavior — i.e. every turn eligible for
    validation.

    Reads the JSON logs directly rather than through RpeSessionService: this
    is an offline analysis over historical data, and log_turn() always writes
    the JSON copy regardless of Supabase (see rpe_session_service.log_turn's
    own "Always write JSON fallback" step), so it's a complete, much faster
    source for this — no per-session network round trip.
    """
    rows: list[dict] = []
    for path in sorted(LOGS_DIR.glob("*.json")):
        try:
            session = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        session_id = path.stem
        prior_npc_line = session.get("opening_npc_line", "")
        for turn in session.get("turns", []):
            if turn.get("emotion") and turn.get("user_behavior"):
                rows.append({
                    "session_id":       session_id,
                    "turn":             turn["turn"],
                    "npc_line_before":  prior_npc_line,
                    "user_input":       turn.get("user_input", ""),
                    "llm_emotion":      turn["emotion"],
                    "llm_behavior":     turn["user_behavior"],
                })
            prior_npc_line = turn.get("npc_response", prior_npc_line)
    return rows


def cmd_export(count: int, seed: int) -> None:
    rows = _collect_scored_turns()
    if not rows:
        print(
            "No scored turns found yet (no session has both emotion and "
            "user_behavior recorded). Play a few sessions first, then re-run."
        )
        return

    random.Random(seed).shuffle(rows)
    sample = rows[:count]

    with RATING_SHEET.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "row_id", "session_id", "turn", "npc_line_before", "user_input",
            "your_emotion", "your_behavior",
        ])
        writer.writeheader()
        for i, row in enumerate(sample):
            writer.writerow({
                "row_id":          i,
                "session_id":      row["session_id"],
                "turn":            row["turn"],
                "npc_line_before": row["npc_line_before"],
                "user_input":      row["user_input"],
                "your_emotion":    "",
                "your_behavior":   "",
            })

    with ANSWER_KEY.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "row_id", "session_id", "turn", "llm_emotion", "llm_behavior",
        ])
        writer.writeheader()
        for i, row in enumerate(sample):
            writer.writerow({
                "row_id":      i,
                "session_id":  row["session_id"],
                "turn":        row["turn"],
                "llm_emotion":  row["llm_emotion"],
                "llm_behavior": row["llm_behavior"],
            })

    print(f"Sampled {len(sample)} turns from {len(rows)} eligible turns across {len(session_ids := {r['session_id'] for r in rows})} sessions.")
    print(f"Wrote {RATING_SHEET.name} — fill in your_emotion / your_behavior for each row.")
    print(f"Wrote {ANSWER_KEY.name} — don't open this until you've rated the sheet.")
    print()
    print("Valid emotion labels:  " + " | ".join(EMOTION_LABELS))
    print("Valid behavior labels: " + " | ".join(BEHAVIOR_LABELS))


def _cohens_kappa(rater_a: list[str], rater_b: list[str], labels: list[str]) -> float:
    """Standard Cohen's kappa: (observed agreement - chance agreement) /
    (1 - chance agreement). 0 = no better than chance, 1 = perfect agreement.
    Implemented directly (no sklearn dependency) — it's a small formula."""
    n = len(rater_a)
    if n == 0:
        return float("nan")

    observed = sum(1 for a, b in zip(rater_a, rater_b) if a == b) / n

    a_counts = {label: rater_a.count(label) for label in labels}
    b_counts = {label: rater_b.count(label) for label in labels}
    chance = sum((a_counts[label] / n) * (b_counts[label] / n) for label in labels)

    if chance >= 1.0:
        return 1.0
    return (observed - chance) / (1 - chance)


def cmd_score() -> None:
    if not RATING_SHEET.exists() or not ANSWER_KEY.exists():
        print("Run `export` first.")
        return

    with RATING_SHEET.open(encoding="utf-8") as f:
        ratings = {row["row_id"]: row for row in csv.DictReader(f)}
    with ANSWER_KEY.open(encoding="utf-8") as f:
        answers = {row["row_id"]: row for row in csv.DictReader(f)}

    unrated = [rid for rid, row in ratings.items() if not row["your_emotion"] or not row["your_behavior"]]
    if unrated:
        print(f"{len(unrated)} of {len(ratings)} rows still have blank your_emotion/your_behavior — rate every row before scoring.")
        return

    human_emotion, llm_emotion   = [], []
    human_behavior, llm_behavior = [], []
    for row_id, rating in ratings.items():
        answer = answers[row_id]
        human_emotion.append(rating["your_emotion"].strip())
        llm_emotion.append(answer["llm_emotion"].strip())
        human_behavior.append(rating["your_behavior"].strip())
        llm_behavior.append(answer["llm_behavior"].strip())

    n = len(ratings)
    emotion_agreement  = sum(1 for h, l in zip(human_emotion, llm_emotion) if h == l) / n
    behavior_agreement = sum(1 for h, l in zip(human_behavior, llm_behavior) if h == l) / n

    print(f"Rows scored: {n}")
    print()
    print("Emotion:")
    print(f"  Raw agreement:  {emotion_agreement:.0%}")
    print(f"  Cohen's kappa:  {_cohens_kappa(human_emotion, llm_emotion, EMOTION_LABELS):.2f}")
    print()
    print("User behavior:")
    print(f"  Raw agreement:  {behavior_agreement:.0%}")
    print(f"  Cohen's kappa:  {_cohens_kappa(human_behavior, llm_behavior, BEHAVIOR_LABELS):.2f}")
    print()
    print("Rule of thumb (Landis & Koch 1977): <0 poor, 0.00-0.20 slight, 0.21-0.40 fair,")
    print("0.41-0.60 moderate, 0.61-0.80 substantial, 0.81-1.00 almost perfect.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    export_parser = sub.add_parser("export", help="Sample real turns and write a blank rating sheet")
    export_parser.add_argument("--count", type=int, default=30, help="How many turns to sample (default: 30)")
    export_parser.add_argument("--seed", type=int, default=42, help="Random seed, for a reproducible sample")

    sub.add_parser("score", help="Score your filled-in rating sheet against the LLM's answers")

    args = parser.parse_args()
    if args.command == "export":
        cmd_export(args.count, args.seed)
    elif args.command == "score":
        cmd_score()


if __name__ == "__main__":
    main()
