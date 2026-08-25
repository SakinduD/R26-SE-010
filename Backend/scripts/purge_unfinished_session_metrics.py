"""Delete analytics rows for multimodal sessions that should never have had any.

Two kinds, both described in mca_session_quality_service:

  unfinished        The session-end hook posted sessions still marked active.
                    They carry no value in any of the four columns the tracked
                    skills are read from, so they never moved a skill score -
                    but they inflate the learner's session count and, where
                    overall_score is 0.0, drag the overall average down.

  nothing measured  A finished session that observed nothing on any channel.
                    Every dimension sits on the neutral 50 that the reliability
                    correction leaves behind, and stored as analytics those
                    fifties become skill-card scores.

The selection is the same predicate the live mapping now uses, so this script
and the running system cannot disagree about which sessions those are.

    python scripts/purge_unfinished_session_metrics.py            # dry run
    python scripts/purge_unfinished_session_metrics.py --apply

A full backup of every row it would touch is written before anything changes.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.db.database import SessionLocal  # noqa: E402
from app.models.session_result import SessionResult  # noqa: E402
from app.services import mca_session_quality_service as quality  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="commit the deletions")
    parser.add_argument(
        "--backup",
        default=str(Path(__file__).with_name("unfinished_session_rows_backup.json")),
        help="where to write the pre-change backup",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        stored = {
            row[0]
            for row in db.execute(
                text("SELECT DISTINCT session_id FROM analytics_session_metrics")
            )
        }
        rejected: list[tuple[str, str, str | None]] = []
        for session in db.query(SessionResult).all():
            reason = quality.rejection_reason(session)
            if reason and str(session.id) in stored:
                rejected.append((str(session.id), reason, session.friendly_id))

        ids = [session_id for session_id, _, _ in rejected]

        backup = {
            "taken_at": datetime.datetime.now().isoformat(),
            "applied": args.apply,
            "sessions": [
                {"session_id": s, "friendly_id": f, "reason": r} for s, r, f in rejected
            ],
            "metrics": [
                dict(row)
                for row in db.execute(
                    text(
                        "SELECT * FROM analytics_session_metrics "
                        "WHERE session_id = ANY(:ids)"
                    ),
                    {"ids": ids},
                ).mappings()
            ]
            if ids
            else [],
        }
        Path(args.backup).write_text(
            json.dumps(backup, indent=1, default=str), encoding="utf-8"
        )
        print(f"backup written to {args.backup}")
        print(f"   sessions: {len(backup['sessions'])}   metric rows: {len(backup['metrics'])}")

        unfinished = sum(1 for _, r, _ in rejected if "not completed" in r)
        print(f"      unfinished       {unfinished}")
        print(f"      nothing measured {len(rejected) - unfinished}")

        print("\nAPPLYING" if args.apply else "\nDRY RUN - nothing will be written")
        for session_id, reason, friendly in rejected:
            print(f"   {friendly or session_id[:13]:26} {reason[:70]}")

        if args.apply and ids:
            db.execute(
                text("DELETE FROM analytics_session_metrics WHERE session_id = ANY(:ids)"),
                {"ids": ids},
            )
            db.commit()
            print(f"\ndeleted {len(backup['metrics'])} metric rows")
        elif not args.apply:
            print("\nRe-run with --apply to commit.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
