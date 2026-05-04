"""Phase 3 verification — run from project root after server is up.

    python training/rpe/verify_phase3.py
"""
import json, sys, urllib.request, urllib.error

BASE = "http://127.0.0.1:8000/api/v1/rpe"

def get(path):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=10) as r:
        return json.loads(r.read())

def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def post_code(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=data,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

results = {}

# Server reachable?
print("[CHECK 0] Server reachable")
try:
    get("/scenarios")
    print("  Server OK")
except Exception as exc:
    print(f"  Server unreachable: {exc}")
    sys.exit(1)

# CHECK 1 — 5 scenarios
print("[CHECK 1] All 5 scenarios load")
scenarios = get("/scenarios")
ids = sorted(s["scenario_id"] for s in scenarios)
print(f"  IDs: {ids}")
results["All 5 scenarios load on startup"] = ids == [
    "scenario_001","scenario_002","scenario_003","scenario_004","scenario_005"]

# CHECK 2 — difficulty filter
print("[CHECK 2] Difficulty filter intermediate")
inter = get("/scenarios/difficulty/intermediate")
inter_ids = sorted(s["scenario_id"] for s in inter)
print(f"  {inter_ids}")
results["Difficulty filter returns correct subset"] = inter_ids == ["scenario_003","scenario_004"]

# CHECK 3 — conflict type filter
print("[CHECK 3] Conflict type autonomy_conflict")
auto = get("/scenarios/type/autonomy_conflict")
print(f"  {[s['scenario_id'] for s in auto]}")
results["Conflict type filter returns correct subset"] = (
    len(auto) == 1 and auto[0]["scenario_id"] == "scenario_005")

# CHECK 4 — skill filter
print("[CHECK 4] Skill filter assertiveness")
asc = get("/scenarios/skill/assertiveness")
print(f"  {sorted(s['scenario_id'] for s in asc)}")
results["Skill filter works for assertiveness"] = len(asc) >= 2

# CHECK 5 — APA recommend stub
print("[CHECK 5] APA recommend endpoint")
recs = post("/apa/recommend", {"user_id": "test_user", "recommended_difficulty": "beginner"})
weights = [s.get("difficulty_weight") for s in recs]
print(f"  {len(recs)} scenarios, weights={weights}")
results["APA recommend endpoint responds (stub)"] = len(recs) >= 1

# CHECK 6 — scenario_003 detail (harder NPC)
print("[CHECK 6] scenario_003 detail")
d3 = get("/scenarios/detail/scenario_003")
irr3 = d3["npc_behaviour"]["escalation_thresholds"]["irritated"]
print(f"  irritated_threshold={irr3}  (need 1 for harder NPC)")
results["scenario_003 harder to calm than scenario_001"] = irr3 == 1

# CHECK 7 — scenario_005 cooperative threshold
print("[CHECK 7] scenario_005 cooperative threshold")
d5 = get("/scenarios/detail/scenario_005")
coop5 = d5["npc_behaviour"]["trust_thresholds"]["cooperative"]
print(f"  cooperative_threshold={coop5}  (need 80)")
results["scenario_005 NPC only softens at trust >= 80"] = coop5 == 80

# CHECK 8 — invalid scenario 404
print("[CHECK 8] Invalid scenario 404")
code, body = post_code("/start-session", {"scenario_id": "scenario_999", "user_id": "test"})
detail = body.get("detail", "")
print(f"  status={code}, detail_snippet='{detail[:80]}'")
results["Invalid scenario returns 404 with available IDs"] = (
    code == 404 and "scenario_" in detail)

# CHECK 9 — APA service TODO count (static)
import pathlib
apa_path = pathlib.Path("Backend/app/services/rpe_apa_service.py")
todo_n = apa_path.read_text().count("TODO:")
print(f"[CHECK 9] rpe_apa_service TODO markers: {todo_n}")
results["rpe_apa_service.py has clear TODO comments for APA owner"] = todo_n >= 5

# Summary
print(f"\n{'='*62}")
print("PHASE 3 PASS CRITERIA RESULTS")
print(f"{'='*62}")
all_pass = True
for check, ok in results.items():
    print(f"  {'PASS' if ok else 'FAIL'}  {check}")
    if not ok:
        all_pass = False
print(f"{'='*62}")
print("ALL CHECKS PASSED" if all_pass else "SOME CHECKS FAILED")
