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
