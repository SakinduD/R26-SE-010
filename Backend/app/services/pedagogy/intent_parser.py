"""
Intent Parser — turns a learner's free-text practice goal into a LearnerIntent.

Contract, mirroring scenario_selector.py:
  * NEVER RAISES. Every failure path (missing key, timeout, API error, invalid
    JSON, schema mismatch) degrades to a deterministic keyword parse with
    parse_source="rule_based" and parse_confidence <= 0.5.
  * NO RAW OCEAN NUMBERS IN THE PROMPT — low/mid/high levels only.
  * Structured overrides supplied by the caller always beat LLM output.

Credentialing: the GeminiClient passed in must be APM-credentialed — build it
with app.core.llm_client.get_apm_llm_client(). Do not read GEMINI_API_KEY* here.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from pydantic import ValidationError

from app.config import get_settings
from app.core.llm_client import GeminiClient, LLMError
from app.schemas.training_plan import LearnerIntent
from app.services.pedagogy.adapter import RPE_SKILL_VOCABULARY

logger = logging.getLogger(__name__)

# Confidence ceiling for any non-LLM parse, so "we guessed" stays visibly
# distinct from "the model read it" in generation_sources.
RULE_BASED_MAX_CONFIDENCE = 0.5
RULE_BASED_MATCH_CONFIDENCE = 0.45
RULE_BASED_NO_MATCH_CONFIDENCE = 0.2

# Ordered most-specific first: the first domain with a keyword hit wins, so
# "performance review" beats a bare "feedback" mention.
_DOMAIN_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("performance_review", ("performance review", "appraisal", "annual review",
                            "review cycle", "rating")),
    ("crisis_handling", ("crisis", "incident", "outage", "escalated", "emergency",
                         "postmortem", "post-mortem")),
    ("conflict_resolution", ("conflict", "disagree", "argument", "tension",
                             "push back", "pushing back", "pushback", "confront",
                             "scope creep", "stand up to", "friction")),
    ("feedback_delivery", ("feedback", "critique", "underperform", "call out",
                           "difficult conversation")),
    ("negotiation", ("negotiat", "salary", "raise", "deadline extension",
                     "budget", "contract", "compromise", "trade-off")),
    ("presentation", ("present", "demo", "pitch", "stakeholder update",
                      "town hall", "slides")),
    ("interview", ("interview", "hiring", "candidate", "screening")),
    ("client_communication", ("client", "customer", "account", "vendor",
                              "stakeholder call")),
    ("performance_review", ("one-on-one", "1:1")),
    ("onboarding", ("onboard", "new hire", "first week", "ramp up", "mentee")),
    ("networking", ("network", "conference", "introduce myself", "small talk")),
    ("team_collaboration", ("team", "standup", "stand-up", "retro",
                            "retrospective", "sprint", "colleague", "peer",
                            "cross-functional")),
]

_COUNTERPART_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("manager", ("manager", "boss", "supervisor", "lead", "director", "head of")),
    ("client", ("client", "customer", "account", "vendor")),
    ("direct report", ("report", "junior", "mentee", "new hire", "my team member")),
    ("interviewer", ("interviewer", "hiring manager", "panel")),
    ("stakeholder", ("stakeholder", "exec", "executive", "vp", "product owner")),
    ("teammate", ("teammate", "peer", "colleague", "co-worker", "coworker")),
]

_DISPOSITION_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("resistant", ("resistant", "refuses", "won't budge", "stubborn", "hostile",
                   "defensive", "dismissive", "pushes back hard")),
    ("skeptical", ("skeptical", "sceptical", "doubt", "unconvinced",
                   "questioning", "not sold")),
    ("distracted", ("distracted", "busy", "checked out", "multitasking",
                    "rushed", "no time")),
    ("supportive", ("supportive", "friendly", "helpful", "encouraging",
                    "on my side")),
]

_INTENSITY_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("challenging", ("hard", "tough", "challenging", "worst case", "difficult",
                     "push me", "stretch")),
    ("gentle", ("gentle", "easy", "safe", "low pressure", "nervous", "anxious",
                "ease in", "beginner")),
]

_SESSION_LENGTH_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("short", ("quick", "short", "brief", "five minutes", "5 minutes")),
    ("extended", ("long", "extended", "in depth", "in-depth", "thorough",
                  "deep dive")),
]

# Domain → the RPE-vocabulary skills that domain naturally exercises.
_DOMAIN_DEFAULT_SKILLS: dict[str, list[str]] = {
    "conflict_resolution": ["conflict_resolution", "assertiveness",
                            "emotional_regulation"],
    "feedback_delivery": ["professional_communication", "accountability",
                          "emotional_regulation"],
    "negotiation": ["assertiveness", "self_advocacy", "boundary_setting"],
    "presentation": ["professional_communication", "self_advocacy"],
    "interview": ["self_advocacy", "professional_communication"],
    "client_communication": ["client_management", "professional_communication",
                             "trust_building"],
    "team_collaboration": ["trust_building", "professional_communication",
                           "conflict_resolution"],
    "performance_review": ["accountability", "self_advocacy",
                           "professional_assertiveness"],
    "crisis_handling": ["emotional_regulation", "accountability",
                        "professional_assertiveness"],
    "networking": ["professional_communication", "trust_building"],
    "onboarding": ["trust_building", "professional_communication"],
    "other": ["professional_communication", "assertiveness"],
}

# Fail at import if the table drifts out of RPE's vocabulary.
for _domain, _skills in _DOMAIN_DEFAULT_SKILLS.items():
    _unknown = [s for s in _skills if s not in RPE_SKILL_VOCABULARY]
    if _unknown:  # pragma: no cover
        raise RuntimeError(
            f"_DOMAIN_DEFAULT_SKILLS[{_domain!r}] contains non-RPE skills: {_unknown}"
        )

_VALID_DOMAINS = frozenset(_DOMAIN_DEFAULT_SKILLS)
_VALID_DISPOSITIONS = frozenset(
    {"supportive", "neutral", "skeptical", "resistant", "distracted"}
)
_VALID_INTENSITIES = frozenset({"gentle", "balanced", "challenging"})
_VALID_SESSION_LENGTHS = frozenset({"short", "standard", "extended"})

_OVERRIDABLE_FIELDS = (
    "domain",
    "workplace_context",
    "learner_role",
    "counterpart_role",
    "counterpart_disposition",
    "desired_focus_skills",
    "intensity_preference",
    "session_length",
)


def _first_match(
    text: str, table: list[tuple[str, tuple[str, ...]]]
) -> Optional[str]:
    """Return the first table value whose keywords appear in text."""
    for value, keywords in table:
        if any(kw in text for kw in keywords):
            return value
    return None


def _build_prompt(raw_text: str, ocean_levels: dict[str, str]) -> str:
    """
    Build the Gemini prompt.

    INVARIANT: ocean_levels values are already low/mid/high strings, and no
    numeric OCEAN score may appear anywhere in the result —
    test_intent_parser.py asserts on this directly.
    """
    levels = "\n".join(
        f"  {trait}: {level}" for trait, level in sorted(ocean_levels.items())
    )
    vocabulary = ", ".join(sorted(RPE_SKILL_VOCABULARY))
    return f"""You are analysing a learner's request to practise a workplace conversation. Return ONLY a single JSON object — no prose, no markdown.

