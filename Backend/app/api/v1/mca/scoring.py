import math
from typing import Dict, Any

# Russell (1980) Circumplex: Valence scores for the 7-class SVM emotion labels
# Valence: -1 (maximally negative) → +1 (maximally positive).
# Values approximated from Russell (1980, Fig. 1) and subsequent replications.
_EMOTION_VALENCE: Dict[str, float] = {
    "angry":     -1.00,   # high arousal, very negative valence
    "fearful":   -0.80,   # high arousal, strongly negative valence
    "disgust":   -0.70,   # moderate arousal, strongly negative valence
    "sad":       -0.50,   # low arousal, moderately negative valence
    "neutral":    0.00,   # zero valence (baseline)
    "surprised":  0.30,   # high arousal, mildly positive valence
    "happy":      0.80,   # high arousal, strongly positive valence
}

# Nudge - communication dimension mapping
# "fusion" is resolved dynamically because a single fusion rule can map to
# either non-verbal presence or audio-visual congruence depending on its signal.
_CATEGORY_TO_DIMENSION: Dict[str, str] = {
    "volume":   "vocal",     # Mehrabian vocal channel
    "pitch":    "vocal",
    "clarity":  "vocal",
    "pace":     "fluency",   # Goldman-Eisler fluency
    "silence":  "fluency",
}

# Keywords from AffectFusion rule messages that indicate a non-verbal (presence)
# issue rather than an audio-visual congruence (incongruence) issue.
_PRESENCE_KEYWORDS = frozenset(
    {"look", "gaze", "head", "eye", "audience", "distracted", "reader", "away"}
)

# Severity - fractional event weight
# Critical = 1 full event; Warning = 0.5; Info = 0.25.
# Ordinal weights are consistent with partial-interval behavioral observation
# systems used in Applied Behavior Analysis (Cooper et al., 2020).
_SEVERITY_WEIGHT: Dict[str, float] = {
    "critical": 1.00,
    "warning":  0.50,
    "info":     0.25,
}

# Mehrabian-derived dimension weights (sum = 1.0)
_DIMENSION_WEIGHTS = {
    "presence_engagement":  0.40,
    "vocal_command":        0.28,
    "emotional_regulation": 0.22,
    "speech_fluency":       0.10,
}

# Nudge cooldown window (seconds)
NUDGE_COOLDOWN_SECONDS: float = 10.0

# Logistic decay thresholds in OBP (proportion) space
# OBP = flagged_opportunities / max_opportunities  ∈ [0, 1]
# Max opportunities per minute = 60 / NUDGE_COOLDOWN_SECONDS = 6.
#
# Thresholds are Guitar (2014) mild-severity boundaries converted to OBP:
#   vocal/fluency mild = 2 events/min  →  2/6 = 0.333 of opportunities
#   presence mild      = 1 event/min   →  1/6 = 0.167
#   congruence mild    = 0.5 event/min →  0.5/6 = 0.083
#
# k values are scaled to preserve the same curve steepness relative to the
# threshold (k_obp = k_brm × 6, since OBP = BRM / 6).
_LOGISTIC_PARAMS = {
    "vocal":      {"k": 12.0, "threshold": 0.333},
    "fluency":    {"k": 12.0, "threshold": 0.333},
    "presence":   {"k": 15.0, "threshold": 0.167},
    "congruence": {"k": 18.0, "threshold": 0.083},
}

# Reference opportunity count for the duration reliability correction.
# 5 min × (60s / 10s cooldown) = 30 observation slots.
_REFERENCE_OPPORTUNITIES: float = 30.0


# Internal helpers

def _resolve_dimension(nudge: dict) -> str:
    """Map a nudge to its communication dimension."""
    cat = nudge.get("category", "").lower()
    if cat != "fusion":
        return _CATEGORY_TO_DIMENSION.get(cat, "vocal")
    msg = nudge.get("message", "").lower()
    return "presence" if any(kw in msg for kw in _PRESENCE_KEYWORDS) else "congruence"


def _logistic_score(brm: float, k: float, threshold: float) -> float:
    """
    Map Behavior Rate per Minute to a 0–100 score via logistic decay.

    score = 100 / (1 + e^(k * (brm - threshold)))

    At brm == threshold  → score ≈ 50
    At brm == 0          → score → 100
    At brm >> threshold  → score → 0
    """
    return 100.0 / (1.0 + math.exp(k * (brm - threshold)))


def _emotion_valence_score(emotion_distribution: Dict[str, float]) -> float:
    """
    Compute a 0–100 Emotional Regulation score from Russell's (1980) valence axis.

    Steps:
      1. Weighted-average valence over detected emotions.
      2. Rescale [-1, +1] → [0, 100].

    A score of 100 = sustained positive affect; 50 = neutral; 0 = sustained anger.
    """
    total = sum(emotion_distribution.values())
    if total == 0:
        return 50.0  # neutral baseline when no emotion data is available

    weighted_valence = sum(
        _EMOTION_VALENCE.get(emotion, 0.0) * proportion
        for emotion, proportion in emotion_distribution.items()
    )
    normalised = weighted_valence / total
    # Rescale [-1, +1] → [0, 100]
    return (normalised + 1.0) * 50.0


