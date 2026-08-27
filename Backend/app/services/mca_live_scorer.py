"""
LLM-based scorer for MCA *live* sessions.

Uses the same legacy `google.generativeai` SDK as baseline_llm.py / MCA chat.
Never raises: any failure (no API key, bad response, network error) returns
None so the caller can fall back to the rule-based score — a live session
must never fail to produce a result over an LLM hiccup.
"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import google.generativeai as genai

from app.api.v1.mca.scoring import clamp, combine_breakdown_to_overall
from app.config import get_settings

logger = logging.getLogger("uvicorn")

_settings = get_settings()

# Temp visibility log: every prompt sent to (and response received from) the
# live-session LLM scorer, appended here for local debugging. Not persisted
# anywhere durable — safe to delete at any time.
_TEMP_LOG_PATH = Path(__file__).resolve().parents[2] / "scratch" / "mca_live_llm_log.txt"

# remove comments
# def _append_temp_log(label: str, content: str) -> None:
#     try:
#         _TEMP_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
#         with _TEMP_LOG_PATH.open("a", encoding="utf-8") as f:
#             f.write(f"\n----- {label} @ {datetime.now(timezone.utc).isoformat()} -----\n")
#             f.write(content)
#             f.write("\n")
#     except OSError as exc:
#         logger.warning("Could not write MCA live-scorer temp log: %s", exc)

_REQUIRED_DIMENSIONS = (
    "vocal_command",
    "speech_fluency",
    "presence_engagement",
    "emotional_regulation",
)

_SYSTEM_INSTRUCTION = (
    "You are the EmpowerZ live-session communication scorer. You are given a "
    "transcript of a live conversation (the learner and the other meeting "
    "participant, each utterance tagged with who said it and the elapsed "
    "seconds since the session started) plus the log of real-time coaching "
    "nudges the learner was shown during the session (also tagged with "
    "elapsed seconds, a category, and a severity). Nudges fire automatically "
    "from voice/video signals (e.g. speaking pace, filler words, eye "
    "contact, vocal tone) — use the transcript around each nudge's timestamp "
    "to judge whether the underlying behavior actually persisted or was "
    "isolated, and weigh that into your scoring instead of just counting "
    "nudges.\n\n"
    "Score the learner (never the other participant) on exactly these four "
    "dimensions, each 0-100:\n"
    "- vocal_command: clarity, volume, pitch control, and directness of "
    "their speech (Mehrabian vocal channel).\n"
    "- speech_fluency: pacing and absence of excessive pauses/filler words "
    "(Goldman-Eisler fluency).\n"
    "- presence_engagement: attentiveness, non-verbal presence, and how "
    "well their vocal delivery matches an engaged, present speaker.\n"
    "- emotional_regulation: how positive/composed vs. negative/agitated "
    "their affect was (Russell's valence axis) — 100 = sustained positive "
    "composure, 50 = neutral, 0 = sustained negative affect.\n\n"
    "Respond with strict JSON only, no markdown fences, matching exactly: "
    '{"vocal_command": <int 0-100>, "speech_fluency": <int 0-100>, '
    '"presence_engagement": <int 0-100>, "emotional_regulation": <int 0-100>, '
    '"rationale": "<one or two sentence explanation>"}. '
    "If the transcript is too short or sparse to judge a dimension "
    "confidently, use 50 (neutral) for it rather than guessing."
)


class MCALiveScorer:
    def __init__(self) -> None:
        if _settings.gemini_api_key:
            genai.configure(api_key=_settings.gemini_api_key)
            self.model = genai.GenerativeModel(
                model_name="gemini-3.1-flash-lite-preview",
                system_instruction=_SYSTEM_INSTRUCTION,
            )
        else:
            self.model = None

    def score(
        self,
        nudge_log: list[dict],
        user_transcript: list[dict],
        meeting_transcript: list[dict],
        duration_seconds: int,
    ) -> Optional[dict[str, Any]]:
        if not self.model:
            return None
        if not user_transcript and not meeting_transcript:
            # Nothing was captured (e.g. user declined mic/meeting-audio
            # transcription) — no basis for an LLM judgement.
            return None

        prompt = _build_prompt(nudge_log, user_transcript, meeting_transcript, duration_seconds)

        # Temp visibility log: the exact timeline text handed to the LLM.
        # _append_temp_log("PROMPT", prompt)

        try:
            response = self.model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                ),
            )
            # _append_temp_log("RESPONSE", response.text)
            data = json.loads(response.text)

            breakdown = {
                dim: clamp(float(data[dim])) for dim in _REQUIRED_DIMENSIONS
            }
            overall = combine_breakdown_to_overall(breakdown)

            return {
                "overall": overall,
                "breakdown": breakdown,
                "rationale": str(data.get("rationale", ""))[:500],
            }
        except Exception as exc:
            logger.warning("MCA live LLM scoring failed, falling back to rule-based: %s", exc)
            return None


def _build_prompt(
    nudge_log: list[dict],
    user_transcript: list[dict],
    meeting_transcript: list[dict],
    duration_seconds: int,
) -> str:
    events: list[tuple[float, str]] = []

    for seg in user_transcript:
        events.append((_elapsed(seg), f"[t={_elapsed(seg):.0f}s] LEARNER: {seg.get('text', '')}"))
    for seg in meeting_transcript:
        events.append((_elapsed(seg), f"[t={_elapsed(seg):.0f}s] OTHER PARTICIPANT: {seg.get('text', '')}"))
    for nudge in nudge_log:
        t = _elapsed(nudge)
        events.append((
            t,
            f"[t={t:.0f}s] NUDGE ({nudge.get('severity', 'info')}/{nudge.get('category', '')}): "
            f"{nudge.get('message', '')}",
        ))

    events.sort(key=lambda e: e[0])
    timeline = "\n".join(text for _, text in events) or "(no events captured)"

    return (
        f"Session duration: {duration_seconds}s (~{duration_seconds / 60:.1f} min).\n\n"
        f"Chronological session timeline:\n{timeline}\n\n"
        "Score the learner now, following the rubric and JSON format from your instructions."
    )


def _elapsed(item: dict) -> float:
    try:
        return float(item.get("elapsed_seconds") or 0.0)
    except (TypeError, ValueError):
        return 0.0


mca_live_scorer = MCALiveScorer()
