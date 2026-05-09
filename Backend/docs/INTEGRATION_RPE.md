# APM ↔ RPE Integration Guide

> **Audience:** Role-Play Engine (RPE) team  
> **APM contract version:** `SCHEMA_VERSION = 1` (`app/contracts/rpe.py`)  
> **Last updated:** 2026-05-09

---

## Overview

The Adaptive Pedagogy Module (APM) personalises scenario selection and adjusts training
difficulty after each session. RPE interacts with APM at two points:

| Direction | When | Endpoint |
|-----------|------|----------|
| RPE → APM | Session ends | `POST /api/v1/apa/session-feedback` |
| APM → RPE | Plan generation | `POST /api/v1/rpe/apa/recommend` *(RPE-owned)* |

APM does **not** call RPE endpoints directly; it passes an `ApaLearnerProfile` to the
scenario recommender that RPE exposes. That flow is handled inside
`app/services/pedagogy/scenario_selector.py`.

---

## 1. What APM sends to RPE (scenario selection)

When `POST /api/v1/apa/plan/generate` is called, APM sends:

```json
POST /api/v1/rpe/apa/recommend
Content-Type: application/json

{
  "user_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "openness":           0.40,
  "conscientiousness":  0.40,
  "extraversion":       0.25,
  "agreeableness":      0.55,
  "neuroticism":        0.70,
  "weak_skills": ["assertiveness", "boundary_setting"],
  "recommended_difficulty": "beginner"
}
```

**Scale note:** All Big Five values are **0.0 – 1.0** (RPE wire format). APM stores
them as 0 – 100 internally; the conversion happens only in `app/services/pedagogy/adapter.py`.

`weak_skills` values are a subset of the RPE skill vocabulary:

```
assertiveness, conflict_resolution, professional_communication,
client_management, emotional_regulation, accountability,
political_awareness, trust_building, boundary_setting,
professional_assertiveness, self_advocacy
```

When a `BaselineSnapshot` exists for the user, `weak_skills` reflects *measured* skill
evidence rather than OCEAN-derived inference (baseline takes precedence, capped at 5).

`recommended_difficulty` maps difficulty integer 1 – 10 to:
- `1 – 4` → `"beginner"`
- `5 – 7` → `"intermediate"`
- `8 – 10` → `"advanced"`

---

## 2. Session-feedback callback (RPE → APM)

After each RPE session, post the `FeedbackResponse` to APM.

### Endpoint

```
POST /api/v1/apa/session-feedback
```

### Authentication

Accept **either**:

| Method | Header |
|--------|--------|
| Service-to-service | `X-Service-Token: <apm_service_token>` |
| User JWT | `Authorization: Bearer <jwt>` |

The `apm_service_token` value is set in APM's `.env` as `APM_SERVICE_TOKEN`. Use the
service token when RPE posts on behalf of the user after session end (no user context).

### Request body (`FeedbackResponse`)

```json
{
  "session_id":      "rpe-session-abc123",
  "scenario_id":     "scenario_002",
  "scenario_title":  "Workplace Conflict Resolution",
  "user_id":         "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "outcome":         "success",
  "final_trust":     78,
  "final_escalation": 1,
  "total_turns":     6,
  "turn_metrics": [
    {
      "turn": 1,
      "assertiveness_score": 0.72,
      "empathy_score": 0.65,
      "clarity_score": 0.80,
      "response_quality": 0.72,
      "flags": []
    }
  ],
  "risk_flags": [],
  "blind_spots": [],
  "coaching_advice": {
    "overall_rating": "good",
    "summary": "Clear communication under mild pressure.",
    "advice": ["Maintain eye contact analogues in text"],
    "strengths": ["assertiveness"],
    "focus_areas": ["boundary_setting"]
  },
  "viz_payload": {},
  "end_reason": "completed",
  "recommended_turns": 6,
  "max_turns": 8
}
```

#### Field semantics APM uses

| Field | APM usage |
|-------|-----------|
| `outcome` | `"success"` / `"failure"` / anything else → `"partial"` |
| `final_trust` | Confidence score: `final_trust / 100` → 0.0 – 1.0 |
| `final_escalation` | Stress proxy: `final_escalation / 4` → 0.0 – 1.0 |
| `turn_metrics[*].response_quality` | Mean → engagement score |
| `risk_flags[*].severity` | `"high"` / `"critical"` add +0.1 to stress each |

Fields not listed are persisted in `session_results` but not consumed by the adaptive engine.

### Response

Returns the updated `TrainingPlanOut` (HTTP 200):

```json
{
  "id": "...",
  "user_id": "...",
  "skill": "job_interview",
  "strategy": {
    "tone": "gentle",
    "pacing": "slow",
    "complexity": "simple",
    "npc_personality": "warm_supportive",
    "feedback_style": "encouraging",
    "rationale": ["..."],
    "priority_skills": []
  },
  "difficulty": 3,
  "recommended_scenario_ids": ["scenario_003"],
  "primary_scenario": { "..." : "..." },
  "generation_source": "rpe_library",
  "generation_status": "completed",
  "baseline_summary_json": null,
  "brief_json": { "summary": "...", "drivers": ["..."], "..." : "..." }
}
```

### Errors

| Status | Cause |
|--------|-------|
| `401` | Missing / invalid auth |
| `404` | No `TrainingPlan` for `user_id` — user must generate a plan first |
| `422` | Malformed payload (Pydantic validation failure) |

### curl example

```bash
curl -X POST http://localhost:8000/api/v1/apa/session-feedback \
  -H "X-Service-Token: $APM_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "rpe-abc",
    "scenario_id": "scenario_002",
    "scenario_title": "Conflict",
    "user_id": "<uuid>",
    "outcome": "success",
    "final_trust": 80,
    "final_escalation": 1,
    "total_turns": 5,
    "turn_metrics": [
      {"turn": 1, "assertiveness_score": 0.7, "empathy_score": 0.6,
       "clarity_score": 0.8, "response_quality": 0.75}
    ],
    "coaching_advice": {
      "overall_rating": "good", "summary": "Well done.",
      "advice": [], "strengths": [], "focus_areas": []
    }
  }'
```

---

## 3. Invariants & gotchas

- **One plan per user.** APM upserts on `user_id` — RPE must use the correct `user_id` UUID.
- **Session feedback is post-session only.** Send **one** `FeedbackResponse` per completed
  session. For mid-session signals, MCA uses `/apa/live-signals` (see `INTEGRATION_MCA.md`).
- **`coaching_advice` is required.** Pydantic will reject the payload if this field is absent.
  Send at minimum `{"overall_rating": "", "summary": "", "advice": [], "strengths": [], "focus_areas": []}`.
- **Difficulty stays within 1 – 10.** APM clamps automatically.
- **Analytics are written automatically.** Every `session-feedback` call writes to
  `session_metrics` and `feedback_entries` via `analytics_writer`. No extra RPE action needed.

---

## 4. Schema version bumps

If you change `FeedbackResponse` or `ApaLearnerProfile` shapes upstream, bump
`SCHEMA_VERSION` in `Backend/app/contracts/rpe.py` and add a changelog note. APM's
`aggregator.py` and `scenario_selector.py` will need corresponding updates.
