# Handoff: generating RPE scenarios from an APM Training Plan

> **From:** APM (Adaptive Pedagogical Module)
> **To:** RPE (Role-Play Engine)
> **Status:** APM side is built and tested. Nothing is blocked on APM.
> **Contract version:** `SCHEMA_VERSION = "1.0.0"`
> **Authority:** [`INTEGRATION_TRAINING_PLAN.md`](./INTEGRATION_TRAINING_PLAN.md) is the
> field-by-field reference. This document is the *implementation* brief — what to build and
> in what order. Where the two disagree, the contract doc wins.

---

## 1. What changed, in one paragraph

Learners can now type what workplace situation they want to practise. APM combines that goal
with their Big Five profile, MCA voice baseline and recent session history, and composes a
**Training Plan** — a complete build spec for one scenario. Your job is to turn that spec into
a playable scenario. APM says *what the scenario must contain*; you write *the scenario itself*.

You do not need to change anything you already have. `/rpe/apa/recommend`, `/rpe/start-session`,
`/rpe/session-respond` and the session-feedback callback all keep working exactly as they do
today. This is an additional input path, not a replacement.

---

## 2. The one endpoint you call

```
GET /api/v1/apa/training-plan/{plan_id}/scenario-brief
```

### Auth — either works

| Method | Header |
|--------|--------|
| Service-to-service (use this) | `X-Service-Token: <APM_SERVICE_TOKEN>` |
| User JWT | `Authorization: Bearer <jwt>` |

`APM_SERVICE_TOKEN` is already in `Backend/.env` — the same value you use for the
`/apa/session-feedback` callback. With a JWT instead, the caller must own the plan or you get
a `404`.

### Try it right now

```bash
curl -s http://localhost:8000/api/v1/apa/training-plan/<PLAN_ID>/scenario-brief \
  -H "X-Service-Token: $APM_SERVICE_TOKEN" | jq
```

### Idempotency

Every successful fetch stamps `consumed_at` but **deliberately does not change the plan's
status**. Retry as many times as you need — retries are safe and return the same brief.

### Errors

| Status | Meaning |
|--------|---------|
| `401` | No Bearer token and no valid `X-Service-Token` |
| `404` | Plan doesn't exist, or a JWT caller doesn't own it |
| `409` | `{"error_code": "PERSONALITY_PROFILE_MISSING"}` — learner's profile was deleted after the plan was made |

---

## 3. How to get a `plan_id` for testing

You need a learner who has completed the BFI-44 survey. Fastest path:

```bash
# 1. Sign in on the frontend (npm run dev → http://localhost:5173), complete /survey
# 2. Create a plan through the UI at /training-plan/new
#    …or hit the API directly with that user's JWT:

curl -s -X POST http://localhost:8000/api/v1/apa/training-plan/generate \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"goal_text":"practise pushing back on my manager when scope creeps mid-sprint"}' | jq .plan_id
```

Then fetch the brief with that `plan_id` and the service token.

**No Gemini key needed.** If `GEMINI_API_KEY_APM` is unset, APM's intent parser falls back to a
deterministic keyword parser and still returns a fully valid plan — `intent.parse_source` will
just say `"rule_based"` instead of `"llm"`. Plan generation never fails on a missing LLM key.

---

## 4. Field mapping — brief → your `ScenarioDetail`

This is the core of the work. Left column is what APM sends; right column is the shape you
already serve from `app/models/rpe/scenarios/scenario_*.json` and
`GET /rpe/scenarios/detail/{scenario_id}`.

| APM brief field | Your `ScenarioDetail` field | Notes |
|---|---|---|
| `blueprint.title_hint` | `title` | A hint, not a mandate — rewrite it if you have something better |
| `pedagogy.difficulty_band` | `difficulty` | Already `beginner` / `intermediate` / `advanced` |
| `intent.domain` | `conflict_type` | Your vocabulary differs (`peer_indirect` etc.) — map it however suits your library |
| `blueprint.counterpart_persona.role` | `npc_role` | |
| `counterpart_persona.communication_style` + `.disposition` + `.motivations[]` | `npc_personality` | Compress into your adjective-string style |
| `blueprint.situation_summary` + `setting.where` + `stakes` | `context` | The summary is third-person prose with no dialogue — usable close to as-is |
| **`blueprint.trigger_event`** | **`opening_npc_line`** | **You write this.** APM gives you the *event* that opens the scene, never a line of dialogue |
| `blueprint.target_turn_count` | `recommended_turns` | 5 / 8 / 12 for short / standard / extended |
| `blueprint.target_turn_count` + headroom | `max_turns` | Your call; existing scenarios use ~2× |
| `blueprint.success_criteria[]` | `success_criteria` | Yours is numeric thresholds; APM's is observable behaviours — use them as the rubric behind the numbers |
| `blueprint.escalation_seed` | `end_conditions` + `npc_behaviour` | **Scale conversion required — see §5** |
| `target_skills[]` | `apa_metadata.target_skills` | Already in your 11-skill vocabulary, no translation |
| `learner_profile` | `apa_metadata.big_five_relevance` | Big Five already on your 0.0–1.0 scale |

