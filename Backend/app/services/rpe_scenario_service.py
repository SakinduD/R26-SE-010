import json
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SCENARIOS_DIR = BASE_DIR / "models" / "rpe" / "scenarios"


@dataclass
class Scenario:
    scenario_id: str
    title: str
    difficulty: str
    conflict_type: str
    npc_role: str
    npc_personality: str
    context: str
    opening_npc_line: str
    turns: int
    success_criteria: dict
    npc_behaviour: dict


class RpeScenarioService:
    def __init__(self) -> None:
        self._scenarios: dict[str, Scenario] = {}

    def load_all(self) -> None:
        for path in SCENARIOS_DIR.glob("*.json"):
            data = json.loads(path.read_text())
            self._scenarios[data["scenario_id"]] = Scenario(
                scenario_id=data["scenario_id"],
                title=data["title"],
                difficulty=data["difficulty"],
                conflict_type=data.get("conflict_type", "general"),
                npc_role=data["npc_role"],
                npc_personality=data["npc_personality"],
                context=data["context"],
                opening_npc_line=data["opening_npc_line"],
                turns=data["turns"],
                success_criteria=data["success_criteria"],
                npc_behaviour=data.get("npc_behaviour", {
                    "trust_thresholds": {"cooperative": 70, "neutral": 40, "hostile": 0},
                    "escalation_thresholds": {"furious": 4, "irritated": 2, "controlled": 0},
                }),
            )

    def get_scenario(self, scenario_id: str) -> Scenario | None:
        return self._scenarios.get(scenario_id)

    def list_all(self) -> list[dict]:
        return [
            {
                "scenario_id": s.scenario_id,
                "title": s.title,
                "difficulty": s.difficulty,
                "conflict_type": s.conflict_type,
                "turns": s.turns,
            }
            for s in self._scenarios.values()
        ]

    def get_by_difficulty(self, level: str) -> list[dict]:
        return [s for s in self.list_all() if s["difficulty"] == level]

    def get_by_conflict_type(self, conflict_type: str) -> list[dict]:
        return [s for s in self.list_all() if s["conflict_type"] == conflict_type]

    def available_ids(self) -> list[str]:
        return list(self._scenarios.keys())
