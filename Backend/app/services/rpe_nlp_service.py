# TKI-style conflict-style labels — see Thomas & Kilmann's Conflict Mode
# Instrument (assertiveness x cooperativeness -> 5 styles). RPE already
# scores something close to those two axes every turn (userBehavior, set
# live by the LLM in rpe_llm_service.NPCResponse); this maps that behavior
# mix onto the same named framework instead of leaving trust/escalation as
# unlabelled house numbers.
_ASSERTIVE_BEHAVIORS   = {"assertive_statement", "proposal"}
_COOPERATIVE_BEHAVIORS = {"acknowledgment", "de_escalation"}

_CONFLICT_STYLES = {
    "collaborating": "High on both stating your own position and acknowledging theirs — working the problem together rather than trading concessions.",
    "competing":      "Strongly assertive with little acknowledgment of the other side — holding your ground, but at the cost of the relationship.",
    "accommodating":  "Cooperative but rarely assertive — protecting the relationship by consistently giving ground.",
    "avoiding":        "Low on both — the issue tends to get sidestepped rather than engaged with directly.",
    "compromising":   "A middle mix of stating your position and acknowledging theirs — steady, moderate give-and-take.",
}

ASSERTIVENESS_KEYWORDS = [
    "propose", "suggest", "i will", "i can", "my plan",
    "i recommend", "let me", "i am able", "i commit",
    "here is what", "my approach", "i take responsibility",
]
EMPATHY_KEYWORDS = [
    "understand", "appreciate", "i hear you", "i see your point",
    "that makes sense", "i acknowledge", "i respect",
    "thank you for", "i value", "i recognise",
]
PASSIVE_KEYWORDS = [
    "i don't know", "i can't", "it's not my fault", "i guess",
    "maybe", "i'm not sure", "whatever", "i suppose",
    "nothing i can do", "not possible",
]
AGGRESSIVE_KEYWORDS = [
    "unfair", "ridiculous", "i refuse", "this is stupid",
    "you always", "you never", "i hate", "this is wrong",
    "not my problem", "i quit",
]


class RpeNlpService:
    def analyse_turns(self, turns: list[dict]) -> list[dict]:
        """Score every turn and return per-turn metric dicts."""
        return [self._score_turn(t) for t in turns]

    def compute_conflict_style(self, turns: list[dict]) -> dict | None:
        """
        Derive a TKI-style conflict-handling label for the session from the
        mix of live userBehavior tags (see rpe_llm_service.UserBehaviorLabel).
        Assertive share and cooperative share stand in for TKI's two axes;
        thresholds are simple and documented rather than fitted, matching
        every other rule-based scorer in RPE. Returns None if no turn carries
        a behavior tag yet (older sessions logged before this field existed).
        """
        tagged = [t.get("user_behavior") for t in turns if t.get("user_behavior")]
        if not tagged:
            return None

        total = len(tagged)
        assertive_share   = sum(1 for b in tagged if b in _ASSERTIVE_BEHAVIORS) / total
        cooperative_share = sum(1 for b in tagged if b in _COOPERATIVE_BEHAVIORS) / total

        high, low = 0.35, 0.15
        if assertive_share >= high and cooperative_share >= high:
            style = "collaborating"
        elif assertive_share >= high and cooperative_share < low:
            style = "competing"
        elif assertive_share < low and cooperative_share >= high:
            style = "accommodating"
        elif assertive_share < low and cooperative_share < low:
            style = "avoiding"
        else:
            style = "compromising"

        return {
            "style":             style,
            "label":             style.capitalize(),
            "description":       _CONFLICT_STYLES[style],
            "assertive_share":   round(assertive_share, 2),
            "cooperative_share": round(cooperative_share, 2),
            "turns_tagged":      total,
        }

    def _score_turn(self, turn: dict) -> dict:
        text   = turn["user_input"].lower()
        words  = text.split()
        length = len(words)

        assertive_hits = sum(1 for kw in ASSERTIVENESS_KEYWORDS if kw in text)
        assertiveness  = min(10, assertive_hits * 3)

        empathy_hits = sum(1 for kw in EMPATHY_KEYWORDS if kw in text)
        empathy      = min(10, empathy_hits * 3)

        if length < 3:
            clarity = 2
        elif length <= 8:
            clarity = 5
        elif length <= 20:
            clarity = 9
        elif length <= 35:
            clarity = 7
        else:
            clarity = 5

        flags: list[str] = []
        passive_hits    = sum(1 for kw in PASSIVE_KEYWORDS    if kw in text)
        aggressive_hits = sum(1 for kw in AGGRESSIVE_KEYWORDS if kw in text)
        if passive_hits    >= 1: flags.append("passive")
        if aggressive_hits >= 1: flags.append("aggressive")
        if length < 3:           flags.append("too_short")
        if length > 40:          flags.append("too_long")
        if turn.get("user_behavior"):
            flags.append(f"behavior:{turn['user_behavior']}")

        penalty = (passive_hits * 1.5) + (aggressive_hits * 2)
        raw     = (assertiveness * 0.4) + (empathy * 0.3) + (clarity * 0.3)
        response_quality = max(0.0, min(10.0, round(raw - penalty, 1)))

        return {
            "turn":                turn["turn"],
            "assertiveness_score": assertiveness,
            "empathy_score":       empathy,
            "clarity_score":       clarity,
            "response_quality":    response_quality,
            "flags":               flags,
        }