### Fields with no home in `ScenarioDetail` yet

These are genuinely useful and I'd suggest carrying them somewhere (a new block, or inside
`apa_metadata`) rather than dropping them:

- `blueprint.required_beats[]` — 3–5 moments the scenario **must** contain so the target skills
  actually get exercised. This is the strongest signal for keeping a generated scenario on-task.
- `blueprint.counterpart_persona.hidden_concern` — what the NPC does *not* volunteer. Surface it
  only if the learner earns it. Great for the trust state machine.
- `blueprint.counterpart_persona.likely_objections[]` — pre-written pushback angles.
- `blueprint.failure_modes[]` — useful for post-session diagnosis.
- `pedagogy.formative_checkpoints[]` — mid-session checks you could score against.

---

## 5. Scale conversions (please read — this is the easy thing to get wrong)

APM's `escalation_seed` is normalised **0.0–1.0**. Your FSM is not.

| APM field | APM range | Your field | Your range | Conversion |
|---|---|---|---|---|
| `escalation_seed.initial_trust` | 0.0–1.0 | starting `trust_score` | int 0–100 | `round(initial_trust * 100)` |
| `escalation_seed.escalation_ceiling` | 0.0–1.0 | max `escalation_level` | int 0–4 | `round(escalation_ceiling * 4)` |

Verified against your code: `rpe_session_service.py` seeds `trust_history: [50]` and
`escalation_level: 0`, and `scenario_002.json` uses trust thresholds of 65 / 45 / 35 and
escalation thresholds of 4 / 2 / 0 — so trust is 0–100 and escalation is 0–4.

One caveat I could not resolve from the code alone: `rpe_session_service.py` defaults
`failure_escalation_threshold` to **5** while every scenario JSON sets it to **4**. If escalation
actually tops out at 5 rather than 4, use `* 5` above. You own that state machine — please
confirm which it is, and tell me if the contract should carry a different range.

`escalation_ceiling` is a **cap, not a target**. The FSM may sit below it; it must not exceed it.
A high-Neuroticism learner gets a deliberately low ceiling and a raised `initial_trust` — that's
the safety-first rule and it's the single most important behaviour to preserve.

---

## 6. Hard rules

1. **`blueprint.content_constraints[]` is a boundary, not a suggestion.** Workplace-appropriate
   only; no conflict grounded in protected characteristics; no personal-trauma themes; no
   profanity or threats; keep disagreement about the work, never about the learner as a person.
   Whatever generates your scenario text must be constrained by this list.
2. **Never exceed `escalation_seed.escalation_ceiling`.**
3. **`trigger_event` is an event, not a line.** If you paste it in as dialogue it will read wrong.
4. **`plan_id` changes on regenerate.** A regenerated plan is a new row with `plan_version + 1`;
   the old one is archived, not deleted. Always fetch the brief for the `plan_id` you were handed.
5. **Ignore unknown fields.** Every model on the wire sets `extra="ignore"`. A MINOR/PATCH schema
   bump is safe to consume; a MAJOR bump means the shape changed and we coordinate first.

---

## 7. What APM will not give you

APM never produces dialogue, NPC lines, or scenario prose — that boundary is deliberate and
enforced in code and tests. Specifically you will not find, and should not wait for:

- an opening line or any NPC utterance
- turn-by-turn scripting
- your `conflict_type` taxonomy
- anything that writes into `app/models/rpe/scenarios/`

If you want something added to the brief, ask — bumping `SCHEMA_VERSION` is cheap. Please don't
work around a gap by reaching into APM's tables.

---

## 8. Suggested build order

