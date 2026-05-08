import math
from typing import Dict, Any

def calculate_overall_score(
    nudge_summary: Dict[str, int], 
    emotion_distribution: Dict[str, float],
    duration_seconds: int = 60
) -> int:
    """
    Calculates MCA session score based on behavioral control and emotional intelligence.
    """
    
    # 1. Behavioral Control (Max 50)
    control_score = 50.0
    nudge_weights = {"critical": 15.0, "warning": 7.5, "info": 2.5}
    
    total_penalty = 0.0
    for severity, count in nudge_summary.items():
        weight = nudge_weights.get(severity.lower(), 0.0)
        total_penalty += weight * count
        
    # Normalize penalty by duration using square root scaling
    duration_minutes = max(duration_seconds / 60.0, 0.5)
    normalized_penalty = total_penalty / math.sqrt(duration_minutes)
    
    control_score = max(0, control_score - normalized_penalty)
    
    # 2. Emotional Intelligence (Max 50)
    # Reward positive/neutral states and penalize aggressive/suboptimal states
    affect_map = {
        "neutral": 50.0, "happy": 50.0, "surprised": 35.0, 
        "sad": 20.0, "fearful": 5.0, "disgust": 0.0, "angry": 0.0
    }
    
    weighted_eq = 0.0
    total_dist = 0.0
    for emotion, percentage in emotion_distribution.items():
        weight = affect_map.get(emotion.lower(), 25.0)
        weighted_eq += (percentage / 100.0) * weight
        total_dist += percentage
        
    eq_score = weighted_eq if total_dist > 0 else 25.0
    
    # 3. Final Scoring
    return min(100, max(0, int(control_score + eq_score)))
