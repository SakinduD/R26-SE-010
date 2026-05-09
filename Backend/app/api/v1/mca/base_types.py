from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
import numpy as np

@dataclass
class AudioFeatures:
    """Immutable snapshot of all extracted audio features for a single chunk."""
    audio_data: np.ndarray
    sample_rate: int
    avg_volume: float          # RMS energy
    pitch_hz: float            # Dominant fundamental frequency (Hz)
    zero_crossing_rate: float  # Proxy for speaking pace / consonant density
    spectral_centroid: float   # Brightness/clarity of the signal
    duration_ms: float
    feature_vector: Optional[np.ndarray] = None # Cached 181 features for SVM
    emotion_label: Optional[str] = None  # SVM Prediction
    emotion_confidence: float = 0.0      # SVM Probability
    visual_metrics: Optional[dict] = None # MediaPipe visual data (ear, mar, pose)


@dataclass
class Nudge:
    """A single coaching suggestion with category and severity metadata."""
    message: str
    category: str              # e.g. "volume", "pitch", "pace", "clarity", "fusion"
    severity: str              # "info" | "warning" | "critical"


class AudioAnalyzer(ABC):
    """
    Single-responsibility contract for one coaching dimension.
    Every analyzer receives the same AudioFeatures object and
    returns a Nudge or None.
    """

    @abstractmethod
    def analyze(self, features: AudioFeatures) -> Optional[Nudge]:
        """Return a Nudge if an issue is detected, otherwise None."""
        ...