1. **Fetch and log.** Call the endpoint with the service token, dump the JSON. Confirm you can
   get a brief for a real learner end-to-end.
2. **Write the mapper.** Pure function: `ScenarioGenerationBrief` → your `ScenarioDetail` dict.
   No LLM yet — stub `opening_npc_line` with a placeholder. Unit-test it against the worked
   example in §9; it should be fully deterministic.
3. **Do the scale conversion** and unit-test it: high-Neuroticism brief → higher starting trust,
   lower escalation cap than a low-Neuroticism one.
4. **Generate the prose.** Feed `situation_summary`, `counterpart_persona`, `trigger_event`,
   `required_beats` and `content_constraints` to Groq (you already use it in
   `rpe_npc_service.py`) and produce `opening_npc_line` and any richer `context`. Constrain it
   with `content_constraints`.
5. **Persist and serve.** Decide whether a plan-generated scenario becomes a row/file alongside
   `scenario_00*.json` or lives in the session. Either is fine by APM.
6. **Wire the entry point.** The frontend button already exists but ships disabled behind a flag
   — see §10.
7. **Close the loop.** Nothing new needed: keep POSTing `FeedbackResponse` to
   `/api/v1/apa/session-feedback` as you do today. APM feeds those results back into the next
   plan automatically.

---

## 9. Worked example

Learner: high Neuroticism (72), low Extraversion (25), no baseline yet.
Goal: *"practise pushing back on my manager when scope creeps mid-sprint"*.

Note how the plan responds to the personality: `pressure_level` 1 and `escalation_ceiling` 0.50
are damped because Neuroticism is high, and `initial_trust` 0.45 is raised for the same reason.
The counterpart is still `resistant` — they asked to practise pushing back, so the disagreement
is real. It's the *heat* that's dialled down, not the conflict.

