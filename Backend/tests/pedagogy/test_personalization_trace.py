"""
Personalization trace — logs how APM's teaching strategy and difficulty evolve
for specific learners across a sequence of RPE sessions.

Runs the real pure pipeline (no DB, no LLM, no HTTP):

    OCEAN + baseline ─► strategy_optimizer.optimize_strategy   (initial style)
                    └─► dda_engine.initial_difficulty           (initial 1-10)
    RPE FeedbackResponse ─► PerformanceAggregator.from_rpe_feedback
                         ─► dynamic_adjuster.adjust(mode="full") (per session)

Every persona plays the same scripted session sequence, so differences in the
trace come from the learner profile, not the inputs.

Output (also printed with `pytest -s`):
    tests/pedagogy/_trace/personalization_trace.json
    tests/pedagogy/_trace/personalization_trace.md
Override the directory with PERSONALIZATION_TRACE_DIR.

Run:
    pytest tests/pedagogy/test_personalization_trace.py -s
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.contracts.rpe import CoachingAdvice, FeedbackResponse, TurnMetric
from app.services.pedagogy.adapter import difficulty_int_to_label, infer_weak_skills
from app.services.pedagogy.aggregator import PerformanceAggregator
from app.services.pedagogy.dda_engine import initial_difficulty
from app.services.pedagogy.dynamic_adjuster import adjust
from app.services.pedagogy.strategy_optimizer import optimize_strategy
from app.services.pedagogy.types import BaselineSummary, OceanScores, TeachingStrategy

TRACE_DIR = Path(
    os.environ.get("PERSONALIZATION_TRACE_DIR", Path(__file__).parent / "_trace")
)

STYLE_FIELDS = ("tone", "pacing", "complexity", "npc_personality", "feedback_style")

# ---------------------------------------------------------------------------
# Personas — alex/jordan mirror app/api/v1/pedagogy_dev.py; sam and riley
# cover the mid-range defaults and the low-agreeableness branch.
# Baseline skill scores are on BaselineSummary's 0-1 scale (MCA 0-100 / 100).
# ---------------------------------------------------------------------------

PERSONAS: dict[str, dict] = {
    "alex": {
        "label": "Anxious introvert",
        "ocean": OceanScores(openness=40, conscientiousness=40, extraversion=25,
                             agreeableness=55, neuroticism=70),
        "baseline": BaselineSummary(
            has_baseline=True,
            skill_scores={"vocal_command": 0.25, "speech_fluency": 0.30,
                          "presence_engagement": 0.45, "emotional_regulation": 0.35},
            dominant_emotions=["fearful", "sad", "neutral"],
            stress_indicator=0.72, confidence_indicator=0.10,
        ),
    },
    "jordan": {
        "label": "Confident extrovert",
        "ocean": OceanScores(openness=65, conscientiousness=70, extraversion=80,
                             agreeableness=55, neuroticism=30),
        "baseline": BaselineSummary(
            has_baseline=True,
            skill_scores={"vocal_command": 0.78, "speech_fluency": 0.72,
                          "presence_engagement": 0.81, "emotional_regulation": 0.70},
            dominant_emotions=["happy", "neutral", "surprised"],
            stress_indicator=0.05, confidence_indicator=0.55,
        ),
    },
    "sam": {
        "label": "Mid-range, no baseline",
        "ocean": OceanScores(openness=50, conscientiousness=50, extraversion=50,
                             agreeableness=50, neuroticism=50),
        "baseline": BaselineSummary(has_baseline=False),
    },
    "riley": {
        "label": "Low agreeableness, calm",
        "ocean": OceanScores(openness=55, conscientiousness=45, extraversion=55,
                             agreeableness=30, neuroticism=35),
        "baseline": BaselineSummary(has_baseline=False),
    },
}

# ---------------------------------------------------------------------------
# Scripted RPE sessions (RPE scales: trust 0-100, escalation 0-5, quality 0-10)
# ---------------------------------------------------------------------------

SESSIONS: list[dict] = [
    {"name": "hard failure",    "outcome": "failure", "trust": 20, "escalation": 5, "quality": 3.0},
    {"name": "partial",         "outcome": "partial", "trust": 50, "escalation": 2, "quality": 5.2},
    {"name": "strong success",  "outcome": "success", "trust": 82, "escalation": 1, "quality": 8.0},
    {"name": "strong success",  "outcome": "success", "trust": 85, "escalation": 0, "quality": 8.5},
    {"name": "stressed failure","outcome": "failure", "trust": 35, "escalation": 4, "quality": 4.0},
]


def _feedback(user_id: str, idx: int, s: dict) -> FeedbackResponse:
    return FeedbackResponse(
        session_id=f"{user_id}-s{idx}",
        scenario_id="scenario_001",
        scenario_title="trace",
        user_id=user_id,
        outcome=s["outcome"],
        final_trust=s["trust"],
        final_escalation=s["escalation"],
        total_turns=5,
        turn_metrics=[
            TurnMetric(turn=t, assertiveness_score=s["quality"], empathy_score=s["quality"],
                       clarity_score=s["quality"], response_quality=s["quality"])
            for t in range(1, 6)
        ],
        coaching_advice=CoachingAdvice(overall_rating="good", summary="trace"),
    )


def _style(strategy: TeachingStrategy) -> dict[str, str]:
    return {f: getattr(strategy, f) for f in STYLE_FIELDS}


def _diff(before: dict[str, str], after: dict[str, str]) -> dict[str, str]:
    return {f: f"{before[f]} → {after[f]}" for f in STYLE_FIELDS if before[f] != after[f]}


def trace_persona(user_id: str, persona: dict) -> dict:
    ocean, baseline = persona["ocean"], persona["baseline"]
    strategy = optimize_strategy(ocean, baseline)
    difficulty, diff_rationale = initial_difficulty(ocean, baseline)

    trace = {
        "user_id": user_id,
        "label": persona["label"],
        "ocean": ocean.model_dump(),
        "baseline": baseline.model_dump(),
        "initial": {
            "style": _style(strategy),
            "difficulty": difficulty,
            "difficulty_band": difficulty_int_to_label(difficulty),
            "weak_skills": infer_weak_skills(ocean, strategy, baseline),
            "priority_skills": strategy.priority_skills,
            "rationale": strategy.rationale + diff_rationale,
        },
        "sessions": [],
    }

    for idx, s in enumerate(SESSIONS, start=1):
        signal = PerformanceAggregator.from_rpe_feedback(_feedback(user_id, idx, s))
        result = adjust(strategy, difficulty, signal, mode="full")
        before, after = _style(strategy), _style(result.new_strategy)
        trace["sessions"].append({
            "session": idx,
            "scenario": s["name"],
            "rpe": {k: s[k] for k in ("outcome", "trust", "escalation", "quality")},
            "signal": signal.model_dump(),
            "difficulty": f"{difficulty} → {result.new_difficulty}",
            "band": difficulty_int_to_label(result.new_difficulty),
            "style_changes": _diff(before, after),
            "style_after": after,
            "rationale": result.rationale,
        })
        strategy, difficulty = result.new_strategy, result.new_difficulty

    return trace


def _to_markdown(traces: list[dict]) -> str:
    lines = ["# APM personalization trace", ""]
    for t in traces:
        init = t["initial"]
        o = t["ocean"]
        lines += [
            f"## {t['user_id']} — {t['label']}",
            "",
            f"OCEAN O={o['openness']:.0f} C={o['conscientiousness']:.0f} "
            f"E={o['extraversion']:.0f} A={o['agreeableness']:.0f} N={o['neuroticism']:.0f}"
            f" · baseline={'yes' if t['baseline']['has_baseline'] else 'no'}",
            "",
            f"**Initial:** {', '.join(f'{k}={v}' for k, v in init['style'].items())}; "
            f"difficulty {init['difficulty']} ({init['difficulty_band']}); "
            f"weak skills: {', '.join(init['weak_skills']) or '—'}",
            "",
            *[f"- {r}" for r in init["rationale"]],
            "",
            "| # | RPE session | outcome | trust | esc | stress | conf | difficulty | style changes |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        for s in t["sessions"]:
            changes = "; ".join(f"{k}: {v}" for k, v in s["style_changes"].items()) or "—"
            lines.append(
                f"| {s['session']} | {s['scenario']} | {s['rpe']['outcome']} | {s['rpe']['trust']} "
                f"| {s['rpe']['escalation']} | {s['signal']['stress_level']:.2f} "
                f"| {s['signal']['confidence_score']:.2f} | {s['difficulty']} ({s['band']}) | {changes} |"
            )
        lines.append("")
    return "\n".join(lines)


@pytest.fixture(scope="module")
def traces() -> list[dict]:
    out = [trace_persona(uid, p) for uid, p in PERSONAS.items()]
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    (TRACE_DIR / "personalization_trace.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    md = _to_markdown(out)
    (TRACE_DIR / "personalization_trace.md").write_text(md, encoding="utf-8")
    print("\n" + md)
    return out


def _by_id(traces: list[dict]) -> dict[str, dict]:
    return {t["user_id"]: t for t in traces}


def test_profiles_get_different_initial_styles(traces):
    t = _by_id(traces)
    assert t["alex"]["initial"]["style"] != t["jordan"]["initial"]["style"]
    assert t["alex"]["initial"]["style"]["tone"] == "gentle"
    assert t["jordan"]["initial"]["style"]["tone"] == "challenging"
    assert t["alex"]["initial"]["difficulty"] < t["jordan"]["initial"]["difficulty"]


def test_same_sessions_produce_different_trajectories(traces):
    trajectories = {
        t["user_id"]: [(s["difficulty"], tuple(s["style_after"].values())) for s in t["sessions"]]
        for t in traces
    }
    assert trajectories["alex"] != trajectories["jordan"]


def test_difficulty_moves_at_most_one_per_session_and_stays_in_range(traces):
    for t in traces:
        for s in t["sessions"]:
            before, after = (int(x) for x in s["difficulty"].split(" → "))
            assert 1 <= after <= 10
            assert abs(after - before) <= 1, (t["user_id"], s)


def test_every_change_is_explained(traces):
    for t in traces:
        for s in t["sessions"]:
            changed = s["style_changes"] or s["difficulty"].split(" → ")[0] != s["difficulty"].split(" → ")[1]
            if changed:
                assert s["rationale"] and s["rationale"][0] != "No adjustment criteria met — plan unchanged"


def test_trace_files_written(traces):
    assert (TRACE_DIR / "personalization_trace.json").exists()
    assert (TRACE_DIR / "personalization_trace.md").exists()
