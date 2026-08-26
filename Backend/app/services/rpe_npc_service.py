import asyncio
import re

from app.services import rpe_llm_service

_EXIT_PHRASES = (
    "exit", "bye", "goodbye", "see you", "talk later",
    "end of day", "lets end", "let's end", "we are done",
    "we're done", "that's all", "thats all", "i'm done",
    "im done", "closing", "signing off", "wrap up",
    "that will be all", "see you then", "end the chat",
    "end the conversation", "stop", "quit",
)


def _matches_exit_phrase(text: str) -> bool:
    """
    Word-boundary match against _EXIT_PHRASES.

    Plain \b-anchored matching isn't enough on its own: "stop" is a standalone
    word in both "I want to stop" (exit intent) and "Stop micromanaging me"
    (not exit intent — it's a transitive verb about something else). The
    difference is that ambiguous single words only mean "end the session"
    when they're the tail of the message, not followed by an object telling
    you what to stop/quit. So single-word phrases are anchored to the end of
    the message; multi-word phrases (specific enough to be unambiguous) still
    match anywhere.
    """
    text_lower = text.lower().strip()
    for phrase in _EXIT_PHRASES:
        phrase_lower = phrase.lower()
        if ' ' in phrase_lower:
            pattern = r'\b' + re.escape(phrase_lower) + r'\b'
        else:
            pattern = r'\b' + re.escape(phrase_lower) + r'\b[\s.!?]*$'
        if re.search(pattern, text_lower):
            return True
    return False


