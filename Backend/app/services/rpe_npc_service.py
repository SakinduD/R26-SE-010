from app.config import get_settings

_VALID_EMOTIONS = {"calm", "assertive", "anxious", "frustrated", "confused"}


class RpeNpcService:
    def __init__(self) -> None:
        api_key = get_settings().groq_api_key
        if api_key:
            from groq import Groq
            self._client = Groq(api_key=api_key)
        else:
            self._client = None

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
            escalation_tone = "You are furious. Issue ultimatums. Use short sharp sentences only."
        elif escalation_level >= escalation_thresholds["irritated"]:
            escalation_tone = "You are visibly irritated. No pleasantries whatsoever."
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
            f"- Your tone must reflect the trust and escalation state above."
        )

        emotion_task = """

EMOTION CLASSIFICATION TASK:
After your roleplay response, on a new line, output exactly:
EMOTION: [label]

Classify the LAST USER MESSAGE emotion using these rules:
- assertive: professional commitment, proposal, solution,
             delivering on time, taking ownership, pushback
             with reason, setting boundaries professionally
- calm:      clarification, acceptance, understanding,
             agreement, explaining calmly, correcting
             a misunderstanding, "i mean", "to clarify"
- anxious:   worry, fear, uncertainty, nervousness,
             "i am not sure", "what if", "i am afraid"
- frustrated: anger, insults, profanity, emotional complaints,
              "this is unfair", "i hate", "this is stupid"
              NOTE: professional disagreement is NOT frustrated
- confused:  requests for information, uncertainty about
             task requirements, "i don't understand what"

APOLOGY AND RECOVERY OVERRIDE (highest priority after profanity):
If the user's message contains any of these signals -> ALWAYS return calm:
- Explicit apology: "sorry", "i apologize", "i apologise",
  "my bad", "forgive me", "i did not mean", "i take that back",
  "that was wrong of me", "i regret"
- Recovery from joke: "was just joking", "it was a joke",
  "just kidding", "i got carried away", "joke got to me",
  "heading me up", "got to my head", "i did not mean it"
- Self-correction: "i take back", "scratch that", "ignore that",
  "let me rephrase", "what i meant was"
This overrides conversation history — even if previous turn was
an insult, a genuine apology in the current turn = calm.

IMPORTANT RULES FOR CLASSIFICATION:
- Short delivery commitments ("no delay", "on time", "will deliver")
  -> assertive
- Clarification phrases ("i mean", "i means", "from my side")
  -> calm
- Professional pushback with reasoning -> assertive NOT frustrated
- Non-native English compressed phrases -> interpret the INTENT
- Only use frustrated for genuine anger or insults

Your full output format:
[Your 1-3 sentence roleplay response here]
EMOTION: [one of: calm, assertive, anxious, frustrated, confused]"""

        return base + emotion_task

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
              "detected_emotion": str  (calm | assertive | anxious | frustrated | confused)
            }
        """
        if not self._client:
            return {
                "npc_response":     "NPC service unavailable: GROQ_API_KEY is not configured.",
                "detected_emotion": "calm",
            }

        system_prompt = self._build_system_prompt(
            npc_role, npc_personality, context,
            trust_score, escalation_level, npc_behaviour,
        )
        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        messages.append({"role": "assistant", "content": opening_npc_line})
        for turn in session_turns:
            messages.append({"role": "user",      "content": turn["user_input"]})
            messages.append({"role": "assistant", "content": turn["npc_response"]})
        messages.append({"role": "user", "content": user_input})

        try:
            response = self._client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                max_tokens=200,
            )
            raw   = response.choices[0].message.content.strip()
            lines = raw.split("\n")

            emotion   = "calm"
            npc_lines: list[str] = []
            for line in lines:
                stripped = line.strip()
                if stripped.upper().startswith("EMOTION:"):
                    label   = stripped.split(":", 1)[1].strip().lower()
                    emotion = label if label in _VALID_EMOTIONS else "calm"
                else:
                    npc_lines.append(line)

            return {
                "npc_response":     "\n".join(npc_lines).strip(),
                "detected_emotion": emotion,
            }
        except Exception as exc:
            return {
                "npc_response":     f"[NPC temporarily unavailable: {exc}]",
                "detected_emotion": "calm",
            }
