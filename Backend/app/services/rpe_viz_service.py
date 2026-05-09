from collections import Counter


def _npc_tone(score: int) -> str:
    if score >= 70:
        return "cooperative"
    if score >= 40:
        return "neutral"
    return "hostile"


class RpeVizService:
    def build(
        self,
        turns:           list[dict],
        trust_history:   list[int],
        emotion_history: list[str],
        turn_metrics:    list[dict],
        end_reason:      str | None = None,
    ) -> dict:
        return {
            "trust_curve":          self._build_trust_curve(trust_history),
            "escalation_curve":     self._build_escalation_curve(turns),
            "emotion_distribution": self._build_emotion_distribution(emotion_history),
            "quality_curve":        self._build_quality_curve(turn_metrics),
            "trust_deltas":         self._build_trust_deltas(trust_history),
            "npc_tone_journey":     self._build_npc_tone_journey(trust_history),
            "summary_scores":       self._build_summary(
                trust_history, turns, emotion_history, turn_metrics, end_reason
            ),
        }

    def _end_reason_label(self, end_reason: str | None) -> str:
        labels = {
            "trust_sustained":   "Resolved — Trust Built",
            "npc_exit":          "Failed — NPC Walked Out",
            "max_turns_reached": "Completed — Max Turns",
        }
        return labels.get(end_reason or "", "Session Ended")

    def _build_trust_curve(self, trust_history: list[int]) -> list[dict]:
        labels = ["Start"] + [f"T{i}" for i in range(1, len(trust_history))]
        return [{"turn": labels[i], "value": v} for i, v in enumerate(trust_history)]

    def _build_escalation_curve(self, turns: list[dict]) -> list[dict]:
        return [{"turn": f"T{t['turn']}", "value": t["escalation_level"]} for t in turns]

    def _build_emotion_distribution(self, emotion_history: list[str]) -> dict[str, int]:
        dist: dict[str, int] = {}
        for e in emotion_history:
            dist[e] = dist.get(e, 0) + 1
        return dist

    def _build_quality_curve(self, turn_metrics: list[dict]) -> list[dict]:
        return [{"turn": f"T{m['turn']}", "value": m["response_quality"]} for m in turn_metrics]

    def _build_trust_deltas(self, trust_history: list[int]) -> list[dict]:
        deltas: list[dict] = []
        for i in range(1, len(trust_history)):
            d = trust_history[i] - trust_history[i - 1]
            deltas.append({
                "turn":      f"T{i}",
                "delta":     d,
                "direction": "up" if d > 0 else ("down" if d < 0 else "flat"),
            })
        return deltas

    def _build_npc_tone_journey(self, trust_history: list[int]) -> list[dict]:
        labels = ["Start"] + [f"T{i}" for i in range(1, len(trust_history))]
        return [{"turn": labels[i], "tone": _npc_tone(v)} for i, v in enumerate(trust_history)]

    def _build_summary(
        self,
        trust_history:   list[int],
        turns:           list[dict],
        emotion_history: list[str],
        turn_metrics:    list[dict],
        end_reason:      str | None = None,
    ) -> dict:
        avg_trust = round(sum(trust_history) / len(trust_history), 1) if trust_history else 0.0
        avg_esc   = round(sum(t["escalation_level"] for t in turns) / len(turns), 1) if turns else 0.0
        avg_qual  = round(sum(m["response_quality"] for m in turn_metrics) / len(turn_metrics), 1) if turn_metrics else 0.0

        mid        = len(trust_history) // 2
        first_avg  = sum(trust_history[:mid]) / mid if mid else 0.0
        second_avg = (sum(trust_history[mid:]) / (len(trust_history) - mid)
                      if len(trust_history) > mid else 0.0)
        if second_avg - first_avg > 3:
            trend = "improving"
        elif first_avg - second_avg > 3:
            trend = "declining"
        else:
            trend = "stable"

        counts   = Counter(emotion_history[1:])
        dominant = counts.most_common(1)[0][0] if counts else "calm"

        return {
            "avg_trust":        avg_trust,
            "avg_escalation":   avg_esc,
            "avg_quality":      avg_qual,
            "trust_trend":      trend,
            "dominant_emotion": dominant,
            "end_reason_label": self._end_reason_label(end_reason),
        }
