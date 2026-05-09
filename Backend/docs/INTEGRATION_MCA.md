# APM ↔ MCA Integration Guide

> **Audience:** Multimodal Communication Analysis (MCA) team  
> **APM contract version:** `SCHEMA_VERSION = 1` (`app/contracts/mca.py`)  
> **Last updated:** 2026-05-09

---

## Overview

MCA interacts with APM at **two distinct points**:

| Integration | When | Mechanism |
|-------------|------|-----------|
| Live nudges | During any MCA session | `POST /api/v1/apa/live-signals` |
| Baseline completion | After a *baseline* session ends | User/frontend calls `POST /api/v1/apa/baseline/complete` with the session UUID |

APM does **not** subscribe to MCA's WebSocket directly. Instead MCA (or the frontend
acting on MCA's behalf) POSTs nudge batches and baseline session IDs to APM's REST
endpoints.

---

## 1. Live nudges — mid-session difficulty adjustment

### Endpoint

```
POST /api/v1/apa/live-signals
```

### Authentication

```
Authorization: Bearer <user JWT>
```

The user must be authenticated. The endpoint reads the plan for the current user from
the JWT identity.

### Request body

```json
{
  "nudges": [
    {
      "emotion": "anxious",
      "confidence": 0.82,
      "nudge": "Speak more slowly",
      "nudge_category": "pace",
      "nudge_severity": "warning"
    },
    {
      "emotion": "calm",
      "confidence": 0.71,
      "nudge_category": "ser",
      "nudge_severity": "info"
    }
  ]
}
```

#### `McaNudge` field reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `emotion` | `string` | ✓ | Any emotion label (e.g. `"anxious"`, `"calm"`) |
| `confidence` | `float` 0.0 – 1.0 | ✓ | SVM classification confidence |
| `nudge` | `string \| null` | — | Human-readable coaching hint (not used by APM engine) |
| `nudge_category` | enum | ✓ | `volume`, `pitch`, `pace`, `clarity`, `fusion`, `silence`, `ser` |
| `nudge_severity` | enum | ✓ | `info`, `warning`, `critical` |

#### How APM aggregates nudges

| Signal | Formula |
|--------|---------|
| `engagement_score` | `1.0 − 0.6 × (volume+silence+clarity nudges / total)` |
| `stress_level` | `(critical + 0.5 × warning) / total` |
| `confidence_score` | mean of `nudge.confidence` values |
| `objective_completion_rate` | fixed at `0.5` (MCA cannot determine completion) |
| `outcome` | always `"partial"` (RPE owns outcome) |

### Response (`AdjustmentHintOut`)

```json
{
  "new_difficulty": 4,
  "rationale": [
    "Stress rising — difficulty reduced by 1",
    "Engagement holding steady"
  ],
  "signals_summary": {
    "engagement_score": 0.82,
    "confidence_score": 0.71,
    "stress_level": 0.40,
    "objective_completion_rate": 0.5,
    "outcome": "partial"
  }
}
```

APM only persists an `AdjustmentHistory` row when difficulty **actually changes**. If
difficulty is unchanged, the response still returns the current value — no DB write.

### Sending cadence

Send nudges in batches whenever your buffer fills or on a regular tick (e.g. every 5 s).
APM is stateless per call — each call is a fresh aggregation of the supplied nudges.
There is no session state on APM's side for live signals.

### curl example

```bash
curl -X POST http://localhost:8000/api/v1/apa/live-signals \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "nudges": [
      {"emotion": "anxious", "confidence": 0.85,
       "nudge_category": "pace", "nudge_severity": "critical"},
      {"emotion": "nervous", "confidence": 0.70,
       "nudge_category": "volume", "nudge_severity": "warning"}
    ]
  }'
```

---

## 2. Baseline session completion

The baseline is a special short MCA session whose results calibrate the user's training
plan. It changes difficulty, NPC personality, tone, and focus skills based on measured
vocal and emotional evidence — not just OCEAN traits.

### Step-by-step

```
┌────────────┐       write SessionResult        ┌───────────┐
│    MCA     │ ─────────────────────────────►   │  Postgres │
│  session   │  (status="completed", skills…)   │    DB     │
└────────────┘                                  └───────────┘
      │
      │ session UUID surfaced to frontend
      ▼
┌────────────┐  POST /apa/baseline/complete      ┌───────────┐
│  Frontend  │ ──────────────────────────────►  │   APM     │
│ /baseline  │  {"mca_session_id": "<uuid>"}     │           │
└────────────┘                                  └───────────┘
```

#### 2a. What MCA must write to `session_results`