```json
{
  "schema_version": "1.0.0",
  "plan_id": "7407b66e-c239-4686-bdff-d5bc174bc413",
  "plan_version": 1,
  "user_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "generated_at": "2026-08-10T09:30:00+00:00",
  "learner_profile": {
    "user_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "openness": 0.45,
    "conscientiousness": 0.55,
    "extraversion": 0.25,
    "agreeableness": 0.6,
    "neuroticism": 0.72,
    "weak_skills": ["boundary_setting", "assertiveness", "emotional_regulation", "self_advocacy"],
    "recommended_difficulty": "beginner"
  },
  "intent": {
    "raw_text": "practise pushing back on my manager when scope creeps mid-sprint",
    "domain": "conflict_resolution",
    "workplace_context": "sprint retro on a 6-person dev team",
    "learner_role": "senior engineer",
    "counterpart_role": "engineering manager",
    "counterpart_disposition": "resistant",
    "desired_focus_skills": ["boundary_setting", "assertiveness"],
    "intensity_preference": "balanced",
    "session_length": "standard",
    "parse_confidence": 0.88,
    "parse_source": "llm"
  },
  "blueprint": {
    "title_hint": "Conflict Resolution with an engineering manager",
    "medium": "in_person",
    "setting": {
      "where": "sprint retro on a 6-person dev team",
      "when": "During normal working hours, at a point where the issue can no longer be deferred",
      "who_else_present": ["No one — the conversation is one-to-one"]
    },
    "situation_summary": "The learner is a senior engineer in the following setting: sprint retro on a 6-person dev team. They need to work through a conflict resolution situation with an engineering manager who is resistant toward their position. The counterpart has their own constraints and will not simply agree. The learner's own words for what they want to practise: \"practise pushing back on my manager when scope creeps mid-sprint\". The scenario should give the learner room to exercise boundary setting, assertiveness, emotional regulation, self advocacy.",
    "learner_role": "senior engineer",
    "learner_objective": "Hold a productive conflict resolution conversation that ends with the learner's position clearly stated and a concrete next step agreed",
    "counterpart_persona": {
      "role": "engineering manager",
      "disposition": "resistant",
      "motivations": [
        "Protect their own priorities in the conflict resolution situation",
        "Be seen as reasonable by anyone who hears about this later",
        "Reach a resolution without conceding more than necessary"
      ],
      "likely_objections": [
        "The learner's concern is real but not the most urgent thing right now",
        "Someone above them has already committed to the current course",
        "This has been handled the same way before without complaint"
      ],
      "communication_style": "Resistant and businesslike; matched to a gentle teaching tone at slow pacing",
      "hidden_concern": "They are under pressure themselves and have less room to move than they are willing to admit up front"
    },
    "stakes": "The working relationship and the learner's credibility both matter here — conceding costs standing, escalating costs goodwill",
    "pressure_level": 1,
    "trigger_event": "The engineering manager raises the issue at the start of the conversation, putting the learner on the spot to respond",
    "required_beats": [
      "The counterpart states their position on the conflict resolution issue, giving the learner something concrete to respond to",
      "The learner is given a clear opening to state their own position",
      "The counterpart makes a request that exceeds what the learner can reasonably absorb",
      "The counterpart applies pressure that the learner must hold their ground against at least once",
      "The counterpart raises the temperature once, testing whether the learner stays composed"
    ],
    "success_criteria": [
      "Learner states their position explicitly at least once, without hedging",
      "Learner keeps the exchange focused on the conflict resolution issue rather than personalities",
      "Learner names a concrete limit and offers an alternative",
      "Learner restates their position after the first pushback",
      "Learner's tone stays level through the escalation beat",
      "Learner names their own contribution or constraint unprompted"
    ],
    "failure_modes": [
      "Learner agrees to everything to end the discomfort",
      "Learner never states a position, only asks questions",
      "Learner becomes combative and attacks the counterpart personally",
      "Learner leaves with no concrete next step agreed",
      "Learner's responses become terse or shut down after pushback",
      "Learner accepts the extra scope while signalling resentment"
    ],
    "content_constraints": [
      "Stay workplace-appropriate at all times",
      "No conflict grounded in protected characteristics (race, gender, religion, disability, age, sexuality)",
      "No personal-trauma themes (bereavement, illness, abuse, self-harm)",
      "No profanity, slurs, threats or intimidation",
      "Keep the disagreement about work, never about the learner as a person"
    ],
    "target_turn_count": 8,
    "est_duration_minutes": 16,
    "escalation_seed": {
      "initial_trust": 0.45,
      "escalation_ceiling": 0.5,
      "de_escalation_triggers": [
        "learner acknowledges the counterpart's constraint before arguing",
        "learner proposes a concrete, dated alternative",
        "learner asks a genuine clarifying question",
        "learner names the shared goal explicitly"
      ],
      "escalation_triggers": [
        "learner concedes the point without stating their position",
        "learner repeats the same argument a third time",
        "learner blames a named person rather than the situation",
        "learner goes silent or deflects for two consecutive turns"
      ]
    }
  },
  "pedagogy": {
    "teaching_strategy": {
      "tone": "gentle",
      "pacing": "slow",
      "complexity": "moderate",
      "npc_personality": "warm_supportive",
      "feedback_style": "encouraging",
      "rationale": [
        "Neuroticism=72 (high) → tone=gentle, feedback=encouraging (safety signal — wins over agreeableness for tone)",
        "Extraversion=25 (low) → pacing=slow, npc=warm_supportive"
      ],
      "priority_skills": []
    },
    "difficulty": 2,
    "difficulty_band": "beginner",
    "support_level": "moderate",
    "hint_policy": "on_request — hints available but never volunteered unprompted",
    "zpd_rationale": "Set at beginner (2/10) — one step beyond a purely supportive conversation, but well short of open confrontation; calibrated from the personality profile alone (no baseline yet). Support is scaffolded so the learner can reach it, not sit in it.",
    "kolb_stage_focus": "concrete_experience",
    "formative_checkpoints": [
      "After the opening exchange: did the learner state a position or only react?",
      "Mid-conversation: is the learner exercising boundary setting or avoiding it?",
      "At the pressure beat: did the learner hold, fold, or escalate?",
      "At close: is there a concrete, mutually understood next step?"
    ]
  },
  "adaptation": {
    "allow_live_nudges": true,
    "max_difficulty_delta": 1,
    "strategy_locked_during_session": true,
    "soften_on": [
      "stress_score > 0.7",
      "confidence_score < 0.35",
      "stress_score > 0.55 sustained over 2 consecutive turns"
    ],
    "escalate_on": ["engagement_score > 0.75 AND stress_score < 0.3"],
    "abort_conditions": [
      "stress_score > 0.9",
      "learner explicitly asks to stop",
      "conversation leaves the workplace-appropriate boundary"
    ]
  },
  "target_skills": ["boundary_setting", "assertiveness", "emotional_regulation", "self_advocacy"],
  "consumed_at": null
}
```

