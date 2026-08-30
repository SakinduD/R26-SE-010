import pytest
import math
from app.api.v1.mca.scoring import (
    _resolve_dimension,
    _logistic_score,
    _emotion_valence_score,
    clamp,
    combine_breakdown_to_overall,
    _log_duration_correction,
    calculate_session_metrics
)

def test_resolve_dimension():
    assert _resolve_dimension({"category": "volume"}) == "vocal"
    assert _resolve_dimension({"category": "pace"}) == "fluency"
    assert _resolve_dimension({"category": "fusion", "message": "look at the audience"}) == "presence"
    assert _resolve_dimension({"category": "fusion", "message": "mixed signals"}) == "congruence"

def test_logistic_score():
    # Test midpoint
    score = _logistic_score(brm=0.333, k=12.0, threshold=0.333)
    assert math.isclose(score, 50.0, abs_tol=0.1)
    
    # Test brm = 0
    score_perfect = _logistic_score(brm=0, k=12.0, threshold=0.333)
    assert score_perfect > 95.0
    
    # Test brm >> threshold
    score_bad = _logistic_score(brm=1.0, k=12.0, threshold=0.333)
    assert score_bad < 5.0

def test_emotion_valence_score():
    # Only happy
    assert _emotion_valence_score({"happy": 1.0}) == 90.0 # (0.8 + 1) * 50 = 90
    
    # Only angry
    assert _emotion_valence_score({"angry": 1.0}) == 0.0 # (-1.0 + 1) * 50 = 0
    
    # Neutral
    assert _emotion_valence_score({"neutral": 1.0}) == 50.0 # (0.0 + 1) * 50 = 50
    
    # Empty distribution
    assert _emotion_valence_score({}) == 50.0

def test_clamp():
    assert clamp(105.0) == 100
    assert clamp(-5.0) == 0
    assert clamp(45.6) == 46
    assert clamp(45.4) == 45

def test_combine_breakdown_to_overall():
    # _DIMENSION_WEIGHTS = { "presence_engagement": 0.40, "vocal_command": 0.28, "emotional_regulation": 0.22, "speech_fluency": 0.10 }
    breakdown = {
        "presence_engagement": 100,
        "vocal_command": 100,
        "emotional_regulation": 100,
        "speech_fluency": 100
    }
    assert combine_breakdown_to_overall(breakdown) == 100
    
    breakdown_mixed = {
        "presence_engagement": 50, # 20
        "vocal_command": 50,       # 14
        "emotional_regulation": 50,# 11
        "speech_fluency": 50       # 5
    }
    assert combine_breakdown_to_overall(breakdown_mixed) == 50

def test_log_duration_correction():
    # if max_opportunities >= 30, it returns raw_score
    assert _log_duration_correction(90.0, 30.0) == 90.0
    
    # if max_opportunities < 30, it shrinks toward 50
    # At very few opportunities (e.g. 1), the score should be closer to 50
    corrected = _log_duration_correction(100.0, 1.0)
    assert corrected < 100.0 and corrected > 50.0
    
    # At 0 opportunities (which max_opportunities won't realistically hit because of max(1.0, ...), but for math)
    assert _log_duration_correction(100.0, 0.0) == 50.0

def test_calculate_session_metrics():
    nudge_log = [
        {"category": "volume", "severity": "critical", "message": "Too quiet"},
        {"category": "pace", "severity": "info", "message": "Speaking rapidly"},
        {"category": "fusion", "severity": "warning", "message": "look at audience"}
    ]
    emotion_distribution = {"happy": 0.5, "neutral": 0.5} # valence = 0.5*0.8 + 0.5*0 = 0.4 -> (1.4)*50 = 70
    
    # 5 minutes -> 300 seconds (30 slots)
    metrics = calculate_session_metrics(nudge_log, emotion_distribution, duration_seconds=300)
    
    assert "overall" in metrics
    assert "breakdown" in metrics
    assert "diagnostics" in metrics
    
    assert metrics["breakdown"]["emotional_regulation"] == 70
    assert metrics["diagnostics"]["session_minutes"] == 5.0
    assert metrics["diagnostics"]["max_opportunities"] == 30
