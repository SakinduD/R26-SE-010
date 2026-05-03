from __future__ import annotations

_ESCALATION_DELTAS: dict[str, int] = {
    "frustrated": 2,
    "anxious": 1,
    "confused": 0,
    "calm": -1,
    "assertive": -1,
}


class ConflictTracker:
    def update(self, current_level: int, emotion: str) -> int:
        delta = _ESCALATION_DELTAS.get(emotion, 0)
        return max(0, min(5, current_level + delta))
