import math

def calculate_overall_score(nudge_summary: dict, emotion_distribution: dict) -> int:
    """
    Calculates the overall session score based on nudges and emotional stability.
    
    Args:
        nudge_summary (dict): Counts of nudges by severity. Example: {"Critical": 1, "Warning": 2, "Info": 3}
        emotion_distribution (dict): Percentage distribution of emotions. Example: {"Fearful": 20.0, "Angry": 5.0, ...}
    
    Returns:
        int: The final score between 0 and 100.
    """
    score = 100.0
    
    # 1. Deduct points for nudges
    # Use lowercase keys for robustness, but fallback if provided exact matches
    nudge_deductions = {
        "critical": 10.0,
        "warning": 5.0,
        "info": 2.0
    }
    
    for severity, count in nudge_summary.items():
        if not isinstance(count, (int, float)):
            continue
        penalty = nudge_deductions.get(severity.lower(), 0.0)
        score -= penalty * count

    # 2. Emotional Stability Penalty
    # Negative emotions: fearful, angry, sad, disgust
    negative_emotions = {"fearful", "angry", "sad", "disgust"}
    total_negative_pct = 0.0
    
    for emotion, percentage in emotion_distribution.items():
        if emotion.lower() in negative_emotions and isinstance(percentage, (int, float)):
            total_negative_pct += percentage
            
    # Deduct 0.2 points for every 1% of negative emotions
    score -= (total_negative_pct * 0.2)
    
    # Ensure score floors at 0 and ceilings at 100
    final_score = int(math.floor(score))
    if final_score < 0:
        return 0
    if final_score > 100:
        return 100
        
    return final_score
