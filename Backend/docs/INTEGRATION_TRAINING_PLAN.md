# APM → RPE Training Plan Integration Guide

> **Audience:** Role-Play Engine (RPE) team
> **APM contract version:** `SCHEMA_VERSION = "1.0.0"` (`app/contracts/training_plan.py`)
> **Last updated:** 2026-08-10

---

## Overview

The learner types what workplace situation they want to practise. APM combines that
goal with their OCEAN profile, MCA voice baseline and recent session history, and
composes a **Training Plan** — the complete input specification for RPE's scenario
generator.

| Direction | When | Endpoint |
|-----------|------|----------|
| Learner → APM | Learner submits a practice goal | `POST /api/v1/apa/training-plan/generate` |
| RPE → APM | RPE is about to build a scenario | `GET /api/v1/apa/training-plan/{plan_id}/scenario-brief` |

### Division of responsibility — read this first

**APM describes WHAT the scenario must contain. RPE writes it.**

APM never produces dialogue, NPC lines, or scenario prose, and nothing in this
contract carries any. `trigger_event` is an *event* ("the manager raises the issue at
the start of the conversation"), never something anyone says. `required_beats` are
*moments the scenario must contain*, not a script.

RPE owns: the actual scene text, every NPC utterance, turn-by-turn behaviour, and the
trust/escalation state machine that `escalation_seed` initialises.

---

## 1. What RPE calls

```
GET /api/v1/apa/training-plan/{plan_id}/scenario-brief
```

### Authentication

Accept **either** — identical scheme to `POST /api/v1/apa/session-feedback`:

| Method | Header |
|--------|--------|
| Service-to-service | `X-Service-Token: <apm_service_token>` |
| User JWT | `Authorization: Bearer <jwt>` |

`apm_service_token` is APM's `.env` value `APM_SERVICE_TOKEN`. Use the service token
when RPE fetches on the learner's behalf with no user context. With a JWT, the caller
must own the plan or the response is `404`.

### Idempotency

Every successful fetch stamps `consumed_at`. **Status is deliberately not changed** —
RPE may retry the fetch as many times as needed and each call returns the same brief.

### Errors

| Status | Cause |
|--------|-------|
| `401` | Neither a Bearer token nor a valid `X-Service-Token` |
| `404` | Plan does not exist, or the JWT caller does not own it |
| `409` | `{"error_code": "PERSONALITY_PROFILE_MISSING"}` — the learner's profile was deleted after the plan was generated |

---

## 2. Field-by-field meaning

### Top level

| Field | Meaning |
|-------|---------|
| `schema_version` | Semver of this contract. Check it; see §5. |
| `plan_id` / `plan_version` | Plan identity. Regenerating archives the old row and issues a new `plan_id` with `plan_version + 1`. |
| `user_id` | Learner UUID — the same id used on `/apa/session-feedback`. |
| `generated_at` | When APM composed the plan. |
| `learner_profile` | `ApaLearnerProfile` — identical shape to `POST /rpe/apa/recommend`. |
| `target_skills` | Ranked, 1–5 entries, strictly inside the RPE skill vocabulary. |
| `consumed_at` | `null` until the first fetch; a timestamp thereafter. |

**Scale note:** `learner_profile` Big Five values are **0.0 – 1.0** (RPE's wire scale).
APM stores them as 0 – 100 internally; the conversion happens only in
`app/services/pedagogy/adapter.py`. Raw OCEAN numbers never appear anywhere else in
this payload — the learner-facing plan carries `low`/`mid`/`high` levels only.

`target_skills` and `learner_profile.weak_skills` are drawn from the fixed vocabulary:

```
assertiveness, conflict_resolution, professional_communication,
client_management, emotional_regulation, accountability,
political_awareness, trust_building, boundary_setting,
professional_assertiveness, self_advocacy
```

Served live at `GET /api/v1/apa/training-plan/skill-vocabulary` — do not hardcode it.

### `intent` — what the learner asked for

| Field | Meaning |
|-------|---------|
| `raw_text` | The learner's own words, verbatim. Useful for scene flavour. |
| `domain` | One of: `conflict_resolution`, `feedback_delivery`, `negotiation`, `presentation`, `interview`, `client_communication`, `team_collaboration`, `performance_review`, `crisis_handling`, `networking`, `onboarding`, `other`. |
| `workplace_context` | Short setting phrase, e.g. `"sprint retro on a 6-person dev team"`. |
| `learner_role` / `counterpart_role` | Free text — job titles, not enums. |
| `counterpart_disposition` | `supportive` \| `neutral` \| `skeptical` \| `resistant` \| `distracted`. |
| `desired_focus_skills` | What the learner asked to work on. Subset of the vocabulary. |
| `intensity_preference` | `gentle` \| `balanced` \| `challenging`. |
| `session_length` | `short` \| `standard` \| `extended`. |
| `parse_confidence` | 0–1. |
| `parse_source` | `llm` when Gemini parsed the goal; `rule_based` when APM's deterministic keyword parser did. **`rule_based` is a normal, expected value**, not an error — see §4. |

### `blueprint` — the build spec

| Field | Meaning |
|-------|---------|
| `title_hint` | Suggested title. RPE may rewrite it. |
| `medium` | `in_person` \| `video_call` \| `phone` \| `chat`. |
| `setting` | `{where, when, who_else_present[]}`. |
| `situation_summary` | 3–5 sentences, third person, **no dialogue**. |
| `learner_role` / `learner_objective` | What the learner is playing and trying to achieve. |
| `counterpart_persona` | `{role, disposition, motivations[], likely_objections[], communication_style, hidden_concern}`. `hidden_concern` is the thing the NPC does **not** volunteer — surface it only if the learner earns it. |
| `stakes` | Why the conversation matters. |
| `pressure_level` | 1–5. Derived from difficulty and `intensity_preference`. |
| `trigger_event` | The event that opens the scene. **Not an NPC line.** |
| `required_beats` | 3–5 moments the scenario MUST contain so the target skills actually get exercised. |
| `success_criteria` | Observable learner behaviours defining a good run. |
| `failure_modes` | What a poor run looks like. |
| `content_constraints` | **Hard limits — RPE must not introduce these.** Workplace-appropriate only; no protected-characteristic conflict; no personal-trauma themes. |
| `target_turn_count` | 5 / 8 / 12 for short / standard / extended. |
| `est_duration_minutes` | `target_turn_count × 2`. |
| `escalation_seed` | Initial conditions for RPE's trust/escalation FSM — see below. |

#### `escalation_seed`

| Field | Meaning |
|-------|---------|
| `initial_trust` | 0.0–1.0. Where the FSM starts. |
| `escalation_ceiling` | 0.0–1.0. How hot the counterpart may get. **Do not exceed this.** |
| `de_escalation_triggers[]` | Learner behaviours that should lower escalation. |
| `escalation_triggers[]` | Learner behaviours that should raise it. |

Trigger entries are behavioural conditions evaluated per turn, not literal strings to
match. A **high-Neuroticism learner gets a higher `initial_trust` and a lower
`escalation_ceiling`** — safety-first, the same precedence rule `strategy_optimizer.py`
documents for tone.

### `pedagogy` — how to teach through the scenario

| Field | Meaning |
|-------|---------|
| `teaching_strategy` | APM's existing `TeachingStrategy`: `tone`, `pacing`, `complexity`, `npc_personality`, `feedback_style`, plus `rationale[]`. Same shape RPE already receives from `/apa/session-feedback`. |
| `difficulty` / `difficulty_band` | 1–10, and `beginner` (1–4) / `intermediate` (5–7) / `advanced` (8–10). |
| `support_level` | `high` \| `moderate` \| `low`. |
| `hint_policy` | When RPE may volunteer a hint. |
| `zpd_rationale` | One line: why this difficulty sits just above current ability. |
| `kolb_stage_focus` | `concrete_experience` \| `reflective_observation` \| `abstract_conceptualisation` \| `active_experimentation`. |
| `formative_checkpoints[]` | Mid-session checks RPE can score against. |

### `adaptation` — how far the plan may bend mid-session

| Field | Meaning |
|-------|---------|
| `allow_live_nudges` | Whether MCA's live loop may influence this session. |
| `max_difficulty_delta` | Hard cap on in-session difficulty movement. Always `1`. |
| `strategy_locked_during_session` | When `true` (default), `teaching_strategy` must not change mid-session. |
| `soften_on[]` / `escalate_on[]` | Signal expressions, e.g. `"stress_score > 0.7"`. |
| `abort_conditions[]` | Conditions under which the session should end early. |

Signal names match what APM already computes in `app/services/pedagogy/aggregator.py`
(`stress_score`, `confidence_score`, `engagement_score`,
`objective_completion_rate`), so RPE and MCA evaluate one vocabulary.

---

## 3. Worked example

Learner: high Neuroticism (72), low Extraversion (25), no baseline yet.
Goal: *"practise pushing back on my manager when scope creeps mid-sprint"*.

```bash
curl -s http://localhost:8000/api/v1/apa/training-plan/7407b66e-c239-4686-bdff-d5bc174bc413/scenario-brief \
  -H "X-Service-Token: $APM_SERVICE_TOKEN"
```

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

Read the plan for this learner: `pressure_level` 1 and `escalation_ceiling` 0.50 are
low because Neuroticism is high; `initial_trust` 0.45 is raised for the same reason.
`teaching_strategy.tone` is `gentle` and `npc_personality` is `warm_supportive`.
The counterpart is still `resistant` — the learner asked to practise pushing back, so
the conflict is real; it is the *heat*, not the disagreement, that is dialled down.

---

## 4. Invariants & gotchas

- **APM never sends scenario content.** No dialogue, no NPC lines, no opening line.
  If you need one, RPE generates it from this brief.
- **`content_constraints` is a hard boundary**, not a suggestion.
- **`escalation_ceiling` is a cap.** The FSM may sit below it; it must not exceed it.
- **`parse_source: "rule_based"` is normal.** When APM's Gemini key is unset or the
  call fails, intent parsing degrades to a deterministic keyword parser and the plan
  is still fully valid — `parse_confidence` will be ≤ 0.5. Treat it as lower-confidence
  input, not a broken payload.
- **`plan_id` changes on regenerate.** A regenerated plan is a new row with
  `plan_version + 1`; the old one is archived, not deleted. Always fetch the brief for
  the `plan_id` you were handed.
- **Fetching the brief is idempotent.** `consumed_at` is stamped; status is untouched.
- **Plans and session feedback are separate flows.** Post end-of-session results to
  `POST /api/v1/apa/session-feedback` as documented in `INTEGRATION_RPE.md` — that
  path is unchanged by this contract.
- **Difficulty stays within 1 – 10** and `pressure_level` within 1 – 5. APM clamps.
- **This is a different object from `TrainingPlanOut`** in `INTEGRATION_RPE.md`. That
  one is the learner's single adaptive-state row (strategy + difficulty + recommended
  RPE scenario). This one is a versioned, goal-conditioned plan. Both exist; they do
  not replace each other.

---

## 5. Versioning policy

`SCHEMA_VERSION` in `Backend/app/contracts/training_plan.py` is a semver string,
currently `"1.0.0"`, and is echoed in every brief.

| Change | Bump |
|--------|------|
| New optional field | MINOR (`1.1.0`) |
| New allowed enum value | MINOR |
| Field renamed / removed, type changed, enum value removed | MAJOR (`2.0.0`) |
| Wording of generated text, new rationale entries | PATCH (`1.0.1`) |

RPE should treat an unknown MINOR/PATCH version as safe to consume and ignore unknown
fields (every contract model sets `extra="ignore"`). A MAJOR bump means the shape
changed — coordinate before deploying.

Persisted plans keep the `schema_version` they were generated under; APM does not
rewrite historical rows.

### Changelog

| Version | Date | Change |
|---------|------|--------|
| `1.0.0` | 2026-08-10 | Initial contract — `ScenarioGenerationBrief`. |
