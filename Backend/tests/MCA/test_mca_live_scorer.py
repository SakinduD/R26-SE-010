from app.services.mca_live_scorer import _build_prompt, _merge_behavior_spans

_QUIET = "A bit quiet. Projecting helps engagement."


def _det(t, message=_QUIET, category="volume", severity="warning"):
    return {"message": message, "category": category, "severity": severity, "elapsed_seconds": t}


def test_consecutive_chunks_merge_into_one_span():
    spans = _merge_behavior_spans([_det(30), _det(33), _det(36)])
    assert [s["line"] for s in spans] == [f"[t=30-39s] BEHAVIOR (warning/volume): {_QUIET}"]


def test_gap_splits_spans_and_single_chunk_has_no_range():
    spans = _merge_behavior_spans([_det(30), _det(33), _det(60)])
    assert [s["line"] for s in spans] == [
        f"[t=30-36s] BEHAVIOR (warning/volume): {_QUIET}",
        f"[t=60s] BEHAVIOR (warning/volume): {_QUIET}",
    ]


def test_prompt_includes_behaviors_hidden_by_nudge_cooldown():
    # Only one nudge was shown (cooldown), but the behaviour lasted 12 s.
    prompt = _build_prompt(
        nudge_log=[{"message": _QUIET, "category": "volume", "severity": "warning", "elapsed_seconds": 30}],
        user_transcript=[{"text": "Hello team.", "elapsed_seconds": 29}],
        meeting_transcript=[],
        duration_seconds=60,
        emotion_distribution={},
        emotion_timeline=[],
        behavior_log=[_det(30), _det(33), _det(36), _det(39)],
    )
    assert f"[t=30-42s] BEHAVIOR (warning/volume): {_QUIET}" in prompt
    assert f"[t=30s] NUDGE shown (warning/volume): {_QUIET}" in prompt
