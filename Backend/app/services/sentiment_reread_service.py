"""Re-read stored feedback comments with the current sentiment model.

Why this is needed
------------------
A sentiment reading is written once, when the entry is created, and then never
looked at again. So the readings in the database are whatever model was serving
on the day each comment was written. Swapping the model changes what new entries
say and leaves every older one frozen on the previous model's answer.

That is not a cosmetic inconsistency. The blind-spot detector reads the stored
value, so a learner's history keeps producing the old model's conclusions - and
in this case the old readings were wrong in a specific way: reflections carrying
two feelings at once were resolved to 'negative' at around 0.55 confidence, just
under the gate, so they contributed nothing at all. The current model reads the
same sentences as 'mixed' at 0.96 or better.

Only entries the model actually judged are touched. Rule-derived labels on
system-generated feedback are their producer's, not a model's, and re-reading
them would replace a known-correct label with a guess about our own wording.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.analytics import FeedbackEntry
from app.services import sentiment_analysis_service

logger = logging.getLogger(__name__)

REREAD_VERSION = "sentiment-reread-v1"


@dataclass(frozen=True)
class RereadItem:
    entry_id: int
    comment_excerpt: str
    before: str | None
    before_confidence: float | None
    after: str | None
    after_confidence: float | None

    @property
    def changed(self) -> bool:
        return self.before != self.after


@dataclass(frozen=True)
class RereadResult:
    examined_count: int
    updated_count: int
    changed_count: int
    failed_count: int
    model_version: str | None
    items: list[RereadItem]
    reread_version: str = REREAD_VERSION


def reread_user_sentiment(
    db: Session,
    user_id: str | None = None,
    dry_run: bool = False,
) -> RereadResult:
    """Re-read every model-judged comment, for one learner or for all of them.

    ``dry_run`` reports what would change without writing, so the effect on a
    learner's history can be seen before it is applied.
    """
    query = db.query(FeedbackEntry).filter(
        FeedbackEntry.sentiment_source == "model",
        FeedbackEntry.comment.isnot(None),
    )
    if user_id:
        query = query.filter(FeedbackEntry.user_id == user_id)

    entries = query.order_by(FeedbackEntry.id.asc()).all()
    items: list[RereadItem] = []
    failed = 0
    model_version: str | None = None

    for entry in entries:
        comment = (entry.comment or "").strip()
        if not comment:
            continue

        try:
            reading = sentiment_analysis_service.analyze_feedback_text(comment)
        except Exception:
            # One unreadable comment must not stop the rest being brought current.
            logger.exception("Could not re-read feedback entry %s", entry.id)
            failed += 1
            continue

        model_version = reading.model_version
        items.append(
            RereadItem(
                entry_id=entry.id,
                comment_excerpt=comment[:80],
                before=entry.sentiment,
                before_confidence=entry.sentiment_confidence,
                after=reading.sentiment,
                after_confidence=reading.confidence,
            )
        )

        if not dry_run:
            entry.sentiment = reading.sentiment
            entry.sentiment_confidence = reading.confidence
            entry.sentiment_model_version = reading.model_version

    if not dry_run and items:
        db.commit()

    return RereadResult(
        examined_count=len(entries),
        updated_count=0 if dry_run else len(items),
        changed_count=sum(1 for item in items if item.changed),
        failed_count=failed,
        model_version=model_version,
        items=items,
    )
