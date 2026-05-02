from abc import ABC, abstractmethod
from typing import Optional, List
from .base_types import AudioAnalyzer, AudioFeatures, Nudge

class FusionRule(ABC):
    """
    Base interface for a single Multimodal Fusion Rule (SOLID: Interface Segregation).
    """
    @abstractmethod
    def evaluate(self, features: AudioFeatures) -> Optional[Nudge]:
        pass

# Concrete Rules

class DistractedPresenterRule(FusionRule):
    def evaluate(self, features: AudioFeatures) -> Optional[Nudge]:
        visual = features.visual_metrics
        yaw = abs(visual.get("pose", {}).get("yaw", 0))
        if features.emotion_label in ["happy", "calm", "neutral"] and yaw > 0.2:
            return Nudge(
                message="Your voice is calm, but you are looking away from the audience.",
                category="fusion",
                severity="warning"
            )
        return None

class TensePresenterRule(FusionRule):
    def evaluate(self, features: AudioFeatures) -> Optional[Nudge]:
        mar = features.visual_metrics.get("mar", 0)
        if features.emotion_label in ["angry", "fearful"] and mar < 0.1:
            return Nudge(
                message="Your tone sounds stressed, and your facial expression appears very tense.",
                category="fusion",
                severity="critical"
            )
        return None

class ScriptReaderRule(FusionRule):
    def evaluate(self, features: AudioFeatures) -> Optional[Nudge]:
        pitch_val = features.visual_metrics.get("pose", {}).get("pitch", 0)
        if features.emotion_label in ["neutral", "calm"] and pitch_val < -0.15:
            return Nudge(
                message="You are speaking clearly, but you appear to be reading from a script.",
                category="fusion",
                severity="warning"
            )
        return None

class DeerInHeadlightsRule(FusionRule):
    def evaluate(self, features: AudioFeatures) -> Optional[Nudge]:
        visual = features.visual_metrics
        ear = visual.get("ear", 0)
        yaw = abs(visual.get("pose", {}).get("yaw", 0))
        pitch_val = abs(visual.get("pose", {}).get("pitch", 0))
        if features.emotion_label in ["fearful", "surprised"] and ear > 0.3 and yaw < 0.05 and pitch_val < 0.05:
            return Nudge(
                message="You appear frozen. Your eyes are wide and your voice sounds panicked.",
                category="fusion",
                severity="warning"
            )
        return None

class OverlyAnimatedRule(FusionRule):
    def evaluate(self, features: AudioFeatures) -> Optional[Nudge]:
        visual = features.visual_metrics
        yaw = abs(visual.get("pose", {}).get("yaw", 0))
        roll = abs(visual.get("pose", {}).get("roll", 0))
        if features.emotion_label in ["happy", "surprised"] and (yaw > 0.15 or roll > 0.15) and features.zero_crossing_rate > 0.15:
            return Nudge(
                message="You have great vocal energy, but your head movements and pacing are very fast.",
                category="fusion",
                severity="info"
            )
        return None

class IncongruentSignalRule(FusionRule):
    def evaluate(self, features: AudioFeatures) -> Optional[Nudge]:
        mar = features.visual_metrics.get("mar", 0)
        if features.emotion_label in ["angry", "disgust"] and mar > 0.5:
            return Nudge(
                message="You are displaying mixed signals: your tone sounds frustrated, but you are smiling widely.",
                category="fusion",
                severity="info"
            )
        return None

class MicFailureRule(FusionRule):
    def evaluate(self, features: AudioFeatures) -> Optional[Nudge]:
        mar = features.visual_metrics.get("mar", 0)
        if mar > 0.3 and features.avg_volume < 0.01:
            return Nudge(
                message="You appear to be speaking, but your audio signal is very weak. Please check your microphone.",
                category="fusion",
                severity="critical"
            )
        return None

class SarcasmDetectionRule(FusionRule):
    def evaluate(self, features: AudioFeatures) -> Optional[Nudge]:
        mar = features.visual_metrics.get("mar", 0)
        roll = abs(features.visual_metrics.get("pose", {}).get("roll", 0))
        if features.emotion_label in ["disgust", "angry"] and mar > 0.4 and roll > 0.1:
            return Nudge(
                message="Your tone and expression are displaying a sarcastic mismatch. Are you feeling frustrated?",
                category="fusion",
                severity="info"
            )
        return None

# Orchestrator

class AffectFusionAnalyzer(AudioAnalyzer):
    """
    Orchestrates multiple FusionRules.
    You can add new rules to self.rules without changing the analyze() method.
    """
    def __init__(self):
        self.rules: List[FusionRule] = [
            MicFailureRule(),
            DistractedPresenterRule(),
            TensePresenterRule(),
            ScriptReaderRule(),
            DeerInHeadlightsRule(),
            OverlyAnimatedRule(),
            IncongruentSignalRule(),
            SarcasmDetectionRule()
        ]
    
    def analyze(self, features: AudioFeatures) -> Optional[Nudge]:
        if not features.visual_metrics:
            return None
            
        for rule in self.rules:
            nudge = rule.evaluate(features)
            if nudge:
                return nudge
        
        return None
