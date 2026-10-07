"""
Unit tests for the Prompt V2 payload-optimization pass — see
Backend/docs/INTEGRATION_RPE_PROMPT_V2.md for the full benchmark report
this was validated against.

Covers: prompt_version="current" (the default) stays byte-for-byte
identical to the pre-existing prompt (the single most important guarantee
of this whole task — a regression here would silently change production
behavior), the compact prompt is materially smaller, the compact prompt
still contains every semantic marker the spec required preserved (every
enum value, both emotion overrides, every interaction-type distinction,
every memory-field evidentiary rule), and generate_response() picks the
version from settings correctly.
"""
from unittest.mock import MagicMock

from app.services.rpe_npc_service import RpeNpcService

_ARGS = dict(
    npc_role="Aggressive Manager", npc_personality="demanding, impatient",
    context="You are a new employee. Your manager is pressuring you to submit a report by EOD even though you were given incomplete data.",
    trust_score=50, escalation_level=0, npc_behaviour={}, npc_name=None,
    prior_conversation_state=None,
)

# The exact hash of today's real system prompt for this fixed input — a
# change to this hash means "current" no longer matches what production
# sends today, which this task must never do.
_CURRENT_PROMPT_SHA256_16 = "090e5a9e6c981a77"


def test_current_prompt_version_defaults_and_matches_known_hash():
    svc = RpeNpcService()
    import hashlib
    prompt = svc._build_system_prompt(**_ARGS)
    assert hashlib.sha256(prompt.encode()).hexdigest()[:16] == _CURRENT_PROMPT_SHA256_16
    assert len(prompt) == 12917


def test_explicit_current_matches_default():
    svc = RpeNpcService()
    default_prompt = svc._build_system_prompt(**_ARGS)
    explicit_prompt = svc._build_system_prompt(**_ARGS, prompt_version="current")
    assert default_prompt == explicit_prompt


def test_compact_prompt_is_materially_smaller():
    svc = RpeNpcService()
    current = svc._build_system_prompt(**_ARGS)
    compact = svc._build_system_prompt(**_ARGS, prompt_version="compact")
    assert len(compact) < len(current)
    reduction = 1 - (len(compact) / len(current))
    assert reduction > 0.25  # at least a quarter smaller — a real, material reduction


def test_compact_prompt_preserves_every_enum_value():
    svc = RpeNpcService()
    compact = svc._build_system_prompt(**_ARGS, prompt_version="compact")

    emotions = ["neutral", "happy", "surprised", "frustrated", "sad", "skeptical", "angry", "thinking"]
    animations = ["idle", "thumbsUp", "thumbsDown", "shrug", "openHandPause", "pointing", "handsClasped", "wave"]
    user_behaviors = [
        "assertive_statement", "proposal", "acknowledgment", "de_escalation",
        "clarifying_question", "concession", "deflection", "escalation", "unclear",
    ]
    interaction_types = ["normal", "deliverable_choice", "content_request", "direct_input"]
    content_types = ["paragraph", "section", "evidence", "filename", "number", "short_text", "long_text"]
    phases = [
        "opening", "clarification", "commitment", "constraint",
        "negotiation", "escalation", "resolution", "closing",
    ]
    memory_fields = [
        "npcObjective", "conversationPhase", "unresolvedItems", "commitments",
        "agreedDeadlines", "requestedItems", "userConstraints", "recentTopics",
    ]

    for value in emotions + animations + user_behaviors + interaction_types + content_types + phases + memory_fields:
        assert value in compact, f"{value!r} missing from compact prompt"


def test_compact_prompt_preserves_critical_overrides_and_rules():
    svc = RpeNpcService()
    compact = svc._build_system_prompt(**_ARGS, prompt_version="compact")

    assert "APOLOGY OVERRIDE" in compact
    assert "DELIVERED OVERRIDE" in compact
    # commitment vs hypothetical distinction (regression test E/C from the spec)
    assert "unconditionally committed" in compact
    assert "hypothetical" in compact
    # agreed vs merely-proposed deadline distinction (regression test D)
    assert "NOT automatically agreed" in compact
    # placeholder ban on responseOptions (keeps verbal_handoff/content_request routing correct)
    assert "placeholder" in compact
    # exactly 3 response options, ordered
    assert "exactly 3" in compact
    # never-invent-state rule
    assert "never invent" in compact.lower()
    # JSON-only output requirement
    assert "Do not include any text outside the JSON object." in compact


def test_compact_prompt_state_block_identical_to_current():
    """The conversation-state block itself (§8 of the spec: reuse it,
    don't re-explain it) must render identically for both prompt versions
    — only the Rules/schema-instruction blocks are allowed to differ."""
    svc = RpeNpcService()
    prior_state = {"npc_objective": "Get the numbers", "unresolved_items": ["budget figures"]}
    current = svc._build_system_prompt(**{**_ARGS, "prior_conversation_state": prior_state})
    compact = svc._build_system_prompt(**{**_ARGS, "prior_conversation_state": prior_state}, prompt_version="compact")

    state_block = svc._format_conversation_state(prior_state)
    assert state_block in current
    assert state_block in compact


def test_generate_response_reads_prompt_version_from_settings(monkeypatch):
    from app.services import rpe_npc_service as npc_mod

    captured = {}

    def fake_build_system_prompt(self, *args, **kwargs):
        captured["prompt_version"] = kwargs.get("prompt_version")
        return "SYS"

    monkeypatch.setattr(npc_mod.RpeNpcService, "_build_system_prompt", fake_build_system_prompt)

    fake_response = MagicMock()
    fake_response.dialogue = "ok"
    fake_response.responseOptions = None
    fake_response.contentPrompt = None
    fake_response.interactionType = "normal"
    fake_response.emotion = "neutral"
    fake_response.animation = "idle"
    fake_response.userBehavior = "unclear"
    fake_response.npcObjective = None
    fake_response.conversationPhase = None
    fake_response.unresolvedItems = []
    fake_response.commitments = []
    fake_response.agreedDeadlines = []
    fake_response.requestedItems = []
    fake_response.userConstraints = []
    fake_response.recentTopics = []

    async def fake_get_npc_response(*args, **kwargs):
        return fake_response

    monkeypatch.setattr(npc_mod.rpe_llm_service, "get_npc_response", fake_get_npc_response)
    fake_settings = MagicMock(rpe_llm_prompt_version="compact")
    monkeypatch.setattr(npc_mod, "get_settings", lambda: fake_settings)

    svc = RpeNpcService()
    svc.generate_response(
        user_input="hi", opening_npc_line="hello", session_turns=[],
        npc_role="Boss", npc_personality="strict", context="ctx",
        trust_score=50, escalation_level=0, npc_behaviour={},
    )
    assert captured["prompt_version"] == "compact"
