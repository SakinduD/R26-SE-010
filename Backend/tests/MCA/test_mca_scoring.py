import math

from app.api.v1.mca.scoring import (
    _affect_balance_score,
    _issue_tag,
    _laplace_score,
    calculate_session_metrics,
    clamp,
    combine_breakdown_to_overall,
)

_QUIET = {"category": "volume", "message": "A bit quiet. Projecting helps engagement."}
_FAST = {"category": "pace", "message": "Speaking rapidly. Pauses help listeners absorb points."}
_PAUSE = {"category": "silence", "message": "Take your time! Pauses help gather ideas."}
_AWAY = {"category": "fusion", "message": "Your voice is calm, but you are looking away from the audience."}
_MIXED = {"category": "fusion", "message": "You are displaying mixed signals: your tone sounds frustrated, but you are smiling widely."}
_MIC = {"category": "fusion", "message": "You appear to be speaking, but your audio signal is very weak. Please check your microphone."}

_DIMS = ("vocal_command", "speech_fluency", "presence_engagement", "emotional_regulation")


def _chunk(t, speaking=True, face=True, detections=(), emotion=None, confidence=None):
    return {
        "elapsed_seconds": t,
        "speaking": speaking,
        "face_visible": face,
        "emotion": emotion,
        "confidence": confidence,
        "detections": list(detections),
    }


def _score(observations, duration=None, **kwargs):
    duration = duration if duration is not None else 3 * len(observations)
    return calculate_session_metrics([], {}, duration_seconds=duration, observation_log=observations, **kwargs)


def test_issue_tags():
    assert _issue_tag(_QUIET) == "vocal"
    assert _issue_tag(_FAST) == "pace"
    assert _issue_tag(_PAUSE) == "silence"
    assert _issue_tag(_AWAY) == "presence"
    assert _issue_tag(_MIXED) == "congruence"
    assert _issue_tag(_MIC) == "technical"


def test_laplace_score():
    assert _laplace_score(0, 0) == 50.0          # no evidence -> neutral
    assert math.isclose(_laplace_score(10, 10), 100 * 11 / 12)
    assert math.isclose(_laplace_score(0, 10), 100 * 1 / 12)


def test_affect_balance_score():
    assert _affect_balance_score(0, 0, 0) == 50.0
    assert _affect_balance_score(0, 0, 50) == 50.0   # all neutral stays neutral
    assert _affect_balance_score(100, 0, 100) > 95
    assert _affect_balance_score(0, 100, 100) < 5


def test_clamp():
    assert clamp(105.0) == 100
    assert clamp(-5.0) == 0
    assert clamp(45.6) == 46
    assert clamp(45.4) == 45


def test_overall_is_unweighted_mean():
    assert combine_breakdown_to_overall(dict.fromkeys(_DIMS, 100)) == 100
    assert combine_breakdown_to_overall(dict.fromkeys(_DIMS, 50)) == 50
    assert combine_breakdown_to_overall({
        "vocal_command": 80, "speech_fluency": 60,
        "presence_engagement": 40, "emotional_regulation": 20,
    }) == 50


def test_empty_session_is_neutral_everywhere():
    # The session-quality filter relies on "nothing observed" -> all 50.
    for metrics in (
        calculate_session_metrics([], {}, duration_seconds=5),
        calculate_session_metrics([], {}, duration_seconds=600),
    ):
        assert all(v == 50 for v in metrics["breakdown"].values())
        assert metrics["overall"] == 50
        assert metrics["diagnostics"]["evidence_source"] == "none"


def test_clean_speaking_session_scores_high():
    metrics = _score([_chunk(3 * i, emotion="neutral", confidence=0.9) for i in range(40)])
    b = metrics["breakdown"]
    assert b["vocal_command"] >= 95
    assert b["speech_fluency"] >= 95
    assert b["presence_engagement"] >= 95
    assert b["emotional_regulation"] == 50   # neutral affect is neutral, not penalised
    assert metrics["diagnostics"]["max_opportunities"] == 40
    assert metrics["diagnostics"]["evidence_source"] == "observation_log"


def test_score_tracks_share_of_flagged_intervals():
    chunks = [_chunk(3 * i, detections=[_QUIET] if i % 2 else []) for i in range(40)]
    metrics = _score(chunks)
    assert metrics["breakdown"]["vocal_command"] == 50       # (20 + 1) / (40 + 2)
    assert metrics["diagnostics"]["obp_per_dimension"]["vocal"] == 0.5
    assert metrics["breakdown"]["speech_fluency"] >= 95       # other dimensions unaffected


def test_severity_is_not_a_measurement_weight():
    warning = _score([_chunk(3 * i, detections=[{**_QUIET, "severity": "warning"}]) for i in range(10)])
    info = _score([_chunk(3 * i, detections=[{**_QUIET, "severity": "info"}]) for i in range(10)])
    assert warning["breakdown"] == info["breakdown"]


