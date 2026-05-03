from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

_SCENARIOS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "scenarios")
)


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
    success_criteria: dict[str, Any]
    npc_behaviour: dict[str, Any]


class ScenarioManager:
    def __init__(self) -> None:
        self._scenarios: dict[str, Scenario] = {}
        self._loaded = False

    def load_scenario(self, scenario_id: str) -> Scenario:
        path = os.path.join(_SCENARIOS_DIR, f"{scenario_id}.json")
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        scenario = Scenario(**data)
        self._scenarios[scenario_id] = scenario
        return scenario

    def load_all(self) -> list[Scenario]:
        result: list[Scenario] = []
        if not os.path.isdir(_SCENARIOS_DIR):
            return result
        for fname in os.listdir(_SCENARIOS_DIR):
            if fname.endswith(".json"):
                result.append(self.load_scenario(fname[:-5]))
        self._loaded = True
        return result

    def _ensure_loaded(self) -> None:
        if not self._loaded:
            self.load_all()

    def list_all_scenarios(self) -> list[Scenario]:
        self._ensure_loaded()
        return list(self._scenarios.values())

    def get_by_difficulty(self, level: str) -> list[Scenario]:
        self._ensure_loaded()
        return [s for s in self._scenarios.values() if s.difficulty == level]

    def get_by_conflict_type(self, conflict_type: str) -> list[Scenario]:
        self._ensure_loaded()
        return [s for s in self._scenarios.values() if s.conflict_type == conflict_type]

    def available_ids(self) -> list[str]:
        self._ensure_loaded()
        return list(self._scenarios.keys())
