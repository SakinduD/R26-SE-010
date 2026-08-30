from typing import Optional
import numpy as np
import librosa
import logging
import io
import json
import traceback
import os
import joblib

from .base_types import AudioAnalyzer, AudioFeatures, Nudge
from .affect_fusion import AffectFusionAnalyzer


# Concrete Analyzers
class VolumeAnalyzer(AudioAnalyzer):
    """Detects if the speaker is too quiet or too loud."""

    LOW_THRESHOLD = 0.025       # Below this RMS - speak up
    HIGH_THRESHOLD = 0.20      # Above this RMS - too loud
    NOISE_FLOOR = 0.012        # Below this is ignored

    def analyze(self, features: AudioFeatures) -> Optional[Nudge]:
        v = features.avg_volume
        if v < self.NOISE_FLOOR: # Gate
            return None
            
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

    LOW_CENTROID_HZ = 1000.0    # Picheny et al. (1985): 1 kHz lower bound of speech intelligibility band
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
        # Only trigger if there was *some* noise but very low (true hesitation)
        # and ignore if completely silent (standby)
        if 0.001 < features.avg_volume < self.SILENCE_THRESHOLD:
            return Nudge(
                message="Take your time! Pauses help gather ideas.",
                category="silence",
                severity="info"
            )
        return None