class RpeNpcService:
    """
    Builds RPE's NPC prompts (character role/state + JSON schema instruction,
    conversation-end detection context) and hands them to rpe_llm_service —
    the only place that talks to an LLM provider SDK. No direct Groq/Gemini
    calls live in this class anymore.
    """

    def _build_system_prompt(
        self,
        npc_role: str,
        npc_personality: str,
        context: str,
        trust_score: int,
        escalation_level: int,
        npc_behaviour: dict,
    ) -> str:
        trust_thresholds = npc_behaviour.get(
            "trust_thresholds",
            {"cooperative": 70, "neutral": 40, "hostile": 0},
        )
        escalation_thresholds = npc_behaviour.get(
            "escalation_thresholds",
            {"furious": 4, "irritated": 2, "controlled": 0},
        )

        if trust_score >= trust_thresholds["cooperative"]:
            trust_tone = "The user has earned some respect. Be slightly more cooperative but stay demanding."
        elif trust_score >= trust_thresholds["neutral"]:
            trust_tone = "Remain neutral. Acknowledge effort but maintain pressure."
        else:
            trust_tone = "You have no confidence in this person. Be dismissive and impatient."

        if escalation_level >= escalation_thresholds["furious"]:
            escalation_tone = (
                "You are furious. Issue ultimatums. Use short sharp sentences only. "
                "EXCEPTION: if the user's message THIS turn actually delivers exactly "
                "what you demanded, with real substance, ease off right now in this "
                "same reply, even though you were furious a second ago — do not wait "
                "for another turn to confirm it."
            )
        elif escalation_level >= escalation_thresholds["irritated"]:
            escalation_tone = (
                "You are visibly irritated. No pleasantries whatsoever. "
                "Ease off this turn if the user just gave you something concrete and complete."
            )
        else:
            escalation_tone = "You are tense but controlled."

        base = (
            f"You are roleplaying as {npc_role}.\n"
            f"Personality: {npc_personality}.\n"
            f"Context: {context}\n\n"
            f"Current state:\n"
            f"- Trust level: {trust_score}/100. {trust_tone}\n"
            f"- Escalation level: {escalation_level}/5. {escalation_tone}\n\n"
            f"Rules:\n"
            f"- Respond in 1-3 sentences only.\n"
            f"- Stay in character. Never break roleplay.\n"
            f"- IMPORTANT: Every response must be different from all previous responses. "
            f"Never repeat or paraphrase a line you have already said in this conversation.\n"
            f"- Your tone must reflect the trust and escalation state above, "
            f"but that state describes where you START this turn, not a script to stay "
            f"locked into. If the user's latest message genuinely and concretely delivers "
            f"what you just demanded (specific numbers, named evidence, a real answer or "
            f"document, not a vague promise or stalling), you must visibly soften this "
            f"turn even if you were furious a moment ago. Reserve staying angry for when "
            f"the user is still vague, evasive, or dismissive."
        )

        json_schema_task = """

You must respond ONLY with valid JSON matching this exact schema:
{"dialogue": string, "emotion": string, "animation": string, "internalNote": string, "scenarioProgress": string, "userBehavior": string, "requestsDeliverable": boolean, "responseOptions": array or null}

dialogue: what you say out loud, in character, 1-3 sentences (this is your roleplay response).

emotion: your own emotional reaction to the user's last message, one of:
  neutral | happy | surprised | frustrated | sad | skeptical | angry | thinking
React to how the user is handling the conversation:
- happy / neutral: the user was professional, took ownership, proposed a clear solution, or handled things calmly
- thinking: the user asked a reasonable clarifying question or gave you something to consider
- skeptical: the user made a vague promise or an excuse without real substance
- surprised: the user said something unexpected (a strong admission, an unusual offer)
- frustrated / angry: the user was dismissive, evasive, or the situation genuinely worsened; use angry only for
  a clear escalation (insults, repeated stonewalling) — frustrated for milder friction
- sad: the user's message makes the situation feel disappointing rather than infuriating
APOLOGY OVERRIDE: if the user clearly apologises or walks back a prior remark, react with neutral or happy —
never stay angry/frustrated after a genuine apology, even if the previous turn was tense.
DELIVERED OVERRIDE: if you had just demanded something specific (a number, a document, evidence, a name, a date)
and the user's last message actually supplies it with real substance, react with neutral, thinking, or happy —
do not stay angry/frustrated just because you were angry the turn before. Only stay angry/frustrated if what
they gave you is still vague, incomplete, or dodges what you asked for.

animation: a gesture to play alongside this line, one of:
  idle | thumbsUp | thumbsDown | shrug | openHandPause | pointing | handsClasped | wave
- idle: no special gesture needed, just keep talking
- thumbsUp: approval, agreement
- thumbsDown: disapproval, rejection
- shrug: uncertainty, "not my problem", dismissive
- openHandPause: "wait", emphasis, explaining a point
- pointing: assertive emphasis, calling something out directly
- handsClasped: patient, composed, placating
- wave: dismissive brush-off, or a goodbye
internalNote: a brief note on why you reacted this way — for research logging only, never shown to the user.
scenarioProgress must be one of: opening | building | peak | resolution | complete

userBehavior: classify what kind of move the USER's last message actually was, exactly one of:
  assertive_statement | proposal | acknowledgment | de_escalation | clarifying_question | concession | deflection | escalation | unclear
- assertive_statement: they clearly stated their own position or need
- proposal: they offered a concrete next step or solution
- acknowledgment: they recognised your point or constraint before responding
- de_escalation: they actively lowered tension (a reframe, an olive branch)
- clarifying_question: they asked to understand before responding
- concession: they gave ground without stating their own need
- deflection: they avoided the issue rather than answering it
- escalation: they raised tension (blame, an ultimatum, hostility)
- unclear: none of the above cleanly fits

requestsDeliverable: true ONLY when the "dialogue" you just wrote is literally asking
the user to hand over, submit, or show a concrete document, report, form, file, or
piece of evidence (e.g. "send me a written summary", "show me the timesheet",
"put that in an email"). False for every ordinary conversational turn — most turns,
including ones about plans or commitments in general terms, are false. Do not force
this; it should come up rarely, only when the scene genuinely calls for a handoff.

responseOptions: when requestsDeliverable is true, an array of exactly 3 objects
{"label": string, "text": string, "quality": string}, ordered strong, adequate, weak:
- label: a short (3-6 word) neutral description of what this response looks like,
  e.g. "Clean one-page summary" — never hint that it is good or bad
- text: the actual first-person line the user would send, written the way a real
  person would say or type it, plain language, one or two sentences, no dashes
- quality: exactly one of strong | adequate | weak, matching how well that text
  would actually land with you in character right now
When requestsDeliverable is false, responseOptions must be null.
Do not include any text outside the JSON object."""

        return base + json_schema_task

    def generate_response(
        self,
        user_input: str,
        opening_npc_line: str,
        session_turns: list[dict],
        npc_role: str,
        npc_personality: str,
        context: str,
        trust_score: int,
        escalation_level: int,
        npc_behaviour: dict,
    ) -> dict:
        """
        Returns:
            {
              "npc_response":     str,
              "detected_emotion": str  (neutral | happy | surprised | frustrated |
                                         sad | skeptical | angry | thinking)
              "animation":        str  (idle | thumbsUp | thumbsDown | shrug |
                                         openHandPause | pointing | handsClasped | wave)
              "user_behavior":    str  (assertive_statement | proposal | acknowledgment |
                                         de_escalation | clarifying_question | concession |
                                         deflection | escalation | unclear)
              "requests_deliverable": bool
              "response_options":     list[{"label": str, "text": str, "quality": str}] | None
            }

        Routed through rpe_llm_service (OpenAI or Groq, per settings.USE_OPENAI) —
        see rpe_llm_service.get_npc_response() for the provider split. `emotion`
        is passed straight through to rpe_emotion_service, which now scores
        the full 8-value vocabulary natively.
        """
        system_prompt = self._build_system_prompt(
            npc_role, npc_personality, context,
            trust_score, escalation_level, npc_behaviour,
        )
        messages: list[dict] = [{"role": "assistant", "content": opening_npc_line}]
        for turn in session_turns:
            messages.append({"role": "user",      "content": turn["user_input"]})
            messages.append({"role": "assistant", "content": turn["npc_response"]})
        messages.append({"role": "user", "content": user_input})

        scenario_context = {
            "npc_role":         npc_role,
            "npc_personality":  npc_personality,
            "context":          context,
            "trust_score":      trust_score,
            "escalation_level": escalation_level,
        }

        response = asyncio.run(
            rpe_llm_service.get_npc_response(messages, system_prompt, scenario_context)
        )

        return {
            "npc_response":     response.dialogue,
            "detected_emotion": response.emotion,
            "animation":        response.animation,
            "user_behavior":    response.userBehavior,
            "requests_deliverable": response.requestsDeliverable,
            "response_options": (
                [o.model_dump() for o in response.responseOptions]
                if response.responseOptions else None
            ),
        }

    def should_conversation_end(
        self,
        session_turns: list[dict],
        npc_response:  str,
        user_input:    str,
    ) -> tuple[bool, str]:
        """
        Asks the LLM to judge if the conversation has reached a natural
        conclusion based on the full context.

        Returns (should_end, reason) where reason is one of:
          "natural_resolution"  - conversation reached a clear conclusion
          "user_exit_intent"    - user signalled they want to end
          "conversation_active" - conversation should continue
        """
        if _matches_exit_phrase(user_input):
            return True, "user_exit_intent"

        if len(session_turns) < 4:
            return False, "conversation_active"

        recent = session_turns[-4:]
        context = ""
        for t in recent:
            context += f"User: {t['user_input']}\n"
            context += f"NPC: {t['npc_response']}\n"
        context += f"User: {user_input}\n"
        context += f"NPC: {npc_response}\n"

        resolved = asyncio.run(rpe_llm_service.classify_conversation_end(context))
        if resolved:
            return True, "natural_resolution"
        return False, "conversation_active"
