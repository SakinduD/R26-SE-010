# APM Demo Runbook — May 08 Presentation

## Goal

Demonstrate end-to-end adaptation: two distinct personas (introvert vs. extrovert)
receive provably different training strategies and starting difficulties from the same
Adaptive Pedagogical Module (APM), proving the thesis.

---

## 1. Pre-demo setup

### 1.1 Database migration

Run the APM migration **once** before the demo:

```bash
cd Backend
alembic upgrade head
```

This creates `training_plans` and `adjustment_history` tables.
The migration file: `migrations/versions/20260504_001_add_training_plan_and_adjustment_history.py`

### 1.2 Environment variables

Copy `.env.example` to `.env` and fill in:

```
GEMINI_API_KEY=your-key-here
GROQ_API_KEY=your-groq-key
GEMINI_MODEL=gemini-2.5-flash
APM_SERVICE_TOKEN=change-me-shared-with-rpe
APM_WRITE_ANALYTICS=true
RPE_BASE_URL=http://localhost:8000
```

The Supabase vars are required for auth. GEMINI_API_KEY is required for scenario
generation fallback.

---

## 2. Start services

### Backend

```bash
cd Backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Confirm running: http://localhost:8000/docs → look for `/api/v1/apa/demo/strategy`

### Frontend

```bash
cd frontend
npm install
VITE_DEMO_MODE=true npm run dev
```

The `VITE_DEMO_MODE=true` flag activates the demo banner on the Training Plan page.

---

## 3. Demo walkthrough

### Step 1 — Stateless strategy comparison (no auth required)

Open two browser tabs or run the demo script:

**Tab A — Introvert persona:**
```
http://localhost:8000/api/v1/apa/demo/strategy?extraversion=25&neuroticism=70&openness=40&conscientiousness=40
```

**Tab B — Extrovert persona:**
```
http://localhost:8000/api/v1/apa/demo/strategy?extraversion=80&neuroticism=30&openness=65&conscientiousness=70
```

**Or run the automated script:**
```bash
cd Backend
python scripts/demo_two_personas.py
```

Expected output: `DEMO PASSED — 6 of 6 strategy fields differ ✓`

### Step 2 — Full authenticated flow

1. Sign up two accounts (one per persona) or use existing accounts
2. For each account: complete the BFI-44 survey with the target OCEAN profile
3. Navigate to `/training-plan` — a plan is auto-generated on survey submit
4. Show side-by-side: the two Training Plan pages have visibly different strategies

### Step 3 — Adaptive loop demonstration

1. In the RPE, complete a practice session with one of the accounts
2. The RPE will POST to `/api/v1/apa/session-feedback` when the session ends
3. Refresh the Training Plan page → the Adjustment History section shows what changed
4. Point to the before/after difficulty and strategy values

---

## 4. Thesis evidence tables

### 4.1 Two-persona strategy comparison

| Field              | Introvert (E=25, N=70)  | Extrovert (E=80, N=30) | Differs? |
|--------------------|-------------------------|------------------------|----------|
| tone               | `gentle`                | `challenging`          | ✓        |
| pacing             | `slow`                  | `fast`                 | ✓        |
| complexity         | `simple`                | `complex`              | ✓        |
| npc_personality    | `warm_supportive`       | `professional`         | ✓        |
| feedback_style     | `encouraging`           | `balanced`             | ✓        |
| difficulty (1-10)  | **2**                   | **7**                  | ✓        |

*Values are deterministic — computed purely from OCEAN → strategy_optimizer + dda_engine,
no LLM involved.*

**Derivation trace — Introvert (O=40, C=40, E=25, A=55, N=70):**
- N=70 > 60: tone=`gentle`, feedback=`encouraging` (safety wins over all)
- E=25 < 40: pacing=`slow`, npc=`warm_supportive`
- O=40 not in range → complexity stays `moderate`
- C=40 not < 40 → no reduction → but O=40 < 40 is false (equal, not less)
- DDA: base=5, N>60 → -2=3, E<40 → -1=2 → **difficulty=2**

**Derivation trace — Extrovert (O=65, C=70, E=80, A=55, N=30):**
- N=30 < 40: tone=`challenging`
- E=80 > 60: pacing=`fast`
- O=65 > 60: complexity=`complex`
- DDA: base=5, N<40 → +1=6, O>60 → +1=7 → **difficulty=7**

### 4.2 Adaptive loop proof

| Signal                          | Rule triggered                    | Effect                        |
|---------------------------------|-----------------------------------|-------------------------------|
| outcome=failure, stress=0.8     | Rule 1: failure + high stress     | difficulty−1, tone softened   |
| outcome=success, completion>0.8 | Rule 2: strong success            | difficulty+1, complexity up   |
| outcome=success, stress<0.3     | Rule 3: relaxed success           | pacing up one step            |
| confidence<0.4                  | Rule 4: sustained low confidence  | npc=warm_supportive           |
| Same signal on different plans  | Same delta, different baseline    | **Different endpoint ✓**      |

### 4.3 RPE skill vocabulary (cited to scenario JSON files)

| Skill name                   | Source JSON      |
|------------------------------|------------------|
| assertiveness                | scenario_002, 004 |
| conflict_resolution          | scenario_002      |
| professional_communication   | scenario_002      |
| client_management            | scenario_003      |
| emotional_regulation         | scenario_003      |
| accountability               | scenario_003      |
| political_awareness          | scenario_004      |
| trust_building               | scenario_004      |
| boundary_setting             | scenario_005      |
| professional_assertiveness   | scenario_005      |
| self_advocacy                | scenario_005      |

### 4.4 APM ↔ RPE contract (schema version 1)

| APM type             | Mirrors                              | Scale          |
|----------------------|--------------------------------------|----------------|
| `ApaLearnerProfile`  | rpe_apa_service.ApaLearnerProfile    | 0.0–1.0 (RPE)  |
| `ScenarioSummary`    | app/schemas/rpe.py::ScenarioSummary  | —              |
| `ScenarioDetail`     | app/schemas/rpe.py::ScenarioDetail   | —              |
| `FeedbackResponse`   | app/schemas/rpe.py::FeedbackResponse | —              |
| `McaNudge`           | app/api/v1/mca/base_types.py::Nudge  | —              |

*APM stores OCEAN as 0–100 internally. The single conversion site is
`app/services/pedagogy/adapter.py::to_rpe_profile()`.*

---

## 5. Verification commands

### Run all APM tests
```bash
cd Backend
pytest tests/pedagogy/ -v
```

### Run only thesis tests
```bash
pytest tests/pedagogy/ -v -k "two_personas or same_signal"
```

### Run demo loop
```bash
python scripts/demo_two_personas.py --base-url http://localhost:8000
```

### Test session feedback with service token
```bash
curl -X POST http://localhost:8000/api/v1/apa/session-feedback \
  -H "Content-Type: application/json" \
  -H "X-Service-Token: change-me-shared-with-rpe" \
  -d '{
    "session_id": "demo-session-001",
    "scenario_id": "scenario_002",
    "scenario_title": "Performance Review",
    "user_id": "<paste-uuid-here>",
    "outcome": "success",
    "final_trust": 80,
    "final_escalation": 1,
    "total_turns": 6,
    "turn_metrics": [
      {"turn": 1, "assertiveness_score": 0.8, "empathy_score": 0.7, "clarity_score": 0.9, "response_quality": 0.85}
    ],
    "coaching_advice": {"overall_rating": "good", "summary": "Solid performance"}
  }'
