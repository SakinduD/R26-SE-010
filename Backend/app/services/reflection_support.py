"""A way out of this product, for reflections that are about more than a session.

This system coaches presentation skill. When a learner writes about stress,
burnout, health or their personal life, the mentoring prompt already forbids the
model from answering it - correctly, because answering it is counselling, which
this platform does not do and is not qualified to do. But saying nothing at all
leaves the learner with a page of practice advice over words that were not about
practice.

So: no advice, and no silence either. A fixed list of people whose job this is.

Two things follow from "fixed":

  * It is not written by the model. A safety message has to be the same every
    time and reviewable before it ships, and text that does not exist yet cannot
    be reviewed. It also has to survive the model being unavailable - a safe path
    that only appears when OpenAI answers is not a safe path.

  * It is not the sentiment model either. That model sorts text into
    positive/negative/mixed, trained on tweets and job reviews; distress is not
    something it was built or measured for, and "this session was frustrating"
    reads negative to it. What follows is a plain phrase list - crude, but
    readable, reviewable, and wrong in ways a person can see and correct.

Nothing here is stored. The caller attaches the result to a response; it is not a
recommendation and is never written to the recommendations table, because a
learner's distress is not a record this product should be keeping.
"""
from __future__ import annotations

import re

from app.schemas.analytics import SupportContact, SupportPath


# Said outright, these need no corroborating word.
_URGENT_PHRASES = (
    "kill myself", "killing myself", "end my life", "ending my life",
    "want to die", "wish i was dead", "better off dead", "no reason to live",
    "suicide", "suicidal", "self harm", "self-harm", "harm myself", "hurt myself",
)

# Distress that is unambiguous on its own.
#
# Ordinary practice nerves are deliberately absent. "Nervous", and "anxious about
# presenting", describe most people before most presentations: a support notice on
# those would be noise, and would treat a normal feeling as a condition.
_STRONG_PHRASES = (
    "burnout", "burnt out", "burned out",
    "depressed", "depression",
    "panic attack", "panic attacks",
    "can't cope", "cannot cope", "can't go on", "can't take it",
    "breaking down", "mental breakdown", "nervous breakdown",
    "hopeless", "worthless",
    "can't sleep", "cannot sleep", "haven't slept", "not sleeping",
    "overwhelmed",
)

# These name a subject, not a severity, so each needs a word saying it has lasted
# or that it is past managing. "Stressed about this session" is a sentence about a
# session; "stressed for weeks" is a sentence about a life.
_THEME_WORDS = (
    "stress", "stressed", "stressful",
    "anxiety", "anxious",
    "exhausted", "exhausting", "exhaustion", "drained",
    "crying", "cried", "lonely",
    "sick", "illness", "unwell", "health",
    "family problem", "family problems",
    "personal problem", "personal problems",
    "money problem", "money problems",
    "financial problem", "financial problems",
)

_PERSISTENCE_WORDS = (
    "for weeks", "for months", "for days", "every day", "everyday",
    "all the time", "constantly", "never stops",
    "too much", "so much", "no longer", "can't", "cannot",
)


def _contains(haystack: str, phrase: str) -> bool:
    """Whole words only, so "alone" does not match "along"."""
    return re.search(rf"(^|[^a-z0-9]){re.escape(phrase)}([^a-z0-9]|$)", haystack) is not None


def distress_level(text: str | None) -> str | None:
    """``"urgent"``, ``"support"``, or ``None`` - what, if anything, to offer.

    A rule this simple will miss things and will occasionally speak up when it did
    not need to. That is the right way round here: it never asserts anything about
    the learner and never changes a score, so an unnecessary notice costs a few
    lines of text, while a missed one costs the only thing this feature is for.
    """
    if not text:
        return None
    value = text.lower()

    if any(_contains(value, phrase) for phrase in _URGENT_PHRASES):
        return "urgent"
    if any(_contains(value, phrase) for phrase in _STRONG_PHRASES):
        return "support"

    has_theme = any(_contains(value, word) for word in _THEME_WORDS)
    persists = any(_contains(value, word) for word in _PERSISTENCE_WORDS)
    return "support" if has_theme and persists else None


# Free, confidential services in Sri Lanka, supplied by the team.
#
# Data in one place, so there is a single thing to check. A number that has
# changed is the worst failure this feature has - worse than showing nothing - so
# treat this as a list to verify before each release, not to copy forward. None of
# it was generated.
_CONTACTS = (
    SupportContact(
        name="CCCline",
        number="1333",
        detail="24 hours, toll-free. Sinhala, Tamil and English.",
    ),
    SupportContact(
        name="National Mental Health Helpline",
        number="1926",
        detail="National Institute of Mental Health.",
    ),
    SupportContact(
        name="Sumithrayo",
        number="011 269 6666",
        detail="Every day, 9:00 AM to 8:00 PM. Also 011 269 2909 and 011 268 3555.",
    ),
)

# One sentence, and not about the learner: it says what this page is, and leaves
# the reading of their own situation to them.
_MESSAGE = {
    "urgent": (
        "This page is about presentation practice and nothing else. If you are "
        "going through something harder than that, please talk to someone now. "
        "These lines are free and confidential."
    ),
    "support": (
        "This page only has advice about practising a skill. If something bigger "
        "than that is weighing on you, these people are free to talk to, and "
        "confidential."
    ),
}


def support_path_for(texts: list[str | None]) -> SupportPath | None:
    """The path to offer for a set of written reflections, or None.

    Takes the most serious level found across all of them, because the offer is
    made once for the page rather than once per reflection.
    """
    levels = {distress_level(text) for text in texts}
    level = "urgent" if "urgent" in levels else "support" if "support" in levels else None
    if level is None:
        return None
    return SupportPath(level=level, message=_MESSAGE[level], contacts=list(_CONTACTS))
