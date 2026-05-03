from __future__ import annotations

_TRUST_DELTAS: dict[str, int] = {
    "assertive": 2,
    "calm": 2,
    "confused": 0,
    "anxious": -1,
    "frustrated": -2,
}


class TrustTracker:
    def update(self, current_score: int, emotion: str) -> int:
        delta = _TRUST_DELTAS.get(emotion, 0)
        return max(0, min(100, current_score + delta))