```

---

## 6. File inventory

| File | Purpose |
|------|---------|
| `Backend/app/contracts/rpe.py` | APM↔RPE wire contracts (SCHEMA_VERSION=1) |
| `Backend/app/contracts/mca.py` | APM↔MCA wire contracts (SCHEMA_VERSION=1) |
| `Backend/app/models/training_plan.py` | TrainingPlan + AdjustmentHistory SQLAlchemy models |
| `Backend/app/services/pedagogy/strategy_optimizer.py` | OCEAN → TeachingStrategy (pure function) |
| `Backend/app/services/pedagogy/dda_engine.py` | OCEAN → initial difficulty (pure function) |
| `Backend/app/services/pedagogy/dynamic_adjuster.py` | PerformanceSignal → AdjustmentResult (pure) |
| `Backend/app/services/pedagogy/aggregator.py` | RPE/MCA signals → PerformanceSignal (pure) |
| `Backend/app/services/pedagogy/adapter.py` | THE scale-conversion site (0-100↔0-1) |
| `Backend/app/services/pedagogy/scenario_selector.py` | Hybrid RPE + Gemini scenario selection |
| `Backend/app/services/pedagogy/orchestrator.py` | End-to-end plan generation + feedback loop |
| `Backend/app/services/pedagogy/analytics_writer.py` | Side-effect analytics writes (feature-flagged) |
| `Backend/app/api/v1/pedagogy.py` | APM REST endpoints (6 routes under /apa) |
| `Backend/app/core/llm_client.py` | Gemini API client (google-genai SDK) |
| `Backend/app/core/rpe_client.py` | RPE HTTP client |
| `Backend/tests/pedagogy/` | 8 test files; 2 thesis tests are `test_two_personas_*` |
| `frontend/src/pages/app/TrainingPlan.jsx` | Training plan page with history |
| `frontend/src/lib/api/pedagogy.js` | Frontend API client for APM |
| `Backend/scripts/demo_two_personas.py` | End-to-end demo script (< 5 seconds) |
