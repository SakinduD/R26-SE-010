from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
import numpy as np
import librosa
import logging
import io
import traceback

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


@dataclass
class Nudge:
    """A single coaching suggestion with category and severity metadata."""
    message: str
    category: str              # e.g. "volume", "pitch", "pace", "clarity"
    severity: str              # "info" | "warning" | "critical"


# Abstract Base (Interface Segregation + Liskov Substitution)
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


# Concrete Analyzers
class VolumeAnalyzer(AudioAnalyzer):
    """Detects if the speaker is too quiet or too loud."""

    LOW_THRESHOLD = 0.025       # Below this RMS - speak up
    HIGH_THRESHOLD = 0.20      # Above this RMS - too loud
    NOISE_FLOOR = 0.012        # Below this is ignored

    def analyze(self, features: AudioFeatures) -> Optional[Nudge]:
        v = features.avg_volume
        if self.NOISE_FLOOR < v < self.LOW_THRESHOLD:
            return Nudge(
                message="A bit quiet. Projecting helps engagement.",
                category="volume",
                severity="warning"
            )
        if v > self.HIGH_THRESHOLD:
            return Nudge(
                message="Strong volume! Try a conversational tone.",
                category="volume",
                severity="warning"
            )
        return None


class PitchAnalyzer(AudioAnalyzer):
    """
    Detects an unusually high or stressed pitch.
    Research baseline: female F0 normal range 165-255 Hz, male 85-155 Hz.
    Sustained pitch above 300 Hz indicates nervousness/stress for most speakers.
    """

    HIGH_PITCH_THRESHOLD_HZ = 350.0  # Moderated back to 350 for scoring baseline
    VOICE_GATE = 0.015

    def analyze(self, features: AudioFeatures) -> Optional[Nudge]:
        if features.avg_volume < self.VOICE_GATE:
            return None # Ignore breathing/noise

        pitch = features.pitch_hz
        # Only fire when a real pitch is detected (non-zero) and it is too high
        if pitch > self.HIGH_PITCH_THRESHOLD_HZ:
            return Nudge(
                message="High energy! Ensure it matches your topic.",
                category="pitch",
                severity="info"
            )
        return None


class PaceAnalyzer(AudioAnalyzer):
    """
    Uses Zero-Crossing Rate (ZCR) as a proxy for speaking pace.
    Voiced speech ZCR is typically 0.02-0.08. A sustained average above
    0.15 across a 500ms chunk indicates rapid speech or heavy consonant use.
    Note: ZCR conflates pace with fricative-heavy speech. Use onset detection
    for more accurate pace measurement in future ML pipeline.
    """

    FAST_ZCR_THRESHOLD = 0.18   # Moderated back to 0.18 for scoring baseline
    VOICE_GATE = 0.015          # Sync with other analyzers

    def analyze(self, features: AudioFeatures) -> Optional[Nudge]:
        if features.avg_volume < self.VOICE_GATE:
            return None # Ignore breathing/noise

        if features.zero_crossing_rate > self.FAST_ZCR_THRESHOLD:
            return Nudge(
                message="Speaking rapidly. Pauses help listeners absorb points.",
                category="pace",
                severity="info"
            )
        return None


class ClarityAnalyzer(AudioAnalyzer):
    """
    Uses Spectral Centroid to detect muffled or noisy audio.
    Human speech energy concentrates in the 1-4 kHz band.
    Centroid below 1000 Hz = muffled/blocked mic.
    Centroid above 4000 Hz = background noise (fan, AC, traffic).
    """

    LOW_CENTROID_HZ = 800.0     # Moderated for scoring baseline
    HIGH_CENTROID_HZ = 5000.0   # Moderated for scoring baseline
    VOICE_GATE = 0.015

    def analyze(self, features: AudioFeatures) -> Optional[Nudge]:
        if features.avg_volume < self.VOICE_GATE:
            return None # Ignore breathing/noise

        c = features.spectral_centroid
        if c < self.LOW_CENTROID_HZ:
            return Nudge(
                message="Audio slightly muffled. Check mic position.",
                category="clarity",
                severity="warning"
            )
        if c > self.HIGH_CENTROID_HZ:
            return Nudge(
                message="Background noise. A quieter spot helps focus.",
                category="clarity",
                severity="warning"
            )
        return None


