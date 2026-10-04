"""Unit tests for the LLM live-session scorer. The Gemini model is always mocked.

Contract under test: score() returns a valid result or None, and never raises.
None tells the session endpoint to fall back to rule-based scoring.
"""
import json
from unittest.mock import MagicMock, patch

import pytest

from app.services.mca_live_scorer import MCALiveScorer, _build_prompt, _merge_behavior_spans

pytestmark = pytest.mark.unit

_TRANSCRIPT = [{"text": "Hello everyone, today I'll present our results.", "elapsed_seconds": 2}]


@pytest.fixture(autouse=True)
def _no_debug_log():
    # The scorer appends prompts to a local debug file; keep tests side-effect free.
    with patch("app.services.mca_live_scorer._append_temp_log"):
        yield


def _scorer(response_text=None, side_effect=None) -> MCALiveScorer:
    scorer = MCALiveScorer.__new__(MCALiveScorer)
    scorer.model = MagicMock()
    if side_effect is not None:
        scorer.model.generate_content.side_effect = side_effect
    else:
        scorer.model.generate_content.return_value = MagicMock(text=response_text)
    return scorer


def _score(scorer, **overrides):
    kwargs = dict(nudge_log=[], user_transcript=_TRANSCRIPT, meeting_transcript=[], duration_seconds=60)
    kwargs.update(overrides)
    return scorer.score(**kwargs)


def _llm_json(**overrides):
    data = {
        "vocal_command": 80, "speech_fluency": 70,
        "presence_engagement": 60, "emotional_regulation": 90,
        "rationale": "Clear and composed.",
    }
    data.update(overrides)
    return json.dumps(data)


class TestLiveScorerPositive:
    def test_valid_llm_response_is_parsed(self):
        result = _score(_scorer(_llm_json()))
        assert result["breakdown"] == {
            "vocal_command": 80, "speech_fluency": 70,
            "presence_engagement": 60, "emotional_regulation": 90,
        }
        assert result["overall"] == 75  # computed locally, not by the LLM
        assert result["rationale"] == "Clear and composed."

    def test_meeting_transcript_alone_is_enough(self):
        result = _score(_scorer(_llm_json()), user_transcript=[],
                        meeting_transcript=[{"text": "Any questions?", "elapsed_seconds": 5}])
        assert result is not None

    def test_float_scores_are_rounded(self):
        result = _score(_scorer(_llm_json(vocal_command=79.6)))
        assert result["breakdown"]["vocal_command"] == 80

    def test_missing_rationale_becomes_empty_string(self):
        data = json.loads(_llm_json())
        del data["rationale"]
        assert _score(_scorer(json.dumps(data)))["rationale"] == ""


class TestLiveScorerNegative:
    def test_no_api_key_returns_none(self):
        # NEGATIVE: with no Gemini key there is no model. The scorer must
        # return None so the endpoint uses the rule-based fallback.
        scorer = MCALiveScorer.__new__(MCALiveScorer)
        scorer.model = None
        assert _score(scorer) is None

    def test_no_speech_captured_returns_none_without_calling_llm(self):
        # NEGATIVE: with no transcript there is nothing for the LLM to judge,
        # and paying for a call would only produce a guess.
        scorer = _scorer(_llm_json())
        assert _score(scorer, user_transcript=[], meeting_transcript=[]) is None
        scorer.model.generate_content.assert_not_called()

    def test_invalid_json_returns_none(self):
        # NEGATIVE: the LLM returned prose / markdown instead of strict JSON.
        assert _score(_scorer("Sure! Here are the scores: ...")) is None

    def test_missing_dimension_returns_none(self):
        # NEGATIVE: the response lacks a required skill, so a partial result
        # can't produce a valid overall score. Fall back instead.
        data = json.loads(_llm_json())
        del data["speech_fluency"]
        assert _score(_scorer(json.dumps(data))) is None

    def test_non_numeric_score_returns_none(self):
        # NEGATIVE: "high" is not a score. Accepting it would corrupt the stored result.
        assert _score(_scorer(_llm_json(vocal_command="high"))) is None

    def test_out_of_range_scores_are_clamped(self):
        # NEGATIVE: the LLM ignored the 0-100 rubric. Values are clamped
        # so a hallucinated 150 or -20 can't leak into analytics.
        result = _score(_scorer(_llm_json(vocal_command=150, speech_fluency=-20)))
        assert result["breakdown"]["vocal_command"] == 100
        assert result["breakdown"]["speech_fluency"] == 0

    def test_api_exception_returns_none(self):
        # NEGATIVE: network error / quota exceeded at Gemini. The scorer
        # contract says it never raises.
        assert _score(_scorer(side_effect=RuntimeError("quota exceeded"))) is None

    def test_overlong_rationale_is_truncated(self):
        # NEGATIVE: an unbounded rationale would bloat the DB row; it's capped at 500 chars.
        result = _score(_scorer(_llm_json(rationale="x" * 2000)))
        assert len(result["rationale"]) == 500


class TestBuildPromptPositive:
    def test_events_are_in_chronological_order(self):
        prompt = _build_prompt(
            nudge_log=[{"message": "Slow down", "category": "pace", "severity": "info", "elapsed_seconds": 20}],
            user_transcript=[{"text": "Second", "elapsed_seconds": 10}, {"text": "First", "elapsed_seconds": 1}],
            meeting_transcript=[{"text": "Question?", "elapsed_seconds": 15}],
            duration_seconds=120,
            emotion_distribution={"neutral": 0.7, "happy": 0.3},
            emotion_timeline=[{"emotion": "happy", "confidence": 0.82, "elapsed_seconds": 12}],
            behavior_log=[],
        )
        order = [prompt.index(s) for s in ("LEARNER: First", "LEARNER: Second", "EMOTION: happy (82% confidence)",
                                           "OTHER PARTICIPANT: Question?", "NUDGE shown (info/pace)")]
        assert order == sorted(order)
        assert "neutral 70%, happy 30%" in prompt
        assert "Session duration: 120s (~2.0 min)" in prompt

    def test_different_behaviours_get_separate_spans(self):
        spans = _merge_behavior_spans([
            {"message": "Quiet", "category": "volume", "severity": "warning", "elapsed_seconds": 3},
            {"message": "Fast", "category": "pace", "severity": "info", "elapsed_seconds": 3},
        ])
        assert len(spans) == 2


class TestBuildPromptNegative:
    def test_empty_session_has_placeholders(self):
        # NEGATIVE: no events and no emotion data. The prompt must say so
        # explicitly instead of leaving empty sections the LLM might fill in.
        prompt = _build_prompt([], [], [], 0, {}, [], [])
        assert "(no events captured)" in prompt
        assert "(not captured)" in prompt

    def test_emotion_without_confidence_has_no_percentage(self):
        # NEGATIVE: confidence is missing or non-numeric, so no fake "% confidence" is shown.
        prompt = _build_prompt([], [], [], 10, {}, [{"emotion": "sad", "confidence": "n/a", "elapsed_seconds": 1}], [])
        assert "EMOTION: sad\n" in prompt + "\n"
        assert "confidence)" not in prompt

    def test_empty_behaviour_log_gives_no_spans(self):
        # NEGATIVE: nothing detected means no BEHAVIOR lines at all.
        assert _merge_behavior_spans([]) == []
