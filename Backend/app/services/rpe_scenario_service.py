import json
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SCENARIOS_DIR = BASE_DIR / "models" / "rpe" / "scenarios"

_DEFAULT_APA: dict = {
    "target_skills": [],
    "big_five_relevance": [],
    "recommended_for_profile": None,
    "difficulty_weight": 1.0,
}

_DEFAULT_BEHAVIOUR: dict = {
    "trust_thresholds": {"cooperative": 70, "neutral": 40, "hostile": 0},
    "escalation_thresholds": {"furious": 4, "irritated": 2, "controlled": 0},
}

_DEFAULT_END_CONDITIONS: dict = {
    "success_trust_threshold": 70,
    "success_consecutive_turns": 2,
    "failure_escalation_threshold": 5,
}


@dataclass
class Scenario:
    scenario_id:       str
    title:             str
    difficulty:        str
    conflict_type:     str
    npc_role:          str
    npc_personality:   str
    context:           str
    opening_npc_line:  str
    recommended_turns: int
    max_turns:         int
    end_conditions:    dict
    success_criteria:  dict
    npc_behaviour:     dict
    apa_metadata:      dict


class RpeScenarioService:
    def __init__(self) -> None:
        self._scenarios: dict[str, Scenario] = {}

    def load_all(self) -> None:
        for path in SCENARIOS_DIR.glob("*.json"):
            data = json.loads(path.read_text())
            # Support old files that only have "turns"
            recommended_turns = data.get("recommended_turns", data.get("turns", 6))
            max_turns         = data.get("max_turns", 15)
            end_conditions    = data.get("end_conditions", _DEFAULT_END_CONDITIONS)
            self._scenarios[data["scenario_id"]] = Scenario(
                scenario_id=data["scenario_id"],
                title=data["title"],
                difficulty=data["difficulty"],
                conflict_type=data.get("conflict_type", "general"),
                npc_role=data["npc_role"],
                npc_personality=data["npc_personality"],
                context=data["context"],
                opening_npc_line=data["opening_npc_line"],
                recommended_turns=recommended_turns,
                max_turns=max_turns,
                end_conditions=end_conditions,
                success_criteria=data["success_criteria"],
                npc_behaviour=data.get("npc_behaviour", _DEFAULT_BEHAVIOUR),
                apa_metadata=data.get("apa_metadata", _DEFAULT_APA),
            )

    def get_scenario(self, scenario_id: str) -> Scenario | None:
        return self._scenarios.get(scenario_id)

    def list_all(self) -> list[dict]:
        return [
            {
                "scenario_id":       s.scenario_id,
                "title":             s.title,
                "difficulty":        s.difficulty,
                "conflict_type":     s.conflict_type,
                "turns":             s.recommended_turns,   # backward-compat alias
                "recommended_turns": s.recommended_turns,
                "max_turns":         s.max_turns,
                "target_skills":     s.apa_metadata.get("target_skills", []),
                "difficulty_weight": s.apa_metadata.get("difficulty_weight", 1.0),
            }
            for s in self._scenarios.values()
        ]

    def get_by_difficulty(self, level: str) -> list[dict]:
        return [s for s in self.list_all() if s["difficulty"] == level]

    def get_by_conflict_type(self, conflict_type: str) -> list[dict]:
        return [s for s in self.list_all() if s["conflict_type"] == conflict_type]

    def get_by_skill(self, skill: str) -> list[dict]:
        """Filter scenarios whose apa_metadata.target_skills contains skill."""
        return [
            s for s in self.list_all()
            if skill in self._scenarios[s["scenario_id"]].apa_metadata.get("target_skills", [])
        ]

    def get_by_big_five(self, trait: str) -> list[dict]:
        """Filter scenarios relevant to a Big Five personality trait."""
        return [
            s for s in self.list_all()
            if trait in self._scenarios[s["scenario_id"]].apa_metadata.get("big_five_relevance", [])
        ]

    def get_recommended_for_profile(self, big_five_scores: dict) -> list[dict]:
        """
        APA INTEGRATION HOOK — called by rpe_apa_service.py.
        Currently returns all scenarios sorted by difficulty_weight ascending.
        """
        return sorted(
            self.list_all(),
            key=lambda s: self._scenarios[s["scenario_id"]].apa_metadata.get("difficulty_weight", 1.0),
        )

    def available_ids(self) -> list[str]:
        return list(self._scenarios.keys())
