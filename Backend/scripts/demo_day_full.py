#!/usr/bin/env python3
"""
Demo Day — Full Adaptive Loop (authenticated)

Demonstrates the complete thesis end-to-end:
  1. Inject "Alex" (anxious introvert, N=70 E=25) with baseline evidence.
  2. Print Alex's calibrated plan — gentle/slow strategy, low difficulty.
  3. Simulate a failed session for Alex → difficulty drops further.
  4. Inject "Jordan" (confident extrovert, N=30 E=80) with baseline evidence.
  5. Print Jordan's contrasting plan — challenging/fast strategy, high difficulty.
  6. Simulate a successful session for Jordan → difficulty rises.
  7. Side-by-side comparison proving meaningful personalisation.

Requirements:
  • Backend running with APM_DEMO_MODE=true
  • A valid JWT for a test user (copy from browser dev tools or /api/v1/auth/token)

Usage:
    python scripts/demo_day_full.py --token <JWT> [--base-url http://localhost:8000]

The script creates all data under the authenticated user — run with a dedicated
demo account so it does not pollute real user data.
"""
from __future__ import annotations

import argparse
import sys

import httpx

# ---------------------------------------------------------------------------
# Terminal colours
# ---------------------------------------------------------------------------
_R = "\033[0m"
_BOLD = "\033[1m"
_GREEN = "\033[92m"
_CYAN = "\033[96m"
_RED = "\033[91m"
_YELLOW = "\033[93m"
_VIOLET = "\033[95m"


def c(text: str, code: str) -> str:
    return f"{code}{text}{_R}"


def bar(value: int, max_val: int = 10, width: int = 20) -> str:
    filled = round(value / max_val * width)
    return "█" * filled + "░" * (width - filled)


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def _client(base_url: str, token: str) -> httpx.Client:
    return httpx.Client(
        base_url=base_url,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )


def inject_persona(client: httpx.Client, persona_id: str) -> dict:
    resp = client.post("/api/v1/apa/demo/inject-persona", json={"persona_id": persona_id})
    resp.raise_for_status()
    return resp.json()


def simulate_session(client: httpx.Client, outcome: str) -> dict:
    resp = client.post("/api/v1/apa/demo/simulate-session", json={"outcome": outcome})
    resp.raise_for_status()
    return resp.json()


def get_plan(client: httpx.Client) -> dict:
    resp = client.get("/api/v1/apa/plan/me")
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

TONE_LABEL = {"gentle": "Gentle 🌿", "direct": "Direct", "challenging": "Challenging 🔥"}
PACING_LABEL = {"slow": "Slow", "moderate": "Moderate", "fast": "Fast ⚡"}
NPC_LABEL = {
    "warm_supportive": "Warm & Supportive",
    "professional": "Professional",
    "demanding_critical": "Demanding",
    "analytical_probing": "Analytical",
}
FEEDBACK_LABEL = {"encouraging": "Encouraging", "balanced": "Balanced", "blunt": "Blunt"}


def print_plan(label: str, plan: dict, colour: str) -> None:
    s = plan["strategy"]
    d = plan["difficulty"]
    brief = plan.get("brief_json") or {}
    baseline = plan.get("baseline_summary_json") or {}

    print(f"\n{c('─' * 56, colour)}")
    print(f"{c(f'  {label}', _BOLD)}")
    print(f"{c('─' * 56, colour)}")

    print(f"\n  Strategy:")
    print(f"    Tone        {c(TONE_LABEL.get(s['tone'], s['tone']), _BOLD)}")
    print(f"    Pacing      {PACING_LABEL.get(s['pacing'], s['pacing'])}")
    print(f"    Complexity  {s['complexity']}")
    print(f"    NPC         {NPC_LABEL.get(s['npc_personality'], s['npc_personality'])}")
    print(f"    Feedback    {FEEDBACK_LABEL.get(s['feedback_style'], s['feedback_style'])}")

    print(f"\n  Difficulty: {bar(d)} {d}/10")

    if baseline.get("has_baseline"):
        stress = int((baseline.get("stress_indicator") or 0) * 100)
        conf = int((baseline.get("confidence_indicator") or 0) * 100)
        print(f"\n  Baseline evidence:  stress={stress}%  confidence={conf}%")
        emotions = baseline.get("dominant_emotions") or []
        if emotions:
            print(f"  Dominant emotions:  {', '.join(emotions)}")

    if brief.get("summary"):
        print(f"\n  Brief: {brief['summary']}")

    if s.get("priority_skills"):
        print(f"  Focus skills: {', '.join(s['priority_skills'])}")


