"""
MCA rule-based session scoring (AI sessions, and the live-session fallback).

Scores every analysed ~3 s chunk, not the cooldown-limited nudge log:
1. Each skill = share of its eligible chunks with no issue (partial-interval
   recording; Cooper et al., 2020). Severity is not a weight.
2. Chunks only count where the skill was observable (speaking; face visible
   for presence). Missing face = missing data, not failure.
3. Silence counts as a hesitation only inside the learner's own speech
   (Goldman-Eisler, 1968; Heldner & Edlund, 2010).
4. Laplace's rule of succession, (clean + 1) / (n + 2): 50 with no evidence.
5. Emotional regulation = confidence-weighted affect balance (Bradburn, 1969),
   valence sign only (Russell, 1980), Dirichlet(1, 1, 1) prior; 50 = neutral.
6. Overall = unweighted mean (Dawes, 1979; Wainer, 1976).
"""
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional

SCORING_VERSION = "mca-interval-v2"

# Length of one analysed audio chunk (frontend MediaRecorder slice).
CHUNK_SECONDS: float = 3.0

# Silence is a hesitation only if the learner spoke this close before and after it.
PAUSE_CONTEXT_SECONDS: float = 2 * CHUNK_SECONDS

_DIMENSIONS = (
    "vocal_command",
    "speech_fluency",
    "presence_engagement",
    "emotional_regulation",
)

# Analyzer category -> issue tag
_CATEGORY_TAG: Dict[str, str] = {
    "volume":  "vocal",
    "pitch":   "vocal",
    "clarity": "vocal",
    "pace":    "pace",
    "silence": "silence",
}

# Fusion messages with these words are presence issues (gaze, head); others are incongruence.
_PRESENCE_KEYWORDS = frozenset(
    {"look", "gaze", "head", "eye", "audience", "distracted", "reader", "away"}
)

# Fusion messages about equipment, not the learner's skill.
_TECHNICAL_KEYWORDS = frozenset({"microphone"})

_NONVERBAL_TAGS = frozenset({"presence", "congruence"})

# Sign of valence per SER label (Russell, 1980). Labels not listed are neutral.
_POSITIVE_EMOTIONS = frozenset({"happy"})
_NEGATIVE_EMOTIONS = frozenset({"angry", "fearful", "sad", "disgust"})


@dataclass(frozen=True)
class _Interval:
    t: float
    voiced: bool
    face: bool
    tags: frozenset
    emotion: Optional[str] = None
    confidence: float = 1.0


# Internal helpers

def _issue_tag(detection: dict) -> str:
    """Map one analyzer detection to an issue tag."""
    category = str(detection.get("category", "")).lower()
    if category != "fusion":
        return _CATEGORY_TAG.get(category, "vocal")
    message = str(detection.get("message", "")).lower()
    if any(kw in message for kw in _TECHNICAL_KEYWORDS):
        return "technical"
    return "presence" if any(kw in message for kw in _PRESENCE_KEYWORDS) else "congruence"