class SilenceAnalyzer(AudioAnalyzer):
    """
    Detects prolonged near-silence, which may indicate hesitation.
    Threshold raised from 0.00005 to 0.0001 to account for the
    browser MediaRecorder noise floor which is rarely truly zero.
    """

    SILENCE_THRESHOLD = 0.008  # accounts for higher noise floors

    def analyze(self, features: AudioFeatures) -> Optional[Nudge]:
        if features.avg_volume < self.SILENCE_THRESHOLD:
            return Nudge(
                message="Take your time! Pauses help gather ideas.",
                category="silence",
                severity="info"
            )
        return None


class SerAnalyzer(AudioAnalyzer):
    """
    Speech Emotion Recognition (SER) Analyzer.
    Loads the trained SVM pipeline (Scaler + SVC) to predict the user's emotional state.
    """

    def __init__(self, model_path: str = "app/models/affect_fusion/svm_model.pkl"):
        self.model = None
        self.model_path = model_path
        self._load_model()

    def _load_model(self):
        import joblib
        import os
        try:
            if os.path.exists(self.model_path):
                self.model = joblib.load(self.model_path)
                logging.getLogger("uvicorn").info(f"SVM Emotion Model loaded from {self.model_path}")
            else:
                logging.getLogger("uvicorn").warning(f"SVM Model not found at {self.model_path}. Emotion detection disabled.")
        except Exception as e:
            logging.getLogger("uvicorn").error(f"Failed to load SVM model: {str(e)}")

    def analyze(self, features: AudioFeatures) -> Optional[Nudge]:
        # Populates the emotion metadata if the engine was built that way.
        # Fire a nudge if the emotion is 'Angry' or 'Sad' to help the user.
        if not features.emotion_label:
            return None

        if features.emotion_label == "angry":
            return Nudge(
                message="High intensity detected. Remember to breathe and stay grounded.",
                category="emotion",
                severity="warning"
            )
        
        if features.emotion_label == "sad":
            return Nudge(
                message="Tone feels a bit low. Connecting with your 'why' can boost energy.",
                category="emotion",
                severity="info"
            )

        return None


