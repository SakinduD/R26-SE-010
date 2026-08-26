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

``predict``   SkillPrediction rows about skills this component does not track.
              The APM analytics writer turns a training plan into predictions -
              one row per target skill of the primary scenario, plan difficulty
              as a proxy score (20 + (difficulty-1) * 60/9), and no session id
              at all. The skills it names are role-play's: trust_building,
              assertiveness, political_awareness. This component tracks four,
              and none of them is on that list. They are stamped model_version
              "rule-based-v1" - this component's own trend-projection version
              string - so read back they cannot be told apart from something
              this component predicted.

              Selected by skill, not by wording: a recommendation string can be
              reworded, but a prediction about a skill that does not exist here
              is not this component's under any wording.

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

# A session belongs to role-play when its engine owns the id and the multimodal
# engine does not. Checked both ways rather than by scenario_id or by which
# columns are null, so a multimodal session can never match.
#
# Read from rpe_sessions rather than from analytics_session_metrics, which is
# where it used to start. Keying the selection off this component's own metric
# rows meant that once those were deleted the feedback and predictions attached
# to the same sessions became unreachable: a first pass removed the metrics, a
# second pass reported nothing left, and eight role-play self-ratings stayed in
# the table looking clean. The set of role-play sessions is a fact about their
# engine, not about what this component happens to still be holding.
ROLE_PLAY_SESSION_IDS = """
    SELECT r.session_id FROM rpe_sessions r
    WHERE NOT EXISTS (SELECT 1 FROM session_results s WHERE s.id::text = r.session_id)
"""


# The four this component reports on. Written out rather than imported so the
# script states its own selection: what it deletes has to be readable here.
TRACKED_SKILLS = (
    "vocal_command",
    "speech_fluency",
    "presence_engagement",
    "emotional_intelligence",
)


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
            "predictions": [
                dict(r)
                for r in db.execute(
                    text(
                        "SELECT * FROM skill_predictions "
                        "WHERE predicted_skill <> ALL(:tracked)"
                    ),
                    {"tracked": list(TRACKED_SKILLS)},
                ).mappings()
            ],
        }
        Path(args.backup).write_text(
            json.dumps(backup, indent=1, default=str), encoding="utf-8"
        )
        print(f"backup written to {args.backup}")
        for name in ("metrics", "feedback_system", "feedback_self", "predictions"):
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

        print(f"\n4. delete {len(backup['predictions'])} predictions about untracked skills")
        for row in backup["predictions"]:
            print(f"   {row['predicted_skill']:<22} score {row['predicted_score']}  {row['model_version']}")
        if args.apply:
            ids = [r["id"] for r in backup["predictions"]]
            if ids:
                db.execute(
                    text("DELETE FROM skill_predictions WHERE id = ANY(:ids)"),
                    {"ids": ids},
                )
                db.commit()
            print("   deleted")

        if not args.apply:
            print("\nRe-run with --apply to commit.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