def _elapsed(item: dict) -> float:
    try:
        return float(item.get("elapsed_seconds") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _confidence(value: Any) -> float:
    if isinstance(value, (int, float)):
        return min(1.0, max(0.0, float(value)))
    return 1.0


def _intervals_from_observations(observation_log: list[dict]) -> list[_Interval]:
    """One interval per analysed chunk, as recorded by the client."""
    intervals = []
    for obs in observation_log:
        emotion = obs.get("emotion")
        intervals.append(_Interval(
            t=_elapsed(obs),
            voiced=bool(obs.get("speaking")),
            face=bool(obs.get("face_visible")),
            tags=frozenset(_issue_tag(d) for d in obs.get("detections") or []),
            emotion=str(emotion).lower() if emotion else None,
            confidence=_confidence(obs.get("confidence")),
        ))
    intervals.sort(key=lambda i: i.t)
    return intervals


def _intervals_from_events(
    behavior_log: list[dict],
    nudge_log: list[dict],
    emotion_distribution: Dict[str, float],
    duration_seconds: int,
) -> list[_Interval]:
    """
    Rebuild intervals for older clients with no observation log: flagged chunks
    from the behaviour log (else the nudge log), the rest assumed clean.
    Empty if there's no sign analysis ran at all.
    """
    groups: list[list[dict]]
    if behavior_log:
        by_time: Dict[float, list[dict]] = {}
        for item in behavior_log:
            by_time.setdefault(round(_elapsed(item), 1), []).append(item)
        groups = list(by_time.values())
    else:
        groups = [[n] for n in nudge_log]

    if not groups and not emotion_distribution:
        return []

    intervals = []
    for group in groups:
        tags = frozenset(_issue_tag(d) for d in group)
        intervals.append(_Interval(
            t=_elapsed(group[0]),
            voiced=bool(tags - {"silence", "technical"}),
            face=True,
            tags=tags,
        ))
    expected = int(round(duration_seconds / CHUNK_SECONDS))
    for _ in range(max(0, expected - len(intervals))):
        intervals.append(_Interval(t=0.0, voiced=True, face=True, tags=frozenset()))
    return intervals


def _hesitation_indices(intervals: list[_Interval], timing_known: bool) -> set[int]:
    """Silent intervals that fall inside the learner's own speech."""
    silent = [i for i, iv in enumerate(intervals) if "silence" in iv.tags]
    if not timing_known:
        return set(silent)
    voiced_times = [iv.t for iv in intervals if iv.voiced]
    hesitations = set()
    for i in silent:
        t = intervals[i].t
        before = any(t - PAUSE_CONTEXT_SECONDS <= v < t for v in voiced_times)
        after = any(t < v <= t + PAUSE_CONTEXT_SECONDS for v in voiced_times)
        if before and after:
            hesitations.add(i)
    return hesitations


def _laplace_score(clean: float, n: float) -> float:
    """Posterior mean of the clean proportion under Beta(1, 1), as 0–100."""
    return 100.0 * (clean + 1.0) / (n + 2.0)


def _affect_balance_score(positive: float, negative: float, n: float) -> float:
    """Affect balance under a Dirichlet(1, 1, 1) prior, mapped to 0–100 (50 = neutral)."""
    p_pos = (positive + 1.0) / (n + 3.0)
    p_neg = (negative + 1.0) / (n + 3.0)
    return 50.0 + 50.0 * (p_pos - p_neg)


def _affect_counts(
    intervals: list[_Interval],
    emotion_distribution: Dict[str, float],
) -> tuple[float, float, float]:
    """(positive mass, negative mass, number of emotion readings)."""
    readings = [iv for iv in intervals if iv.emotion]
    if readings:
        positive = sum(iv.confidence for iv in readings if iv.emotion in _POSITIVE_EMOTIONS)
        negative = sum(iv.confidence for iv in readings if iv.emotion in _NEGATIVE_EMOTIONS)
        return positive, negative, float(len(readings))

    # No per-chunk readings: spread the session distribution over voiced chunks.
    total = sum(emotion_distribution.values())
    n = float(sum(1 for iv in intervals if iv.voiced))
    if total <= 0 or n == 0:
        return 0.0, 0.0, 0.0

    def share(labels: frozenset) -> float:
        return sum(p for e, p in emotion_distribution.items() if str(e).lower() in labels) / total

    return n * share(_POSITIVE_EMOTIONS), n * share(_NEGATIVE_EMOTIONS), n


def _rate(issues: int, n: int) -> float:
    return round(issues / n, 4) if n else 0.0


def clamp(v: float) -> int:
    """Clamp a raw score to an integer 0-100."""
    return int(min(100.0, max(0.0, round(v))))


def combine_breakdown_to_overall(breakdown: Dict[str, float]) -> int:
    """Equal-weight overall score. Shared with the LLM scorer so the LLM never does the arithmetic."""
    return clamp(sum(breakdown[dim] for dim in _DIMENSIONS) / len(_DIMENSIONS))


# Public API
def calculate_session_metrics(
    nudge_log: list[dict],
    emotion_distribution: Dict[str, float],
    duration_seconds: int = 60,
    observation_log: Optional[Iterable[dict]] = None,
    behavior_log: Optional[Iterable[dict]] = None,
) -> Dict[str, Any]:
    """
    Compute the four skill scores and the overall score.

    observation_log is the main input (one entry per analysed chunk);
    behavior_log and nudge_log are only used by older clients without it.
    """
    emotion_distribution = emotion_distribution or {}
    observation_log = list(observation_log or [])
    behavior_log = list(behavior_log or [])
    nudge_log = list(nudge_log or [])

    if observation_log:
        intervals = _intervals_from_observations(observation_log)
        source, timing_known = "observation_log", True
    else:
        intervals = _intervals_from_events(
            behavior_log, nudge_log, emotion_distribution, duration_seconds
        )
        source = ("behavior_log" if behavior_log else "nudge_log" if nudge_log
                  else "emotion_distribution" if intervals else "none")
        timing_known = False

    hesitations = _hesitation_indices(intervals, timing_known)

    # Per-dimension eligible intervals (n) and flagged intervals (issues).
    n = {"vocal": 0, "fluency": 0, "presence": 0}
    issues = {"vocal": 0, "fluency": 0, "presence": 0, "congruence": 0}
    for i, iv in enumerate(intervals):
        if iv.voiced or "vocal" in iv.tags:
            n["vocal"] += 1
            issues["vocal"] += "vocal" in iv.tags

        disfluent = "pace" in iv.tags or i in hesitations
        if iv.voiced or disfluent:
            n["fluency"] += 1
            issues["fluency"] += disfluent

        nonverbal = iv.tags & _NONVERBAL_TAGS
        if (iv.voiced and iv.face) or nonverbal:
            n["presence"] += 1
            issues["presence"] += bool(nonverbal)
            issues["congruence"] += "congruence" in iv.tags

    positive, negative, n_affect = _affect_counts(intervals, emotion_distribution)

    breakdown = {
        "vocal_command":        clamp(_laplace_score(n["vocal"] - issues["vocal"], n["vocal"])),
        "speech_fluency":       clamp(_laplace_score(n["fluency"] - issues["fluency"], n["fluency"])),
        "presence_engagement":  clamp(_laplace_score(n["presence"] - issues["presence"], n["presence"])),
        "emotional_regulation": clamp(_affect_balance_score(positive, negative, n_affect)),
    }

    return {
        "overall": combine_breakdown_to_overall(breakdown),
        "breakdown": breakdown,
        "diagnostics": {
            # Observed share of eligible intervals flagged, per issue type.
            "obp_per_dimension": {
                "vocal":      _rate(issues["vocal"], n["vocal"]),
                "fluency":    _rate(issues["fluency"], n["fluency"]),
                "presence":   _rate(issues["presence"] - issues["congruence"], n["presence"]),
                "congruence": _rate(issues["congruence"], n["presence"]),
            },
            # Observation intervals (analysed chunks) in the session.
            "max_opportunities": len(intervals),
            # Affect balance before shrinkage, in [-1, +1].
            "emotion_valence_raw": round((positive - negative) / n_affect, 3) if n_affect else 0.0,
            "session_minutes": round(duration_seconds / 60.0, 2),
            "scoring_version": SCORING_VERSION,
            "evidence_source": source,
            "observed_intervals": {
                "vocal_command": n["vocal"],
                "speech_fluency": n["fluency"],
                "presence_engagement": n["presence"],
                "emotional_regulation": int(n_affect),
            },
            "face_coverage": round(sum(iv.face for iv in intervals) / len(intervals), 3) if intervals else 0.0,
            "technical_intervals": sum("technical" in iv.tags for iv in intervals),
        },
    }