class SerAnalyzer(AudioAnalyzer):
    """
    Speech Emotion Recognition (SER) Analyzer.
    Loads whichever SER model (SVM or CNN) is marked "enabled": true in model_config.json,
    so switching models no longer requires editing code — just flip the flags in the JSON file.
    """

    EMOTION_MAP = {
        0: "neutral",
        1: "happy",
        2: "sad",
        3: "angry",
        4: "fearful",
        5: "disgust",
        6: "surprised"
    }

    # Used only if the config file is missing/unreadable/has nothing enabled
    FALLBACK_MODEL_PATH = "app/models/affect_fusion/svm_model.pkl"

    # Model kinds loaded via transformers (HF checkpoint dir) instead of joblib (.pkl)
    HF_MODEL_KINDS = {"wav2vec2"}

    def __init__(self, config_path: str = "app/models/affect_fusion/model_config.json"):
        self.model = None
        self.feature_extractor = None  # only set for HF (wav2vec2) models
        self.config_path = config_path
        self.model_path = None
        self.model_kind = None  # "svm" | "cnn" | "wav2vec2", from model_config.json key
        self._load_model()

    def _resolve_model_path(self) -> tuple[str, str]:
        """Reads model_config.json and returns (name, path) of the model marked "enabled": true."""
        log = logging.getLogger("uvicorn")
        try:
            with open(self.config_path, "r") as f:
                config = json.load(f)
        except FileNotFoundError:
            log.warning(f"Model config not found at {self.config_path}. Falling back to {self.FALLBACK_MODEL_PATH}")
            return "svm", self.FALLBACK_MODEL_PATH
        except Exception as e:
            log.error(f"Failed to parse model config {self.config_path}: {e}. Falling back to {self.FALLBACK_MODEL_PATH}")
            return "svm", self.FALLBACK_MODEL_PATH

        enabled = [(name, entry) for name, entry in config.items() if entry.get("enabled")]

        if not enabled:
            log.warning(f"No model marked \"enabled\": true in {self.config_path}. Falling back to {self.FALLBACK_MODEL_PATH}")
            return "svm", self.FALLBACK_MODEL_PATH

        if len(enabled) > 1:
            names = ", ".join(name for name, _ in enabled)
            log.warning(f"Multiple models enabled in {self.config_path} ({names}). Using the first: {enabled[0][0]}")

        name, entry = enabled[0]
        log.info(f"SER model selected via {self.config_path}: \"{name}\"")
        return name, entry["path"]

    def _load_model(self):
        self.model_kind, self.model_path = self._resolve_model_path()
        log = logging.getLogger("uvicorn")
        try:
            if not os.path.exists(self.model_path):
                log.warning(f"Model not found at {self.model_path}. Emotion detection disabled.")
                return

            if self.model_kind in self.HF_MODEL_KINDS:
                # Wav2Vec2 (and any future HF model) is a saved
                # transformers checkpoint directory, not a joblib .pkl
                from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

                self.feature_extractor = AutoFeatureExtractor.from_pretrained(self.model_path)
                self.model = AutoModelForAudioClassification.from_pretrained(self.model_path)
                self.model.eval()
            else:
                self.model = joblib.load(self.model_path)
            log.info(f"Emotion model ({self.model_kind}) loaded from {self.model_path}")
        except Exception as e:
            log.error(f"Failed to load emotion model: {str(e)}")

    def analyze(self, _features: AudioFeatures) -> Optional[Nudge]:
        # Inference runs in NudgeEngine.evaluate(); this analyzer is classification-only.
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

            # Resample to 22050Hz to match training pipeline
            if sr != 22050:
                audio_data = librosa.resample(audio_data, orig_sr=sr, target_sr=22050)
                sr = 22050

            avg_volume = float(np.mean(librosa.feature.rms(y=audio_data)))

            # Dominant pitch & Pitch Stability (STD)
            try:
                # Use YIN for more stable pitch tracking than piptrack
                f0 = librosa.yin(audio_data, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'))
                voiced_f0 = f0[f0 > 0]
                pitch_hz = float(np.mean(voiced_f0)) if len(voiced_f0) > 0 else 0.0
                pitch_std = float(np.std(voiced_f0)) if len(voiced_f0) > 0 else 0.0
            except Exception:
                pitch_hz = 0.0
                pitch_std = 0.0

            zcr = float(np.mean(librosa.feature.zero_crossing_rate(y=audio_data)))
            centroid = float(np.mean(librosa.feature.spectral_centroid(y=audio_data, sr=sr)))
            duration_ms = (len(audio_data) / sr) * 1000

            # This must exactly match the training script: MFCC(80) + Chroma(24) + Mel(256) + Pitch(2) = 362
            try:
                # MFCC (40 mean + 40 std)
                mfcc_features = librosa.feature.mfcc(y=audio_data, sr=sr, n_mfcc=40).T
                mfcc_mean = np.mean(mfcc_features, axis=0)
                mfcc_std = np.std(mfcc_features, axis=0)
                
                # Chroma (12 mean + 12 std)
                stft = np.abs(librosa.stft(audio_data))
                chroma_features = librosa.feature.chroma_stft(S=stft, sr=sr).T
                chroma_mean = np.mean(chroma_features, axis=0)
                chroma_std = np.std(chroma_features, axis=0)
                
                # Mel (128 mean + 128 std)
                mel_features = librosa.feature.melspectrogram(y=audio_data, sr=sr).T
                mel_mean = np.mean(mel_features, axis=0)
                mel_std = np.std(mel_features, axis=0)
                
                # Combined into the 362-feature vector
                feature_vector = np.hstack((
                    mfcc_mean, mfcc_std,
                    chroma_mean, chroma_std,
                    mel_mean, mel_std,
                    np.array([pitch_hz, pitch_std])
                ))
            except Exception as e:
                logging.getLogger("uvicorn").error(f"SVM Feature Extraction Error: {str(e)}")
                feature_vector = None

            # CNN input: fixed (1, 128, 128) log-mel spectrogram
            # Parameters must match preprocess_cnn.py: n_fft=2048, hop=512, n_mels=128
            try:
                _N_FFT, _HOP, _N_MELS, _T_FRAMES = 2048, 512, 128, 128
                _target_samples = (_T_FRAMES - 1) * _HOP + _N_FFT  # 67072
                y_mel = audio_data.copy()
                if y_mel.size < _target_samples:
                    y_mel = np.pad(y_mel, (0, _target_samples - y_mel.size))
                else:
                    start = (y_mel.size - _target_samples) // 2
                    y_mel = y_mel[start: start + _target_samples]
                mel = librosa.feature.melspectrogram(
                    y=y_mel, sr=sr,
                    n_fft=_N_FFT, hop_length=_HOP, n_mels=_N_MELS,
                )
                mel_db = librosa.power_to_db(mel, ref=np.max)[:, :_T_FRAMES]
                mel_min, mel_max = mel_db.min(), mel_db.max()
                mel_db = (mel_db - mel_min) / (mel_max - mel_min + 1e-8)
                mel_spectrogram = mel_db[np.newaxis].astype(np.float32)  # (1,128,128)
            except Exception:
                mel_spectrogram = None

            # Wav2Vec2 input: raw mono waveform resampled to 16kHz
            try:
                if sr != 16000:
                    waveform_16k = librosa.resample(audio_data, orig_sr=sr, target_sr=16000)
                else:
                    waveform_16k = audio_data
            except Exception:
                waveform_16k = None

            return AudioFeatures(
                audio_data=audio_data,
                sample_rate=sr,
                avg_volume=avg_volume,
                pitch_hz=pitch_hz,
                zero_crossing_rate=zcr,
                spectral_centroid=centroid,
                duration_ms=duration_ms,
                pitch_std=pitch_std,
                feature_vector=feature_vector,
                mel_spectrogram=mel_spectrogram,
                waveform_16k=waveform_16k,
                emotion_label=None,
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
            AffectFusionAnalyzer(), # High Priority: Multimodal Logic
            VolumeAnalyzer(),
            PitchAnalyzer(),
            PaceAnalyzer(),
            ClarityAnalyzer(),
            SilenceAnalyzer(),
            SerAnalyzer(), # Classification Only
        ]
        self.ser_analyzer = next((a for a in self._analyzers if isinstance(a, SerAnalyzer)), None)
        self.last_nudge_time: float = 0.0
        self.COOLDOWN_SECONDS: float = 10.0 # Global gap between any two nudges
        
        # Frontend sends ~3s clips, so a single chunk already covers the old
        # 3-chunk/3-second sustain window. Threshold lowered accordingly to avoid requiring
        # 9s of continuous behavior before a nudge fires.
        self.behavior_history: dict[str, int] = {}
        self.SUSTAIN_THRESHOLD = 1 # Behavior must persist for 1 chunk (~3 seconds)

        # Fairness bookkeeping for _select_nudge
        self.category_last_fired: dict[str, float] = {}

    _SEVERITY_RANK = {"critical": 3, "warning": 2, "info": 1}

    def _select_nudge(self, candidates: list[Nudge]) -> Nudge:
        """
        Choose which sustained nudge to surface this chunk when multiple
        analyzers fire at once.

        Priority: highest severity first; ties broken by whichever category
        has gone longest without being surfaced (least-recently-fired wins).
        This keeps lower-priority categories (pace/pitch/clarity/silence)
        from being starved indefinitely by higher-priority ones (fusion/
        volume) that happen to sit earlier in self._analyzers.
        """
        def rank(n: Nudge) -> tuple:
            return (
                self._SEVERITY_RANK.get(n.severity, 0),
                -self.category_last_fired.get(n.category, 0.0),
            )
        return max(candidates, key=rank)

    def evaluate(self, features: AudioFeatures, visual_metrics: dict = None) -> Optional[Nudge]:
        """
        Runs all analyzers and returns at most one nudge — the sustained
        candidate chosen by _select_nudge — once the global cooldown has
        passed. Every analyzer is evaluated every chunk (not just the first
        one that matches), so no category is silently excluded from scoring.
        """
        import time
        current_time = time.time()

        # 1. Global Cooldown Check (Don't even try if we recently nudged)
        if (current_time - self.last_nudge_time) < self.COOLDOWN_SECONDS:
            return None

        if visual_metrics:
            features.visual_metrics = visual_metrics

        # 2. Emotion Inference (Only run if user is actually talking)
        if self.ser_analyzer and self.ser_analyzer.model and features.avg_volume > 0.015:
            try:
                model = self.ser_analyzer.model
                kind = self.ser_analyzer.model_kind

                if kind == "wav2vec2" and features.waveform_16k is not None:
                    import torch

                    extractor = self.ser_analyzer.feature_extractor
                    inputs = extractor(features.waveform_16k, sampling_rate=16000, return_tensors="pt")
                    with torch.no_grad():
                        logits = model(**inputs).logits
                    probs = torch.softmax(logits, dim=-1)[0].numpy()
                    prediction = int(np.argmax(probs))
                    features.emotion_label = self.ser_analyzer.EMOTION_MAP.get(prediction, "unknown")
                    features.emotion_confidence = float(np.max(probs))
                elif kind == "cnn" and features.mel_spectrogram is not None:
                    # CNN path: flat mel spectrogram input (1, 16384)
                    inp = features.mel_spectrogram.flatten().reshape(1, -1)
                    prediction = int(model.predict(inp)[0])
                    features.emotion_label = self.ser_analyzer.EMOTION_MAP.get(prediction, "unknown")
                    if hasattr(model, "predict_proba"):
                        features.emotion_confidence = float(np.max(model.predict_proba(inp)[0]))
                elif kind == "svm" and features.feature_vector is not None:
                    # SVM path: 362-dim statistical feature vector
                    inp = features.feature_vector.reshape(1, -1)
                    prediction = int(model.predict(inp)[0])
                    features.emotion_label = self.ser_analyzer.EMOTION_MAP.get(prediction, "unknown")
                    if hasattr(model, "predict_proba"):
                        features.emotion_confidence = float(np.max(model.predict_proba(inp)[0]))
            except Exception as e:
                logging.getLogger("uvicorn").error(f"Inference Error: {str(e)}")

        # 3. Analyze every analyzer this chunk — do NOT stop at the first
        candidates: list[Nudge] = []
        for analyzer in self._analyzers:
            nudge = analyzer.analyze(features)
            if nudge:
                candidates.append(nudge)

        if not candidates:
            # Nothing detected this chunk — clear history so an isolated
            # blip doesn't keep counting toward sustain later.
            self.behavior_history = {}
            return None

        # Sustain tracking: each candidate behavior must persist for
        # SUSTAIN_THRESHOLD consecutive chunks before it's eligible to fire.
        seen_messages = {c.message for c in candidates}
        sustained: list[Nudge] = []
        for nudge in candidates:
            self.behavior_history[nudge.message] = self.behavior_history.get(nudge.message, 0) + 1
            if self.behavior_history[nudge.message] >= self.SUSTAIN_THRESHOLD:
                sustained.append(nudge)
        # Drop history for behaviors that didn't recur this chunk.
        self.behavior_history = {k: v for k, v in self.behavior_history.items() if k in seen_messages}

        if not sustained:
            return None # Behavior(s) detected but not yet sustained

        chosen = self._select_nudge(sustained)
        self.last_nudge_time = current_time
        self.category_last_fired[chosen.category] = current_time
        self.behavior_history = {} # Reset all history after a successful nudge
        return chosen