def test_more_evidence_moves_further_from_neutral():
    short = _score([_chunk(3 * i) for i in range(3)])
    long = _score([_chunk(3 * i) for i in range(60)])
    assert 50 < short["breakdown"]["vocal_command"] < long["breakdown"]["vocal_command"]


def test_pause_inside_speech_is_a_hesitation_but_listening_is_not():
    # speak, pause, speak -> one hesitation
    within = _score([
        _chunk(0), _chunk(3, speaking=False, detections=[_PAUSE]), _chunk(6),
    ])
    assert within["diagnostics"]["observed_intervals"]["speech_fluency"] == 3
    assert within["diagnostics"]["obp_per_dimension"]["fluency"] == round(1 / 3, 4)

    # long quiet stretch (listening) between speech -> not counted
    listening = _score(
        [_chunk(0)]
        + [_chunk(3 * i, speaking=False, detections=[_PAUSE]) for i in range(1, 8)]
        + [_chunk(24)]
    )
    # only the pauses within 6 s of speech on both sides could count; none do
    assert listening["diagnostics"]["obp_per_dimension"]["fluency"] == 0.0


def test_no_face_is_missing_data_not_a_failure():
    metrics = _score([_chunk(3 * i, face=False) for i in range(20)])
    assert metrics["breakdown"]["presence_engagement"] == 50
    assert metrics["diagnostics"]["observed_intervals"]["presence_engagement"] == 0
    assert metrics["diagnostics"]["face_coverage"] == 0.0


def test_nonverbal_issues_lower_presence():
    chunks = [_chunk(3 * i, detections=[_AWAY] if i < 10 else [_MIXED] if i < 15 else []) for i in range(20)]
    metrics = _score(chunks)
    obp = metrics["diagnostics"]["obp_per_dimension"]
    assert obp["presence"] == 0.5
    assert obp["congruence"] == 0.25
    assert metrics["breakdown"]["presence_engagement"] == clamp(100 * 6 / 22)


def test_mic_failure_is_not_scored_as_a_skill():
    metrics = _score([_chunk(3 * i, speaking=False, detections=[_MIC]) for i in range(10)])
    assert all(v == 50 for v in metrics["breakdown"].values())
    assert metrics["diagnostics"]["technical_intervals"] == 10


def test_emotion_is_confidence_weighted_affect_balance():
    sure = _score([_chunk(3 * i, emotion="angry", confidence=1.0) for i in range(20)])
    unsure = _score([_chunk(3 * i, emotion="angry", confidence=0.3) for i in range(20)])
    happy = _score([_chunk(3 * i, emotion="happy", confidence=1.0) for i in range(20)])
    assert sure["breakdown"]["emotional_regulation"] < unsure["breakdown"]["emotional_regulation"] < 50
    assert happy["breakdown"]["emotional_regulation"] > 90
    assert sure["diagnostics"]["emotion_valence_raw"] == -1.0


def test_legacy_clients_without_observation_log():
    # Older clients only send the nudge log + emotion distribution.
    nudge_log = [
        {"category": "volume", "severity": "critical", "message": "Too quiet"},
        {"category": "pace", "severity": "info", "message": "Speaking rapidly"},
        {"category": "fusion", "severity": "warning", "message": "look at audience"},
    ]
    metrics = calculate_session_metrics(nudge_log, {"happy": 0.5, "neutral": 0.5}, duration_seconds=300)
    d = metrics["diagnostics"]
    assert d["evidence_source"] == "nudge_log"
    assert d["max_opportunities"] == 100
    assert d["session_minutes"] == 5.0
    assert d["emotion_valence_raw"] == 0.5
    assert 70 < metrics["breakdown"]["emotional_regulation"] < 80
    assert set(metrics["breakdown"]) == set(_DIMS)


def test_legacy_behavior_log_groups_detections_by_chunk():
    behavior_log = [
        {**_QUIET, "severity": "warning", "elapsed_seconds": 30},
        {**_FAST, "severity": "info", "elapsed_seconds": 30},
        {**_QUIET, "severity": "warning", "elapsed_seconds": 33},
    ]
    metrics = calculate_session_metrics([], {"neutral": 1.0}, duration_seconds=60, behavior_log=behavior_log)
    d = metrics["diagnostics"]
    assert d["evidence_source"] == "behavior_log"
    assert d["max_opportunities"] == 20
    assert d["obp_per_dimension"]["vocal"] == 0.1


def test_output_shape_is_unchanged():
    metrics = _score([_chunk(0)])
    assert set(metrics) == {"overall", "breakdown", "diagnostics"}
    assert set(metrics["breakdown"]) == set(_DIMS)
    assert all(isinstance(v, int) for v in metrics["breakdown"].values())
    assert isinstance(metrics["overall"], int)
    for key in ("obp_per_dimension", "max_opportunities", "emotion_valence_raw", "session_minutes"):
        assert key in metrics["diagnostics"]