def _log_duration_correction(raw_score: float, max_opportunities: float) -> float:
    """
    Shrink scores toward the neutral midpoint (50) when few observation slots exist.

    Formula:
      log_frac = log(n + 1) / log(N_ref + 1)   where N_ref = 30 slots (5 min)
      corrected = raw_score * log_frac + 50 * (1 - log_frac)

    Rationale: measurement reliability grows logarithmically with sample size
    (Anderson & Lebiere, 1998). Using opportunity count (n = duration_s / cooldown_s)
    rather than raw minutes correctly ties reliability to the number of actual
    observation windows the nudge system could have fired in — not clock time.
    At n >= 30 (5-minute session) the correction factor reaches 1.0 and has no effect.
    """
    if max_opportunities >= _REFERENCE_OPPORTUNITIES:
        return raw_score

    log_frac = math.log(max_opportunities + 1.0) / math.log(_REFERENCE_OPPORTUNITIES + 1.0)
    return raw_score * log_frac + 50.0 * (1.0 - log_frac)



# Public API
def calculate_session_metrics(
    nudge_log: list[dict],
    emotion_distribution: Dict[str, float],
    duration_seconds: int = 60,
) -> Dict[str, Any]:
    """
    Compute MCA skill scores and an overall session score.

    Pipeline
    --------
    1. Aggregate nudge events into per-dimension severity-weighted counts.
    2. Convert to Opportunity-Based Proportion (OBP) using the 10-s cooldown
       window as the observation unit — Johnston & Pennypacker (2009).
    3. Map OBP → raw dimension score via logistic decay (Guitar, 2014 thresholds).
    4. Score emotional regulation using Russell (1980) valence mapping.
    5. Apply log-opportunity reliability correction — Anderson & Lebiere (1998).
    6. Combine into overall score using Mehrabian & Ferris (1967) channel weights.

    Parameters
    ----------
    nudge_log            : List of nudge dicts with keys: category, severity, message.
    emotion_distribution : Mapping of emotion label → proportion (values should sum ≈ 1).
    duration_seconds     : Total session length in seconds.
    """
    # max_opportunities: number of 10-second cooldown slots in this session.
    # The nudge engine can fire at most one nudge per slot, so this is the
    # denominator for Opportunity-Based Proportion (OBP).
    max_opportunities = max(1.0, duration_seconds / NUDGE_COOLDOWN_SECONDS)

    # Step 1: Accumulate severity-weighted event counts per dimension
    dim_counts: Dict[str, float] = {
        "vocal": 0.0, "fluency": 0.0, "presence": 0.0, "congruence": 0.0
    }
    for nudge in nudge_log:
        dim = _resolve_dimension(nudge)
        weight = _SEVERITY_WEIGHT.get(nudge.get("severity", "info").lower(), 0.25)
        dim_counts[dim] += weight

    # Step 2: Opportunity-Based Proportion (OBP) per dimension
    # OBP = weighted_count / max_opportunities  ∈ [0, 1]
    # Using OBP rather than raw rate (BRM) is necessary because the 10-second
    # cooldown in NudgeEngine caps how many nudges can fire in any session.
    # OBP is the standard metric when observation windows are constrained
    # (Johnston & Pennypacker, 2009 — restricted-operant measurement).
    obp: Dict[str, float] = {
        dim: min(1.0, count / max_opportunities)
        for dim, count in dim_counts.items()
    }

    # Step 3: Raw dimension scores via logistic decay on OBP
    raw_vocal   = _logistic_score(obp["vocal"],   **_LOGISTIC_PARAMS["vocal"])
    raw_fluency = _logistic_score(obp["fluency"], **_LOGISTIC_PARAMS["fluency"])
    # Presence absorbs congruence: audio-visual mismatch is a non-verbal failure.
    # Congruence OBP is weighted 1.5× before merging (Ekman & Friesen, 1969).
    presence_obp = min(1.0, obp["presence"] + obp["congruence"] * 1.5)
    raw_presence = _logistic_score(presence_obp, **_LOGISTIC_PARAMS["presence"])

    # Step 4: Emotional regulation score (Russell circumplex)
    raw_emotion = _emotion_valence_score(emotion_distribution)

    # Step 5: Log-opportunity reliability correction
    # Reliability is tied to number of observation slots, not clock time.
    vocal    = _log_duration_correction(raw_vocal,    max_opportunities)
    fluency  = _log_duration_correction(raw_fluency,  max_opportunities)
    presence = _log_duration_correction(raw_presence, max_opportunities)
    emotion  = _log_duration_correction(raw_emotion,  max_opportunities)

    def clamp(v: float) -> int:
        return int(min(100.0, max(0.0, round(v))))

    breakdown = {
        "vocal_command":        clamp(vocal),
        "speech_fluency":       clamp(fluency),
        "presence_engagement":  clamp(presence),
        "emotional_regulation": clamp(emotion),
    }

    # Step 6: Mehrabian-weighted overall score
    overall = (
        breakdown["vocal_command"]        * _DIMENSION_WEIGHTS["vocal_command"] +
        breakdown["speech_fluency"]       * _DIMENSION_WEIGHTS["speech_fluency"] +
        breakdown["presence_engagement"]  * _DIMENSION_WEIGHTS["presence_engagement"] +
        breakdown["emotional_regulation"] * _DIMENSION_WEIGHTS["emotional_regulation"]
    )

    # Raw valence for diagnostics (before rescaling)
    total_emotion = sum(emotion_distribution.values()) or 1.0
    raw_valence = sum(
        _EMOTION_VALENCE.get(e, 0.0) * p for e, p in emotion_distribution.items()
    ) / total_emotion

    return {
        "overall": clamp(overall),
        "breakdown": breakdown,
        "diagnostics": {
            "obp_per_dimension": {k: round(v, 4) for k, v in obp.items()},
            "max_opportunities": int(max_opportunities),
            "emotion_valence_raw": round(raw_valence, 3),
            "session_minutes": round(duration_seconds / 60.0, 2),
        },
    }
