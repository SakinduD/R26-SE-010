"""
LLM scorer for MCA live sessions. Never raises: any failure returns None so
the caller falls back to the rule-based score.
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

# Local debug log of LLM prompts and responses (safe to delete).
_TEMP_LOG_PATH = Path(__file__).resolve().parents[2] / "scratch" / "mca_live_llm_log.txt"


def _append_temp_log(label: str, content: str) -> None:
    try:
        _TEMP_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _TEMP_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(f"\n----- {label} @ {datetime.now(timezone.utc).isoformat()} -----\n")
            f.write(content)
            f.write("\n")
    except OSError as exc:
        logger.warning("Could not write MCA live-scorer temp log: %s", exc)

_REQUIRED_DIMENSIONS = (
    "vocal_command",
    "speech_fluency",
    "presence_engagement",
    "emotional_regulation",
)

_SYSTEM_INSTRUCTION = (
    "You are the EmpowerZ live-session communication scorer. You are given a "
    "chronological timeline of a live conversation, every line tagged with "
    "the elapsed seconds since the session started:\n"
    "- LEARNER / OTHER PARTICIPANT: transcribed speech.\n"
    "- BEHAVIOR: every issue the voice/video analysis detected, in ~3 s "
    "audio chunks, merged into time spans (e.g. t=30-42s means it lasted "
    "about 12 s). This is the complete record and is not rate-limited. Use "
    "it as the main evidence of how often and how long each behavior "
    "happened.\n"
    "- NUDGE: the user's current behavior actually shown on screen. Usually at most one "
    "appears every 10 s (a more severe issue can appear sooner), so they "
    "undercount behavior; use them to judge whether the "
    "learner responded to feedback (did the BEHAVIOR stop after the NUDGE?).\n"
    "Read BEHAVIOR spans together with the transcript around the same time "
    "to judge whether an issue was sustained or isolated, instead of just "
    "counting lines. All BEHAVIOR and NUDGE lines describe the learner only. "
    "While the other participant is speaking, ignore 'Take your time! Pauses "
    "help gather ideas.' lines, as silence from the learner is expected then.\n\n"
    "You also get the learner's detected voice emotion: EMOTION lines in the "
    "timeline (logged whenever it changes, with model confidence) and a "
    "share-of-time summary for the whole session. These come from a speech "
    "emotion model on the learner's microphone only. Use them mainly for "
    "emotional_regulation, and as supporting evidence for vocal_command and "
    "presence_engagement. Treat them as noisy signals: read them together "
    "with the transcript around the same time, give low-confidence or "
    "very brief readings little weight, and look for patterns (e.g. the "
    "learner turning anxious when challenged, then recovering).\n\n"
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
        emotion_distribution: Optional[dict[str, float]] = None,
        emotion_timeline: Optional[list[dict]] = None,
        behavior_log: Optional[list[dict]] = None,
    ) -> Optional[dict[str, Any]]:
        if not self.model:
            return None
        if not user_transcript and not meeting_transcript:
            # No speech captured, nothing for the LLM to judge.
            return None

        prompt = _build_prompt(
            nudge_log,
            user_transcript,
            meeting_transcript,
            duration_seconds,
            emotion_distribution or {},
            emotion_timeline or [],
            behavior_log or [],
        )

        _append_temp_log("PROMPT", prompt)

        try:
            response = self.model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                ),
            )
            _append_temp_log("RESPONSE", response.text)
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
    emotion_distribution: dict[str, float],
    emotion_timeline: list[dict],
    behavior_log: list[dict],
) -> str:
    events: list[tuple[float, str]] = []

    for seg in user_transcript:
        events.append((_elapsed(seg), f"[t={_elapsed(seg):.0f}s] LEARNER: {seg.get('text', '')}"))
    for seg in meeting_transcript:
        events.append((_elapsed(seg), f"[t={_elapsed(seg):.0f}s] OTHER PARTICIPANT: {seg.get('text', '')}"))
    for span in _merge_behavior_spans(behavior_log):
        events.append((span["start"], span["line"]))
    for nudge in nudge_log:
        t = _elapsed(nudge)
        events.append((
            t,
            f"[t={t:.0f}s] NUDGE shown ({nudge.get('severity', 'info')}/{nudge.get('category', '')}): "
            f"{nudge.get('message', '')}",
        ))
    for emo in emotion_timeline:
        t = _elapsed(emo)
        confidence = emo.get("confidence")
        conf_text = f" ({confidence * 100:.0f}% confidence)" if isinstance(confidence, (int, float)) else ""
        events.append((t, f"[t={t:.0f}s] EMOTION: {emo.get('emotion', 'unknown')}{conf_text}"))

    # Stable sort keeps speech before an emotion logged in the same second.
    events.sort(key=lambda e: e[0])
    timeline = "\n".join(text for _, text in events) or "(no events captured)"

    if emotion_distribution:
        shares = sorted(emotion_distribution.items(), key=lambda kv: kv[1], reverse=True)
        emotion_summary = ", ".join(f"{emo} {share * 100:.0f}%" for emo, share in shares)
    else:
        emotion_summary = "(not captured)"

    return (
        f"Session duration: {duration_seconds}s (~{duration_seconds / 60:.1f} min).\n\n"
        f"Learner's voice emotion, share of session time: {emotion_summary}\n\n"
        f"Chronological session timeline:\n{timeline}\n\n"
        "Score the learner now, following the rubric and JSON format from your instructions."
    )


_CHUNK_SECONDS = 3.0      # length of one analysed audio chunk
_SPAN_GAP_SECONDS = 4.5   # detections closer than this belong to one span


def _merge_behavior_spans(behavior_log: list[dict]) -> list[dict]:
    """Merge per-chunk detections of the same behavior into time spans."""
    by_message: dict[str, list[dict]] = {}
    for item in behavior_log:
        by_message.setdefault(item.get("message", ""), []).append(item)

    spans: list[dict] = []
    for message, items in by_message.items():
        items.sort(key=_elapsed)
        first = items[0]
        start = last = _elapsed(first)
        count = 1
        for item in items[1:] + [None]:
            t = _elapsed(item) if item else None
            if t is not None and t - last <= _SPAN_GAP_SECONDS:
                last, count = t, count + 1
                continue
            end = last + _CHUNK_SECONDS
            when = f"t={start:.0f}-{end:.0f}s" if count > 1 else f"t={start:.0f}s"
            spans.append({
                "start": start,
                "line": (
                    f"[{when}] BEHAVIOR ({first.get('severity', 'info')}/{first.get('category', '')}): "
                    f"{message}"
                ),
            })
            if t is not None:
                start = last = t
                count = 1
    return spans


def _elapsed(item: dict) -> float:
    try:
        return float(item.get("elapsed_seconds") or 0.0)
    except (TypeError, ValueError):
        return 0.0


mca_live_scorer = MCALiveScorer()
