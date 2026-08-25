"""Remove what role-play sessions left behind in the analytics tables.

Role-play is a separate module now: nothing in this component reads it, writes
it, or offers it in a session picker. What remains is historical - rows written
back when role-play sessions were integrated - and they still count toward
"All Sessions" scores and trends.

What is here, and why it is in three groups
-------------------------------------------
``metrics``   16 rows in analytics_session_metrics whose session id belongs to
              rpe_sessions and not to session_results. Of the four columns the
              tracked skills are read from, these hold speech_volume 0/16,
              speech_pace 0/16, eye_contact 0/16 and empathy 7/16 - so the only
              skill they can speak to is emotional intelligence, and that value
              came from counting keywords in typed text.

``system``    11 system-generated feedback entries attached to the same
              sessions, two of which carry a plan uuid in skill_area, a column
              that holds a skill name.

``self``      8 self-ratings. These are different in kind: the learner sat down
              and rated themselves after a role-play conversation. That is
              their own input, not something the system fabricated, so it is
              behind its own flag and off by default. The argument for removing
              it is that a self-rating with nothing to compare against produces
              no finding once the metric row is gone; the argument against is
              that it is a person's own answer and deleting it is not ours to
              assume.

Running it
----------
    python scripts/purge_role_play_analytics.py                  # dry run
    python scripts/purge_role_play_analytics.py --apply          # metrics + system
    python scripts/purge_role_play_analytics.py --apply --self-ratings

Every mode writes a full backup of every row it would touch before touching
anything. Re-running after an apply is harmless - the selects match nothing.
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

# A metric row belongs to role-play when the engine owns its session id and the
# multimodal engine does not. Checked both ways rather than by scenario_id or
# by which columns are null, so a multimodal session can never match.
ROLE_PLAY_SESSION_IDS = """
    SELECT m.session_id FROM analytics_session_metrics m
    WHERE EXISTS (SELECT 1 FROM rpe_sessions r WHERE r.session_id = m.session_id)
      AND NOT EXISTS (SELECT 1 FROM session_results s WHERE s.id::text = m.session_id)
"""


def rows(db, sql: str) -> list[dict]:
    return [dict(r) for r in db.execute(text(sql)).mappings()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="commit the deletions")
    parser.add_argument(
        "--self-ratings",
        action="store_true",
        help="also delete the learner's own self-ratings for these sessions",
    )
    parser.add_argument(
        "--backup",
        default=str(Path(__file__).with_name("role_play_rows_backup.json")),
        help="where to write the pre-change backup",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        backup = {
            "taken_at": datetime.datetime.now().isoformat(),
            "applied": args.apply,
            "included_self_ratings": args.self_ratings,
            "metrics": rows(db, f"""
                SELECT * FROM analytics_session_metrics
                WHERE session_id IN ({ROLE_PLAY_SESSION_IDS})
            """),
            "feedback_system": rows(db, f"""
                SELECT * FROM feedback_entries
                WHERE session_id IN ({ROLE_PLAY_SESSION_IDS})
                  AND feedback_type <> 'self'
            """),
            "feedback_self": rows(db, f"""
                SELECT * FROM feedback_entries
                WHERE session_id IN ({ROLE_PLAY_SESSION_IDS})
                  AND feedback_type = 'self'
            """),
        }
        Path(args.backup).write_text(
            json.dumps(backup, indent=1, default=str), encoding="utf-8"
        )
        print(f"backup written to {args.backup}")
        for name in ("metrics", "feedback_system", "feedback_self"):
            print(f"   {name}: {len(backup[name])} rows")

        # Guard: this must never reach a multimodal session.
        stray = db.execute(text(f"""
            SELECT count(*) FROM analytics_session_metrics m
            WHERE m.session_id IN ({ROLE_PLAY_SESSION_IDS})
              AND EXISTS (SELECT 1 FROM session_results s WHERE s.id::text = m.session_id)
        """)).scalar()
        assert stray == 0, f"refusing to run: {stray} multimodal rows matched the selection"
        print("   guard: no multimodal session matched the selection")

        print("\nAPPLYING" if args.apply else "\nDRY RUN - nothing will be written")

        print(f"\n1. delete {len(backup['metrics'])} metric rows")
        if args.apply:
            db.execute(text(f"""
                DELETE FROM analytics_session_metrics
                WHERE session_id IN ({ROLE_PLAY_SESSION_IDS})
            """))
            db.commit()
            print("   deleted")

        print(f"\n2. delete {len(backup['feedback_system'])} system feedback entries")
        if args.apply:
            # The metric rows are gone by now, so the subquery above no longer
            # matches. Delete by the ids captured in the backup instead.
            ids = [r["id"] for r in backup["feedback_system"]]
            if ids:
                db.execute(
                    text("DELETE FROM feedback_entries WHERE id = ANY(:ids)"),
                    {"ids": ids},
                )
                db.commit()
            print("   deleted")

        print(f"\n3. {len(backup['feedback_self'])} self-ratings by the learner")
        if not args.self_ratings:
            print("   kept - pass --self-ratings to remove these too")
        elif args.apply:
            ids = [r["id"] for r in backup["feedback_self"]]
            if ids:
                db.execute(
                    text("DELETE FROM feedback_entries WHERE id = ANY(:ids)"),
                    {"ids": ids},
                )
                db.commit()
            print("   deleted")
        else:
            print("   would be deleted")

        if not args.apply:
            print("\nRe-run with --apply to commit.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