def print_comparison(intro_plan: dict, extro_plan: dict) -> list[str]:
    failures = []
    fields = ["tone", "pacing", "complexity", "npc_personality", "feedback_style"]
    i_s = intro_plan["strategy"]
    e_s = extro_plan["strategy"]
    i_d = intro_plan["difficulty"]
    e_d = extro_plan["difficulty"]

    print(f"\n{c('═' * 56, _CYAN)}")
    print(c("  Side-by-side comparison", _BOLD))
    print(f"{c('═' * 56, _CYAN)}")
    print(f"\n  {'Field':<24} {'Alex (intro)':<18} {'Jordan (extro)'}")
    print(f"  {'─' * 60}")
    for f in fields:
        i_v = i_s[f]
        e_v = e_s[f]
        mark = c("←", _GREEN) if i_v != e_v else " "
        print(f"  {f:<24} {i_v:<18} {e_v}  {mark}")
    diff_d = c("←", _GREEN) if i_d != e_d else " "
    print(f"  {'difficulty':<24} {i_d:<18} {e_d}  {diff_d}")

    # Thesis assertions
    print(f"\n  Assertions:")
    checks = [
        ("Alex tone == gentle",      i_s["tone"] == "gentle"),
        ("Alex pacing == slow",      i_s["pacing"] == "slow"),
        ("Jordan tone != gentle",    e_s["tone"] != "gentle"),
        ("Jordan pacing == fast",    e_s["pacing"] == "fast"),
        ("Jordan difficulty > Alex", e_d > i_d),
    ]
    for msg, ok in checks:
        mark = c("✓", _GREEN) if ok else c("✗", _RED)
        print(f"    {mark}  {msg}")
        if not ok:
            failures.append(msg)

    return failures


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="APM full demo — authenticated loop")
    parser.add_argument(
        "--base-url", default="http://localhost:8000",
        help="Backend URL (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--token", required=True,
        help="Bearer JWT for a demo user account",
    )
    args = parser.parse_args()

    print(c("\n" + "═" * 56, _CYAN))
    print(c("  Adaptive Pedagogy — Full Demo Loop", _BOLD))
    print(c("  Thesis: OCEAN + baseline → measurably different plans", _YELLOW))
    print(c("═" * 56, _CYAN))

    try:
        client = _client(args.base_url, args.token)

        # ---- Alex (anxious introvert) ----------------------------------------
        print(f"\n{c('Step 1/4', _VIOLET)} Injecting Alex (N=70, E=25) + baseline…")
        alex_plan = inject_persona(client, "alex")
        print_plan("Alex — initial plan (baseline-calibrated)", alex_plan, _YELLOW)

        print(f"\n{c('Step 2/4', _VIOLET)} Simulating a failed session for Alex…")
        alex_after = simulate_session(client, "failure")
        d_before = alex_plan["difficulty"]
        d_after = alex_after["difficulty"]
        delta = d_after - d_before
        arrow = c(f"↓ {abs(delta)}", _RED) if delta < 0 else c(f"↑ {delta}", _GREEN) if delta > 0 else "→ 0"
        print(f"  Difficulty: {d_before} {arrow} {d_after}  (plan adapted after session)")

        # ---- Jordan (confident extrovert) ------------------------------------
        print(f"\n{c('Step 3/4', _VIOLET)} Injecting Jordan (N=30, E=80) + baseline…")
        jordan_plan = inject_persona(client, "jordan")
        print_plan("Jordan — initial plan (baseline-calibrated)", jordan_plan, _CYAN)

        print(f"\n{c('Step 4/4', _VIOLET)} Simulating a successful session for Jordan…")
        jordan_after = simulate_session(client, "success")
        d_before_j = jordan_plan["difficulty"]
        d_after_j = jordan_after["difficulty"]
        delta_j = d_after_j - d_before_j
        arrow_j = c(f"↑ {delta_j}", _GREEN) if delta_j > 0 else c(f"↓ {abs(delta_j)}", _RED) if delta_j < 0 else "→ 0"
        print(f"  Difficulty: {d_before_j} {arrow_j} {d_after_j}  (plan adapted after session)")

        # ---- Comparison & verdict -------------------------------------------
        failures = print_comparison(alex_plan, jordan_plan)

        print(f"\n{c('═' * 56, _CYAN)}")
        if failures:
            print(c("  DEMO FAILED:", _RED))
            for f in failures:
                print(f"    ✗ {f}")
            sys.exit(1)
        else:
            diff_fields = sum(
                1 for f in ["tone", "pacing", "complexity", "npc_personality", "feedback_style"]
                if alex_plan["strategy"][f] != jordan_plan["strategy"][f]
            ) + (1 if alex_plan["difficulty"] != jordan_plan["difficulty"] else 0)
            print(c(f"  DEMO PASSED — {diff_fields}/6 fields differ ✓", _GREEN))
            print(f"  Alex: difficulty {alex_plan['difficulty']}→{d_after}"
                  f"  |  Jordan: difficulty {jordan_plan['difficulty']}→{d_after_j}")
            print(f"  Personalisation is real, measurable, and adaptive.")
        print(c("═" * 56, _CYAN) + "\n")

    except httpx.ConnectError:
        print(f"\n{c('ERROR', _RED)}: Cannot connect to {args.base_url}")
        print("  Start the backend: uvicorn app.main:app --reload")
        print("  Set APM_DEMO_MODE=true in .env")
        sys.exit(1)
    except httpx.HTTPStatusError as exc:
        print(f"\n{c('HTTP ERROR', _RED)}: {exc.response.status_code}")
        print(f"  {exc.response.text[:300]}")
        sys.exit(1)


if __name__ == "__main__":
    main()