Learner's request (verbatim):
\"\"\"{raw_text}\"\"\"

Learner personality (LEVEL ONLY, no raw scores):
{levels}

Allowed focus skills (use ONLY these exact strings):
{vocabulary}

Do not invent scenario dialogue, NPC lines, or scenario content. Classify the
request only.

Required JSON shape (all fields must be present):
{{
  "domain": "<one of: conflict_resolution, feedback_delivery, negotiation, presentation, interview, client_communication, team_collaboration, performance_review, crisis_handling, networking, onboarding, other>",
  "workplace_context": "<short phrase describing the setting, e.g. 'sprint retro on a 6-person dev team'>",
  "learner_role": "<the learner's role in the situation>",
  "counterpart_role": "<the other person's role>",
  "counterpart_disposition": "<one of: supportive, neutral, skeptical, resistant, distracted>",
  "desired_focus_skills": [<1-4 strings from the allowed focus skills list>],
  "intensity_preference": "<one of: gentle, balanced, challenging>",
  "session_length": "<one of: short, standard, extended>",
  "parse_confidence": <float 0-1, how confident you are the request was unambiguous>
}}
"""


def _rule_based_fields(raw_text: str) -> dict[str, Any]:
    """Deterministic keyword parse. Same text always gives the same result."""
    text = raw_text.lower()

    domain = _first_match(text, _DOMAIN_KEYWORDS) or "other"
    counterpart = _first_match(text, _COUNTERPART_KEYWORDS) or "colleague"
    disposition = _first_match(text, _DISPOSITION_KEYWORDS) or "neutral"
    intensity = _first_match(text, _INTENSITY_KEYWORDS) or "balanced"
    session_length = _first_match(text, _SESSION_LENGTH_KEYWORDS) or "standard"

    matched_anything = domain != "other" or counterpart != "colleague"
    confidence = (
        RULE_BASED_MATCH_CONFIDENCE
        if matched_anything
        else RULE_BASED_NO_MATCH_CONFIDENCE
    )

    return {
        "raw_text": raw_text,
        "domain": domain,
        "workplace_context": f"A workplace {domain.replace('_', ' ')} situation",
        "learner_role": "team member",
        "counterpart_role": counterpart,
        "counterpart_disposition": disposition,
        "desired_focus_skills": _DOMAIN_DEFAULT_SKILLS[domain][:2],
        "intensity_preference": intensity,
        "session_length": session_length,
        "parse_confidence": min(confidence, RULE_BASED_MAX_CONFIDENCE),
        "parse_source": "rule_based",
    }


def _coerce_llm_payload(data: dict[str, Any], raw_text: str) -> dict[str, Any]:
    """
    Normalise a raw Gemini payload into LearnerIntent kwargs.

    Anything the model got wrong (unknown enum value, out-of-vocabulary skill)
    falls back to the rule-based guess rather than being rejected outright — a
    partially good LLM parse still beats no parse.
    """
    fallback = _rule_based_fields(raw_text)

    domain = str(data.get("domain", "")).strip().lower()
    if domain not in _VALID_DOMAINS:
        domain = fallback["domain"]

    disposition = str(data.get("counterpart_disposition", "")).strip().lower()
    if disposition not in _VALID_DISPOSITIONS:
        disposition = fallback["counterpart_disposition"]

    intensity = str(data.get("intensity_preference", "")).strip().lower()
    if intensity not in _VALID_INTENSITIES:
        intensity = fallback["intensity_preference"]

    session_length = str(data.get("session_length", "")).strip().lower()
    if session_length not in _VALID_SESSION_LENGTHS:
        session_length = fallback["session_length"]

    raw_skills = data.get("desired_focus_skills") or []
    if not isinstance(raw_skills, list):
        raw_skills = []
    skills = list(dict.fromkeys(
        s for s in (str(x).strip().lower() for x in raw_skills)
        if s in RPE_SKILL_VOCABULARY
    ))
    if not skills:
        skills = _DOMAIN_DEFAULT_SKILLS[domain][:2]

    try:
        confidence = float(data.get("parse_confidence", 0.75))
    except (TypeError, ValueError):
        confidence = 0.75
    confidence = max(0.0, min(1.0, confidence))

    def _text(key: str) -> str:
        return str(data.get(key, "") or "").strip() or fallback[key]

    return {
        "raw_text": raw_text,
        "domain": domain,
        "workplace_context": _text("workplace_context"),
        "learner_role": _text("learner_role"),
        "counterpart_role": _text("counterpart_role"),
        "counterpart_disposition": disposition,
        "desired_focus_skills": skills[:4],
        "intensity_preference": intensity,
        "session_length": session_length,
        "parse_confidence": confidence,
        "parse_source": "llm",
    }


def _apply_overrides(
    fields: dict[str, Any], overrides: Optional[dict[str, Any]]
) -> dict[str, Any]:
    """
    Structured overrides always win. Only non-None values are applied;
    focus_skills is accepted under either its request name or its intent name.
    """
    if not overrides:
        return fields

    merged = dict(fields)
    for key in _OVERRIDABLE_FIELDS:
        value = overrides.get(key)
        if key == "desired_focus_skills" and value is None:
            value = overrides.get("focus_skills")
        if value is not None:
            merged[key] = value
    return merged


def rule_based_parse(
    raw_text: str, structured_overrides: Optional[dict[str, Any]] = None
) -> LearnerIntent:
    """Public deterministic parse — used by tests and by the fallback path."""
    fields = _apply_overrides(_rule_based_fields(raw_text), structured_overrides)
    return LearnerIntent(**fields)


async def parse_intent(
    raw_text: str,
    structured_overrides: Optional[dict[str, Any]] = None,
    ocean_levels: Optional[dict[str, str]] = None,
    *,
    llm: Optional[GeminiClient] = None,
) -> LearnerIntent:
    """
    Parse a learner's goal text into a LearnerIntent. Never raises.

    ocean_levels is {trait: "low"|"mid"|"high"} — levels only, never scores.
    When llm is None the rule-based path is used without attempting a call.
    """
    if llm is None:
        logger.warning(
            "intent_parser: no LLM client supplied — using rule_based fallback"
        )
        return rule_based_parse(raw_text, structured_overrides)

    prompt = _build_prompt(raw_text, ocean_levels or {})

    try:
        data = await llm.generate_json(
            prompt, timeout_s=get_settings().apm_llm_timeout_s
        )
        fields = _coerce_llm_payload(data, raw_text)
        return LearnerIntent(**_apply_overrides(fields, structured_overrides))
    except LLMError as exc:
        logger.warning(
            "intent_parser: Gemini failed (%s) — degrading to rule_based fallback",
            exc.reason,
        )
    except ValidationError as exc:
        logger.warning(
            "intent_parser: LLM payload failed LearnerIntent validation (%s) — "
            "degrading to rule_based fallback",
            exc.error_count(),
        )
    except Exception:
        logger.warning(
            "intent_parser: unexpected error — degrading to rule_based fallback",
            exc_info=True,
        )

    return rule_based_parse(raw_text, structured_overrides)
