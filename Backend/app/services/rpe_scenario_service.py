import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path

from app.db.database import SessionLocal
from app.models.rpe_custom_scenario import RpeCustomScenario

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
SCENARIOS_DIR = BASE_DIR / "models" / "rpe" / "scenarios"


def derive_npc_gender(scenario_id: str) -> str:
    """
    "male" | "female", stable per scenario_id — used by the frontend to pick
    a matching profile picture for the NPC.

    No scenario (hand-authored or generated from a Training Plan brief) ever
    carries an actual gender for its NPC — role titles like "Aggressive
    Manager" are gender-neutral by design, and APM's CounterpartPersona
    contract has no such field either. Rather than forcing a meaningless
    "real" gender out of an LLM or hand-editing every scenario file, this
    derives a stable pick from the id itself: same scenario always shows the
    same NPC face across replays, deterministic and file-format-agnostic, so
    it covers every existing scenario and every future generated one for
    free — no data migration, nothing that can drift out of sync.
    """
    digest = hashlib.md5(scenario_id.encode()).hexdigest()
    return "male" if int(digest, 16) % 2 == 0 else "female"

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

# The 6 "what do you want to practice?" categories shown on the Practice Lab
# screen. Hand-authored scenarios carry an explicit "category" in their JSON;
# this is only the fallback for scenarios that don't (chiefly ones generated
# live from a Training Plan brief, via rpe_plan_import_service).
CATEGORIES = [
    "Difficult Conversations", "Negotiation", "Conflict",
    "Assertiveness", "Client Management", "Leadership",
]


def infer_category(conflict_type: str, target_skills: list[str], title: str) -> str:
    text   = f"{conflict_type} {title}".lower()
    skills = set(target_skills)

    if "negotiat" in text:
        return "Negotiation"
    if "client" in text or "client_management" in skills:
        return "Client Management"
    if "political_awareness" in skills or "trust_building" in skills or "sabotage" in text or "lead" in text:
        return "Leadership"
    if "peer" in text or "conflict" in text:
        return "Conflict"
    if skills & {"assertiveness", "professional_assertiveness", "self_advocacy"}:
        return "Assertiveness"
    return "Difficult Conversations"


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
    category:          str


class RpeScenarioService:
    def __init__(self) -> None:
        self._scenarios: dict[str, Scenario] = {}

    def load_all(self) -> None:
        """
        Loads base file scenarios (e.g. scenario_001 to scenario_005) into memory,
        then queries PostgreSQL (rpe_custom_scenarios) and merges all database scenarios.
        """
        # 1. Load from static JSON templates on disk
        for path in SCENARIOS_DIR.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                recommended_turns = data.get("recommended_turns", data.get("turns", 6))
                max_turns         = data.get("max_turns", 15)
                end_conditions    = data.get("end_conditions", _DEFAULT_END_CONDITIONS)
                apa_metadata      = data.get("apa_metadata", _DEFAULT_APA)
                category = data.get("category") or infer_category(
                    data.get("conflict_type", "general"),
                    apa_metadata.get("target_skills", []),
                    data["title"],
                )
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
                    apa_metadata=apa_metadata,
                    category=category,
                )
            except Exception as exc:
                logger.warning("Failed loading scenario file %s: %s", path, exc)

        # 2. Merge from Database (rpe_custom_scenarios)
        try:
            db = SessionLocal()
            try:
                db_scenarios = db.query(RpeCustomScenario).all()
                for s in db_scenarios:
                    apa_meta = s.apa_metadata or _DEFAULT_APA
                    self._scenarios[s.id] = Scenario(
                        scenario_id=s.id,
                        title=s.title,
                        difficulty=s.difficulty,
                        conflict_type=s.conflict_type or "general",
                        npc_role=s.npc_role,
                        npc_personality=s.npc_personality,
                        context=s.context,
                        opening_npc_line=s.opening_npc_line,
                        recommended_turns=s.recommended_turns,
                        max_turns=s.max_turns,
                        end_conditions=s.end_conditions or _DEFAULT_END_CONDITIONS,
                        success_criteria=s.success_criteria or {},
                        npc_behaviour=s.npc_behaviour or _DEFAULT_BEHAVIOUR,
                        apa_metadata=apa_meta,
                        category=s.category or infer_category(
                            s.conflict_type or "general",
                            apa_meta.get("target_skills", []),
                            s.title,
                        ),
                    )
            finally:
                db.close()
        except Exception as exc:
            logger.warning("Failed loading scenarios from database: %s", exc)

    def get_scenario(self, scenario_id: str) -> Scenario | None:
        scenario = self._scenarios.get(scenario_id)
        if scenario:
            return scenario

        # If not present in memory, try a direct DB lookup (e.g. freshly created)
        try:
            db = SessionLocal()
            try:
                s = db.query(RpeCustomScenario).filter_by(id=scenario_id).first()
                if s:
                    apa_meta = s.apa_metadata or _DEFAULT_APA
                    loaded = Scenario(
                        scenario_id=s.id,
                        title=s.title,
                        difficulty=s.difficulty,
                        conflict_type=s.conflict_type or "general",
                        npc_role=s.npc_role,
                        npc_personality=s.npc_personality,
                        context=s.context,
                        opening_npc_line=s.opening_npc_line,
                        recommended_turns=s.recommended_turns,
                        max_turns=s.max_turns,
                        end_conditions=s.end_conditions or _DEFAULT_END_CONDITIONS,
                        success_criteria=s.success_criteria or {},
                        npc_behaviour=s.npc_behaviour or _DEFAULT_BEHAVIOUR,
                        apa_metadata=apa_meta,
                        category=s.category or infer_category(
                            s.conflict_type or "general",
                            apa_meta.get("target_skills", []),
                            s.title,
                        ),
                    )
                    self._scenarios[s.id] = loaded
                    return loaded
            finally:
                db.close()
        except Exception as exc:
            logger.warning("Failed querying scenario %s from DB: %s", scenario_id, exc)

        return None

    def list_all(self, current_user_id: str | None = None) -> list[dict]:
        """
        Hand-authored scenarios are shared library content — everyone sees
        them. Generated ones are tied to whoever's Training Plan produced
        them (apa_metadata.recommended_for_profile, set from the plan's
        user_id in rpe_plan_import_service.map_brief_to_scenario) and must
        only show up for that same user, never for other users or guests.
        """
        # Ensure fresh DB scenarios are loaded
        self.load_all()

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
                "is_generated":      bool(s.apa_metadata.get("plan_generated")),
                "context":           s.context,
                "category":          s.category,
            }
            for s in self._scenarios.values()
            if not s.apa_metadata.get("plan_generated")
            or s.apa_metadata.get("recommended_for_profile") == current_user_id
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