Signal names in `adaptation` (`stress_score`, `confidence_score`, `engagement_score`,
`objective_completion_rate`) match what APM already computes in
`app/services/pedagogy/aggregator.py`, so you and MCA evaluate one vocabulary.

---

## 10. The frontend entry point already exists

`frontend/src/components/training-plan/StartRolePlayButton.jsx` renders a "Start role-play with
this plan" button on the plan detail page. It currently ships **disabled** with the tooltip
"Scenario generation coming soon", behind a single constant in
`frontend/src/components/training-plan/constants.js`:

```js
export const RPE_PLAN_HANDOFF_ENABLED = false
export const RPE_PLAN_HANDOFF_PATH = '/roleplay'
```

When your side is ready: flip `RPE_PLAN_HANDOFF_ENABLED` to `true`. It will then link to
`/roleplay?planId=<plan_id>`. If you'd rather receive it on a different route or param name,
change `RPE_PLAN_HANDOFF_PATH` — or tell me and I'll adjust the UI.

---

## 11. One trap to avoid

`Backend/app/services/rpe_apa_service.py` is a self-described **stub** that still routes at
`/rpe/apa/recommend` and `/rpe/apa/session-complete`. It returns unfiltered scenario lists and
`notify_session_complete` is a `pass`. It is **not** the APM integration — the real path is
`app/services/pedagogy/*` talking over HTTP via `app/core/rpe_client.py`. Don't wire new work
into that stub thinking it's connected to APM, and don't delete it without checking those two
routes aren't depended on elsewhere.

---

## 12. Working with Claude Code on this

You can paste the block below into a fresh Claude Code session in this repo as a starting brief.
Attach this file and `INTEGRATION_TRAINING_PLAN.md` alongside it.

````text
I'm implementing RPE scenario generation from an APM Training Plan in this repo (EmpowerZ,
R26-SE-010). Read CLAUDE.md at the repo root first, then Backend/docs/RPE_SCENARIO_GENERATION_HANDOFF.md
and Backend/docs/INTEGRATION_TRAINING_PLAN.md.

Context:
- APM exposes GET /api/v1/apa/training-plan/{plan_id}/scenario-brief, authenticated with
  X-Service-Token (APM_SERVICE_TOKEN in Backend/.env) or a user JWT. The response shape is
  ScenarioGenerationBrief in Backend/app/contracts/training_plan.py.
- I own RPE: Backend/app/api/v1/rpe/router.py, Backend/app/services/rpe_*.py, and the scenario
  JSONs in Backend/app/models/rpe/scenarios/.
- APM describes WHAT a scenario must contain. I write the scenario itself — dialogue, NPC lines,
  opening line. APM never sends any of those.

Task: build the brief -> ScenarioDetail path.
1. A pure mapper function from the brief to my ScenarioDetail shape (see scenario_002.json),
   with unit tests. No LLM in the mapper — keep it deterministic.
2. Correct scale conversion: brief escalation_seed.initial_trust and escalation_ceiling are
   0.0-1.0; my trust_score is int 0-100 and escalation_level is int 0-4. Test that a
   high-Neuroticism brief yields higher starting trust and a lower escalation cap.
3. Generate opening_npc_line and richer context with Groq (already used in rpe_npc_service.py),
   constrained by blueprint.content_constraints and blueprint.required_beats.

Constraints from the repo conventions:
- Flat layout, one file per feature. No repository/DAO layer, no Redis, no CI, no new
  abstraction layers. SQLAlchemy 2.0 Mapped[] syntax. logging module, never print.
- Don't modify anything under Backend/app/services/pedagogy/ — that's APM's module.
- Backend/app/services/rpe_apa_service.py is a dead stub; don't build on it.
- Run `pytest -q` from Backend/ before calling anything done.

Start by reading the files and telling me your plan before writing code.
````

---

## 13. Questions back to me

Two things I'd like your answer on, neither blocking:

1. **Escalation range** — is the cap 4 or 5? (`rpe_session_service.py` defaults to 5, the
   scenario JSONs all use 4.) If it's 5, I'll note the corrected conversion in the contract doc.
2. **Handoff route** — is `/roleplay?planId=<id>` the right entry point, or do you want a
   different route or param name?

Anything missing from the brief, tell me and I'll add it and bump `SCHEMA_VERSION`. Adding an
optional field is a MINOR bump and costs nothing.
