#!/usr/bin/env python3
"""
Demo script: Adaptive Pedagogy — Two Personas

Shows that an introvert (high-N, low-E) and an extrovert (low-N, high-E)
receive provably different teaching strategies and starting difficulties
from the same APM engine.

Usage:
    python scripts/demo_two_personas.py [--base-url http://localhost:8000]

The /apa/demo/strategy endpoint is stateless and requires no auth, so this
script runs without any credentials. Target runtime: < 5 seconds.
"""
from __future__ import annotations

import argparse
import sys

import httpx

# ---- Persona definitions ---------------------------------------------------

PERSONAS = {
    "Introvert": {
        "openness": 40,
        "conscientiousness": 40,
        "extraversion": 25,
        "agreeableness": 55,
        "neuroticism": 70,
        "description": "High anxiety, low energy, cautious — needs gentle entry",
    },
    "Extrovert": {
        "openness": 65,
        "conscientiousness": 70,
        "extraversion": 80,
        "agreeableness": 55,
        "neuroticism": 30,
        "description": "High drive, high energy, curious — ready for challenge",
    },
}

# Expected paper-trail values (verified by tracing strategy_optimizer rules)
EXPECTED = {
    "Introvert": {"tone": "gentle", "pacing": "slow", "difficulty": 2},
    "Extrovert": {"tone": "challenging", "pacing": "fast", "difficulty": 7},
}

_RESET = "\033[0m"
_BOLD  = "\033[1m"
_GREEN = "\033[92m"
_CYAN  = "\033[96m"
_RED   = "\033[91m"
_YELLOW = "\033[93m"


def _col(text: str, code: str) -> str:
    return f"{code}{text}{_RESET}"


def _bar(value: int, max_val: int = 10, width: int = 20, fill: str = "█") -> str:
    filled = round(value / max_val * width)
    return fill * filled + "░" * (width - filled)


def fetch_strategy(base_url: str, scores: dict) -> dict:
    params = {k: v for k, v in scores.items() if k != "description"}
    with httpx.Client(timeout=10) as client:
        resp = client.get(f"{base_url}/api/v1/apa/demo/strategy", params=params)
    resp.raise_for_status()
    return resp.json()


def print_persona(name: str, persona: dict, result: dict, expected: dict) -> list[str]:
    s = result["strategy"]
    d = result["difficulty"]
    failures = []

    print(f"\n{_col('─' * 50, _CYAN)}")
    print(f"{_col(f'  {name}', _BOLD)}")
    print(f"  {persona['description']}")
    print(f"{_col('─' * 50, _CYAN)}")

    print(f"\n  OCEAN input:")
    for trait in ("openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"):
        v = persona[trait]
        bar = _bar(v, 100, 15)
        print(f"    {trait[0].upper()} {bar} {v:>3}")

    print(f"\n  Strategy computed:")
    print(f"    Tone             {_col(s['tone'], _BOLD)}")
    print(f"    Pacing           {s['pacing']}")
    print(f"    Complexity       {s['complexity']}")
    print(f"    NPC personality  {s['npc_personality']}")
    print(f"    Feedback style   {s['feedback_style']}")
    print(f"\n  Difficulty:  {_bar(d)} {d}/10")

    if s["rationale"]:
        print(f"\n  Rationale:")
        for r in s["rationale"][:3]:
            print(f"    · {r}")

    # Verify against expected
    print(f"\n  Assertions:")
    for field, exp in expected.items():
        actual = d if field == "difficulty" else s[field]
        ok = actual == exp
        mark = _col("✓", _GREEN) if ok else _col("✗", _RED)
        msg = f"    {mark} {field}: expected {exp!r}, got {actual!r}"
        if not ok:
            failures.append(msg)
        print(msg)

    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description="APM two-persona demo")
    parser.add_argument(
        "--base-url", default="http://localhost:8000",
        help="Backend base URL (default: http://localhost:8000)"
    )
    args = parser.parse_args()

    print(_col("\n═" * 60, _CYAN))
    print(_col("  Adaptive Pedagogy — Two-Persona Demo", _BOLD))
    print(_col("  Thesis: Same engine, different OCEAN → different strategy", _YELLOW))
    print(_col("═" * 60, _CYAN))

    all_failures = []
    results = {}

    for name, persona in PERSONAS.items():
        try:
            result = fetch_strategy(args.base_url, persona)
        except httpx.ConnectError:
            print(f"\n{_col('ERROR', _RED)}: Cannot connect to {args.base_url}")
            print("  Make sure the backend is running: uvicorn app.main:app --reload")
            sys.exit(1)
        results[name] = result
        failures = print_persona(name, persona, result, EXPECTED[name])
        all_failures.extend(failures)

    # Side-by-side comparison
    print(f"\n{_col('═' * 60, _CYAN)}")
    print(_col("  Side-by-side comparison", _BOLD))
    print(_col("═" * 60, _CYAN))

    fields = ["tone", "pacing", "complexity", "npc_personality", "feedback_style"]
    intro_s = results["Introvert"]["strategy"]
    extro_s = results["Extrovert"]["strategy"]
    intro_d = results["Introvert"]["difficulty"]
    extro_d = results["Extrovert"]["difficulty"]

    header = f"  {'Field':<22} {'Introvert':<22} {'Extrovert':<22}"
    print(f"\n{header}")
    print(f"  {'─' * 66}")
    for f in fields:
        i_val = intro_s[f]
        e_val = extro_s[f]
        diff_mark = _col("←", _GREEN) if i_val != e_val else " "
        print(f"  {f:<22} {i_val:<22} {e_val:<22} {diff_mark}")
    diff_mark = _col("←", _GREEN) if intro_d != extro_d else " "
    print(f"  {'difficulty':<22} {intro_d:<22} {extro_d:<22} {diff_mark}")

    # Final verdict
    print(f"\n{_col('═' * 60, _CYAN)}")
    if all_failures:
        print(_col("  DEMO FAILED — expected values not matched:", _RED))
        for f in all_failures:
            print(f)
        sys.exit(1)
    else:
        diff_count = sum(
            1 for f in fields
            if intro_s[f] != extro_s[f]
        ) + (1 if intro_d != extro_d else 0)
        print(_col(f"  DEMO PASSED — {diff_count} of 6 strategy fields differ ✓", _GREEN))
        print(f"  Introvert difficulty {intro_d} vs extrovert difficulty {extro_d}")
        print(f"  Adaptation is real and measurable.")
    print(_col("═" * 60, _CYAN) + "\n")


if __name__ == "__main__":
    main()