APM reads the following columns when `POST /api/v1/apa/baseline/complete` is called:

| Column | Type | APM usage |
|--------|------|-----------|
| `id` | UUID | Looked up by `mca_session_id` |
| `user_id` | UUID | Ownership check (must match JWT user) |
| `status` | string | **Must be `"completed"`** — APM rejects `"active"` / `"failed"` |
| `skill_scores` | JSONB `{skill: float}` | Weak skill detection (values < 0.4) |
| `emotion_distribution` | JSONB `{emotion: float}` | Stress / confidence indicators |
| `overall_score` | integer | Forwarded to `BaselineSnapshot.overall_score` |
| `duration_seconds` | integer | Forwarded to `BaselineSnapshot.duration_seconds` |

**`skill_scores` keys** that APM uses for `priority_skills` must match the RPE skill
vocabulary (see `INTEGRATION_RPE.md §1`). Unrecognised keys are stored but not surfaced
to the scenario recommender.

**`emotion_distribution` values** must sum to approximately 1.0 (proportions). APM
derives:
- `stress_indicator` = sum of `{anxious, fearful, stressed, nervous, sad}` (clamped 0 – 1)
- `confidence_indicator` = sum of `{confident, calm, happy, neutral}` (clamped 0 – 1)

Example `session_results` row at the point APM reads it:

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "user_id": "...",
  "status": "completed",
  "overall_score": 62,
  "duration_seconds": 195,
  "skill_scores": {
    "assertiveness":      0.32,
    "boundary_setting":   0.28,
    "emotional_regulation": 0.55
  },
  "emotion_distribution": {
    "anxious": 0.40,
    "nervous": 0.25,
    "calm":    0.22,
    "neutral": 0.13
  }
}
```

#### 2b. Frontend call after MCA session ends

The frontend (or MCA if it holds a user JWT) calls:

```
POST /api/v1/apa/baseline/complete
Authorization: Bearer <user JWT>
Content-Type: application/json

{"mca_session_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6"}
```

APM validates:
1. `PersonalityProfile` exists (survey must be done first → 404 otherwise)
2. `SessionResult` exists with that UUID → 404 if not
3. `session_results.user_id` matches JWT user → 403 if not
4. `status == "completed"` → 400 if not

On success, APM:
- Upserts `BaselineSnapshot` (one row per user, overwrites on re-submission)
- Calls `generate_training_plan` so the plan immediately reflects baseline evidence
- Returns `{"baseline": <BaselineSnapshotOut>, "plan_id": "<uuid>"}`

```json
HTTP 201
{
  "baseline": {
    "id": "...",
    "user_id": "...",
    "mca_session_id": "3fa85f64-...",
    "skill_scores": { "assertiveness": 0.32, "boundary_setting": 0.28 },
    "emotion_distribution": { "anxious": 0.40, "calm": 0.22, "..." : 0.0 },
    "overall_score": 62.0,
    "duration_seconds": 195,
    "created_at": "2026-05-09T10:00:00Z",
    "updated_at": "2026-05-09T10:00:00Z"
  },
  "plan_id": "8f14e45f-ceea-467a-a866-cd7e5e7b5b6e"
}
```

---

## 3. Demo mode

When `APM_DEMO_MODE=true`, the frontend's `/baseline` page shows persona buttons that
call `POST /api/v1/apa/demo/inject-persona` — this **bypasses the MCA session entirely**
and loads pre-canned skill scores and emotion distributions for "Alex" or "Jordan".
MCA does not need to do anything for demo personas.

---

## 4. Invariants & gotchas

- **One baseline per user.** `BaselineSnapshot` has a `UNIQUE` constraint on `user_id`.
  Re-submitting a baseline (after a second MCA session) overwrites the previous one.
- **`session_type` is not checked.** Any `SessionResult` row can serve as a baseline
  source as long as `status == "completed"`. If you want only dedicated baseline sessions
  used, add a `session_type == "baseline"` check before surfacing the session UUID to
  the frontend.
- **Live signals have no session state.** Each `POST /apa/live-signals` is independent.
  APM does not accumulate nudge history between calls.
- **No direct WebSocket coupling.** APM intentionally does not subscribe to MCA's WS.
  This avoids auth coupling and lets APM be tested independently.

---

## 5. Schema version bumps

If you change `McaNudge` or the `session_results` schema, bump `SCHEMA_VERSION` in
`Backend/app/contracts/mca.py` and update the field reference tables in this document.
APM's `aggregator.py` (`from_mca_nudges`) and `pedagogy.py` (`complete_baseline`) will
need corresponding updates.
