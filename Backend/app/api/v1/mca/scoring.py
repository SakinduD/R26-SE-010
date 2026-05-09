import math
from typing import Dict, Any

def calculate_session_metrics(
    nudge_log: list[dict], 
    emotion_distribution: Dict[str, float],
    duration_seconds: int = 60
) -> Dict[str, Any]:
    """
    Calculates detailed MCA skill scores and an overall session score.
    """
    # Initialize Skill Scores (Base 100)
    vocal_score = 100.0
    pacing_score = 100.0
    presence_score = 100.0
    intelligence_score = 100.0
    
    # Severity Penalties
    penalties = {"critical": 15.0, "warning": 7.5, "info": 2.5}
    
    # 1. Categorize Nudges and Apply Penalties
    for nudge in nudge_log:
        category = nudge.get("category", "unknown").lower()
        severity = nudge.get("severity", "info").lower()
        penalty = penalties.get(severity, 2.5)
        
        if category in ["volume", "pitch", "clarity"]:
            vocal_score -= penalty
        elif category in ["pace", "silence"]:
            pacing_score -= penalty
        elif category == "fusion":
            # Fusion nudges are split between Presence and Intelligence/Synergy
            msg = nudge.get("message", "").lower()
            if any(word in msg for word in ["look", "gaze", "head", "eye", "audience"]):
                presence_score -= penalty
            else:
                intelligence_score -= (penalty * 1.5) # Mismatch/Sarcasm is heavier
    
    # 2. Emotional Intelligence (Factor in Emotion Distribution)
    # Penalize negative states (angry, fearful, disgust) and reward stable states
    negative_affect = (
        emotion_distribution.get("angry", 0) + 
        emotion_distribution.get("fearful", 0) + 
        emotion_distribution.get("disgust", 0)
    )
    # Each % of negative affect reduces intelligence score slightly
    intelligence_score -= (negative_affect * 0.5)
    
    # 3. Normalization and Bounds
    # Normalize by duration to be fair to longer sessions (square root scaling)
    duration_minutes = max(duration_seconds / 60.0, 0.5)
    scale_factor = 1.0 / math.sqrt(duration_minutes)
    
    def finalize(score):
        # We don't want to penalize too much for long sessions, so we moderate the drop
        final = 100 - ((100 - score) * scale_factor)
        return int(min(100, max(0, final)))

    skills = {
        "vocal_command": finalize(vocal_score),
        "speech_fluency": finalize(pacing_score),
        "presence_engagement": finalize(presence_score),
        "emotional_intelligence": finalize(intelligence_score)
    }
    
    # 4. Overall Score (Weighted Average)
    # Weights: EQ (30%), Presence (30%), Vocal (20%), Pacing (20%)
    overall = (
        skills["vocal_command"] * 0.20 +
        skills["speech_fluency"] * 0.20 +
        skills["presence_engagement"] * 0.30 +
        skills["emotional_intelligence"] * 0.30
    )
    
    return {
        "overall": int(overall),
        "breakdown": skills
    }
