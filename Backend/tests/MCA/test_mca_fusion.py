import pytest
from unittest.mock import MagicMock
from app.api.v1.mca.base_types import AudioFeatures, Nudge
from app.api.v1.mca.affect_fusion import (
    DistractedPresenterRule,
    TensePresenterRule,
    ScriptReaderRule,
    DeerInHeadlightsRule,
    MicFailureRule,
    OverlyAnimatedRule,
    IncongruentSignalRule,
    SarcasmDetectionRule,
    AffectFusionAnalyzer
)
from app.api.v1.mca.nudge_engine import NudgeEngine, VolumeAnalyzer, SilenceAnalyzer

def _mock_features(emotion_label="neutral", volume=0.05, visual_metrics=None, **kwargs):
    if visual_metrics is None:
        visual_metrics = {"pose": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "mar": 0.2, "ear": 0.3}
        
    features = AudioFeatures(
        audio_data=b"",
        sample_rate=16000,
        avg_volume=volume,
        pitch_hz=150.0,
        zero_crossing_rate=0.05,
        spectral_centroid=1500.0,
        duration_ms=3000.0,
        pitch_std=20.0,
        feature_vector=None,
        mel_spectrogram=None,
        waveform_16k=None,
        emotion_label=emotion_label
    )
    features.visual_metrics = visual_metrics
    for k, v in kwargs.items():
        setattr(features, k, v)
    return features

def test_distracted_presenter_rule():
    rule = DistractedPresenterRule()
    # Should trigger
    features = _mock_features("neutral", visual_metrics={"pose": {"yaw": 0.3}})
    assert rule.evaluate(features) is not None
    
    # Should not trigger (wrong emotion)
    features_happy = _mock_features("happy", visual_metrics={"pose": {"yaw": 0.3}})
    assert rule.evaluate(features_happy) is None

    # Should not trigger (looking straight)
    features_straight = _mock_features("neutral", visual_metrics={"pose": {"yaw": 0.1}})
    assert rule.evaluate(features_straight) is None

def test_mic_failure_rule():
    rule = MicFailureRule()
    # Should trigger
    features = _mock_features(volume=0.005, visual_metrics={"mar": 0.2, "pose": {"yaw": 0.0}})
    assert rule.evaluate(features) is not None
    
    # Should not trigger (loud enough)
    features_loud = _mock_features(volume=0.02, visual_metrics={"mar": 0.2, "pose": {"yaw": 0.0}})
    assert rule.evaluate(features_loud) is None

def test_affect_fusion_analyzer():
    analyzer = AffectFusionAnalyzer()
    
    # Test skipping rules if not talking
    silent_features = _mock_features(volume=0.005, visual_metrics={"pose": {"yaw": 0.3}}) # distracted features but silent
    # It might trigger mic failure if MAR is high enough. Let's make MAR low to test silence skipping.
    silent_features.visual_metrics["mar"] = 0.0
    assert analyzer.analyze(silent_features) is None
    
    # Test triggering a rule
    distracted_features = _mock_features("neutral", volume=0.05, visual_metrics={"pose": {"yaw": 0.3}})
    nudge = analyzer.analyze(distracted_features)
    assert nudge is not None
    assert nudge.category == "fusion"

def test_nudge_engine_cooldown_and_sustain():
    # Use simple analyzers
    analyzers = [VolumeAnalyzer(), SilenceAnalyzer()]
    engine = NudgeEngine(analyzers=analyzers)
    # Patch timing
    engine.COOLDOWN_SECONDS = 2.0
    engine.SUSTAIN_THRESHOLD = 2 # needs 2 consecutive chunks
    
    features = _mock_features(volume=0.3) # Trigger high volume
    
    # Chunk 1: should register behavior but return None (sustain threshold not met)
    assert engine.evaluate(features) is None
    assert "Strong volume! Try a conversational tone." in engine.behavior_history
    
    # Chunk 2: should return nudge
    nudge = engine.evaluate(features)
    assert nudge is not None
    assert nudge.category == "volume"
    assert not engine.behavior_history # history cleared
    
    # Chunk 3: should return None due to cooldown
    assert engine.evaluate(features) is None