# Feature Extractor
class AudioFeatureExtractor:
    """Responsible only for converting raw bytes into AudioFeatures."""

    def extract(self, data: bytes) -> Optional[AudioFeatures]:
        try:
            import av

            # Decode WebM/Opus using PyAV instead of librosa/soundfile directly
            container = av.open(io.BytesIO(data))
            frames = []
            sr = 48000 # default fallback
            for frame in container.decode(audio=0):
                frames.append(frame.to_ndarray())
                sr = frame.rate
            
            if not frames:
                return None
                
            # Combine frames and convert to mono (if stereo)
            audio_data = np.concatenate(frames, axis=1)
            if audio_data.shape[0] > 1:
                audio_data = np.mean(audio_data, axis=0) # Mix down to mono
            else:
                audio_data = audio_data[0] # Flatten to 1D
            
            # Normalize audio (convert from int16 or whatever format it is to float32 between -1 and 1)
            if audio_data.dtype != np.float32:
                audio_data = audio_data.astype(np.float32) / np.iinfo(audio_data.dtype).max

            avg_volume = float(np.mean(librosa.feature.rms(y=audio_data)))

            # Dominant pitch
            try:
                pitches, magnitudes = librosa.piptrack(y=audio_data, sr=sr)
                index = magnitudes.argmax()
                pitch_hz = float(pitches.flatten()[index])
            except Exception:
                pitch_hz = 0.0

            zcr = float(np.mean(librosa.feature.zero_crossing_rate(y=audio_data)))
            centroid = float(np.mean(librosa.feature.spectral_centroid(y=audio_data, sr=sr)))
            duration_ms = (len(audio_data) / sr) * 1000

            # This must exactly match the training script: MFCC(40) + Chroma(12) + Mel(128) + Pitch(1)
            try:
                # MFCC (40)
                mfcc = np.mean(librosa.feature.mfcc(y=audio_data, sr=sr, n_mfcc=40).T, axis=0)
                # Chroma (12)
                stft = np.abs(librosa.stft(audio_data))
                chroma = np.mean(librosa.feature.chroma_stft(S=stft, sr=sr).T, axis=0)
                # Mel (128)
                mel = np.mean(librosa.feature.melspectrogram(y=audio_data, sr=sr).T, axis=0)
                # Combined into the 181-feature vector
                feature_vector = np.hstack((mfcc, chroma, mel, np.array([pitch_hz])))
            except Exception as e:
                logging.getLogger("uvicorn").error(f"SVM Feature Extraction Error: {str(e)}")
                feature_vector = None

            return AudioFeatures(
                audio_data=audio_data,
                sample_rate=sr,
                avg_volume=avg_volume,
                pitch_hz=pitch_hz,
                zero_crossing_rate=zcr,
                spectral_centroid=centroid,
                duration_ms=duration_ms,
                feature_vector=feature_vector,
                emotion_label=None, # Will be filled by SerAnalyzer
            )
        except Exception as e:
            logging.getLogger("uvicorn").error(f"Feature Extraction Error: {str(e)}\n{traceback.format_exc()}")
            return None


# NudgeEngine
class NudgeEngine:
    """
    Orchestrates all analyzers.
    Inject any list of AudioAnalyzer subclasses — the engine
    does not depend on any specific implementation.
    """

    def __init__(self, analyzers: list[AudioAnalyzer] = None):
        # Default set of analyzers — extend this list to add new nudge types
        self._analyzers: list[AudioAnalyzer] = analyzers or [
            VolumeAnalyzer(),
            PitchAnalyzer(),
            PaceAnalyzer(),
            ClarityAnalyzer(),
            SilenceAnalyzer(),
            SerAnalyzer(), # New: MCA-14 Emotion Recognition
        ]
        self.ser_analyzer = next((a for a in self._analyzers if isinstance(a, SerAnalyzer)), None)
        self.last_nudge_text: Optional[str] = None
        self.last_nudge_time: float = 0.0
        self.COOLDOWN_SECONDS: float = 25.0 # Prevent same nudge spamming

    def evaluate(self, features: AudioFeatures) -> Optional[Nudge]:
        """
        Runs all analyzers in order. Returns the first nudge found.
        Includes a cooldown check to prevent repeat spamming.
        """
        import time
        current_time = time.time()

        # UN EMOTION INFERENCE FIRST
        if self.ser_analyzer and self.ser_analyzer.model and features.feature_vector is not None:
            try:
                vec = features.feature_vector
                
                # Predict using the SVM model
                prediction = self.ser_analyzer.model.predict(vec.reshape(1, -1))[0]
                features.emotion_label = prediction
                
                # Get confidence score (probability)
                if hasattr(self.ser_analyzer.model, "predict_proba"):
                    probs = self.ser_analyzer.model.predict_proba(vec.reshape(1, -1))[0]
                    features.emotion_confidence = float(np.max(probs))
            except Exception as e:
                logging.getLogger("uvicorn").error(f"Inference Error: {str(e)}")

        for analyzer in self._analyzers:
            nudge = analyzer.analyze(features)
            if nudge:
                # Check for spam/cooldown
                if nudge.message == self.last_nudge_text and (current_time - self.last_nudge_time) < self.COOLDOWN_SECONDS:
                    return None # Still in cooldown for this specific nudge
                
                # New nudge or cooldown expired
                self.last_nudge_text = nudge.message
                self.last_nudge_time = current_time
                return nudge
        return None
