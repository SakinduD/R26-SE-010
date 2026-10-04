/*
 * conversationIntelligenceV2.js
 *
 * A lightweight, deterministic normalization/continuity layer for
 * RolePlaySessionV2 — NOT a second scoring engine, NOT an LLM, NOT a
 * source of new facts. Everything it produces is either:
 *   (a) a real field read straight off rpeService.sendTurn()'s response
 *       (or a future field of the same response, checked first so the
 *       backend can extend this contract with zero frontend changes), or
 *   (b) a real value bucketed/compared against its own real prior value
 *       (e.g. "is response_quality above a fixed threshold", "is trust
 *       higher than last turn's trust") — the exact same kind of
 *       presentation-layer normalization feedbackTheme.js's scoreStatus()
 *       already does for the feedback screens, applied here to the live
 *       session instead.
 *
 * IMPORTANT — read before extending this file:
 * The current backend (Backend/app/schemas/rpe.py RespondResponse, checked
 * 2026 during this pass) does NOT expose npc_objective, conversation_phase,
 * scenario "intent"/"scoring" fields, or any structured memory (unresolved
 * items, commitments, deadlines). normalizeTurnResponse() checks for them
 * anyway (future-proofing, per the spec's own "if available" framing) but
 * they will be `null`/empty today, always. Nothing here fabricates a
 * plausible-looking value to fill that gap — see each function's own
 * comment for exactly what it does and does not do.
 */

// ── Per-turn normalization ─────────────────────────────────────────────

// response_quality is already a real 0-10ish backend score (see
// RpeNlpService._score_turn) — this just buckets it into the qualitative
// labels the spec asked for, the same threshold-bucketing pattern
// scoreStatus() already uses elsewhere. It is NOT a new score; a
// scenario-agnostic bucket over a number the backend already computed.
// clarity_score nudges the boundary only when it disagrees strongly with
// response_quality (a low-clarity, decent-quality reply reads as
// "incomplete" rather than "strong").
function bucketCommunicationQuality(responseQuality, clarityScore) {
  if (responseQuality == null) return null
  if (responseQuality >= 8) return clarityScore != null && clarityScore < 4 ? 'incomplete' : 'strong'
  if (responseQuality >= 6) return 'accountable'
  if (responseQuality >= 4) return clarityScore != null && clarityScore < 4 ? 'unclear' : 'proactive'
  if (responseQuality >= 2) return 'defensive'
  return 'evasive'
}

// response.user_behavior is already real (rpe_llm_service.UserBehaviorLabel:
// assertive_statement | proposal | acknowledgment | de_escalation |
// clarifying_question | concession | deflection | escalation | unclear).
// The spec suggested a different vocabulary (acknowledge/commit/clarify/
// change_topic/...) but the backend doesn't classify against that list, so
// this deliberately does NOT force a lossy guess-translation between two
// different taxonomies — userIntent is the backend's own real label,
// passed through as-is. Renaming it here would be exactly the kind of
// frontend-invented classification the spec says not to do.
function passThroughUserIntent(userBehavior) {
  return userBehavior || null
}

// One turn's real backend response, reshaped into a flat, stable-key
// object the rest of this layer (and any future debug UI) reads. Every
// field is either read straight off `response`, a same-named future field
// checked first (objective/phase/intent/scoring, in case the backend adds
// them), or explicitly derived from a real field with the derivation
// documented above. Nothing is invented when a field is missing — it's null.
export function normalizeTurnResponse(response) {
  if (!response) return null
  return {
    npcText: response.npc_response ?? null,
    emotion: response.emotion ?? null,
    animation: response.animation ?? null,
    trust: response.trust_score ?? null,
    tension: response.escalation_level ?? null,
    clarity: response.clarity_score ?? null,
    interactionType: response.interaction_type ?? (response.requests_deliverable ? 'deliverable_choice' : 'normal'),
    // Forward-compatible only — no current backend field for either. Real
    // the moment the backend adds npc_objective/conversation_phase to
    // RespondResponse; null until then.
    npcObjective: response.npc_objective ?? response.objective ?? null,
    conversationPhaseFromBackend: response.conversation_phase ?? response.phase ?? null,
    completion: !!response.session_complete,
    endReason: response.end_reason ?? null,
    outcome: response.outcome ?? null,
    userIntent: passThroughUserIntent(response.user_behavior),
    communicationQuality: bucketCommunicationQuality(response.response_quality, response.clarity_score),
  }
}

// ── Direction (real value vs. its own real prior value) ────────────────

// null on the very first comparison (nothing real to compare against yet —
// see previous*Ref in RolePlaySessionV2.jsx), otherwise 'up' | 'down' | 'flat'.
export function computeDirection(previousValue, nextValue) {
  if (previousValue == null || nextValue == null) return null
  if (nextValue > previousValue) return 'up'
  if (nextValue < previousValue) return 'down'
  return 'flat'
}

// ── Phase — structural only, never content-based ────────────────────────

// Only 'opening'/'resolution'/'closing' are derivable from fields that are
// unambiguously real and structural (turn count, session_complete,
// outcome). Every other phase the spec listed (requirement_clarification,
// commitment, constraint, negotiation, escalation) requires actually
// understanding what was said — the backend doesn't classify that today,
// so this never guesses one of those from turn count or keyword-spotting.
// Returns null for "somewhere in the middle, no structural signal either
// way" rather than picking a plausible-sounding guess.
export function derivePhase({ turnNumber, completion, outcome }) {
  if (completion) return outcome === 'success' ? 'resolution' : 'closing'
  if (turnNumber == null || turnNumber <= 0) return 'opening'
  return null
}

// ── Repetition — literal text similarity on the NPC's own real lines,
// never semantic inference ──────────────────────────────────────────────

function normalizeForCompare(text) {
  return (text || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Real, deterministic: word-overlap ratio between this NPC line and each
// prior one. Flags "the NPC is saying something very close to what it
// already said" — a literal text-similarity signal, not a claim about
// *why* it's repeating (that would require understanding "the same
// unresolved item", which needs data the backend doesn't expose — see the
// file header). Debug-panel-only; never shown to the learner and never
// used to alter what's sent to the backend.
export function isSimilarToPriorNpcLine(text, priorNpcLines, threshold = 0.6) {
  const words = new Set(normalizeForCompare(text).split(' ').filter(Boolean))
  if (words.size < 3) return false
  for (const prior of priorNpcLines) {
    const priorWords = new Set(normalizeForCompare(prior).split(' ').filter(Boolean))
    if (priorWords.size < 3) continue
    let overlap = 0
    for (const w of words) if (priorWords.has(w)) overlap += 1
    const ratio = overlap / Math.min(words.size, priorWords.size)
    if (ratio >= threshold) return true
  }
  return false
}

// ── Memory scaffolding ───────────────────────────────────────────────────

// All arrays start (and, today, always stay) empty — there is no
// structured backend field for any of these yet (no per-turn "requested
// items", "agreed deadline", etc. — see the file header). This shape
// exists so a future backend field can be folded in with a one-line change
// to advanceIntelligence() below, without the frontend ever having
// heuristically guessed at commitments/deadlines/constraints from raw
// dialogue text in the meantime (which the spec explicitly rules out).
export function createEmptyMemory() {
  return {
    commitments: [],
    unresolvedItems: [],
    agreedDeadlines: [],
    requestedItems: [],
    userConstraints: [],
    recentTopics: [],
  }
}

// ── Full intelligence state ──────────────────────────────────────────────

// scenarioObjective: real scenario.context text (see ScenarioSelect.jsx /
// RolePlaySessionV2.jsx's recovery path, both now thread scenario.context
// through as `context`) — set once at session start and never overwritten
// by a per-turn response, exactly so a topic-shift turn can't silently
// replace it (spec section 2).
export function createInitialIntelligence(scenarioObjective) {
  return {
    scenarioObjective: scenarioObjective || null,
    npcObjective: null,
    phase: 'opening',
    userIntent: null,
    communicationQuality: null,
    relationshipImpact: { trust: null, tension: null, clarity: null },
    emotionTransition: { from: null, to: null },
    memory: createEmptyMemory(),
    isRepeatedNpcLine: false,
  }
}

// One fold: previous intelligence + this turn's normalized response +
// whatever real prior values/history are needed for direction/repetition
// checks -> next intelligence. Pure function, no I/O, no randomness — the
// "deterministic where possible" the spec asked for.
export function advanceIntelligence(prev, {
  normalized, turnNumber, priorTrust, priorTension, priorClarity, priorNpcEmotion, priorNpcLines,
}) {
  if (!normalized) return prev

  const phase = derivePhase({ turnNumber, completion: normalized.completion, outcome: normalized.outcome })

  return {
    // Never overwritten by a turn — the whole point of section 2.
    scenarioObjective: prev.scenarioObjective,
    // Real only once the backend exposes it; otherwise stays null forever,
    // which is the honest state rather than a guess.
    npcObjective: normalized.npcObjective ?? prev.npcObjective,
    phase: phase ?? prev.phase,
    userIntent: normalized.userIntent,
    communicationQuality: normalized.communicationQuality,
    relationshipImpact: {
      trust: computeDirection(priorTrust, normalized.trust),
      tension: computeDirection(priorTension, normalized.tension),
      clarity: computeDirection(priorClarity, normalized.clarity),
    },
    emotionTransition: { from: priorNpcEmotion ?? null, to: normalized.emotion ?? priorNpcEmotion ?? null },
    // Always empty today — see createEmptyMemory()'s own comment. Folded in
    // here (rather than left as a static constant) so a future backend
    // field slots in without touching the reducer's call sites.
    memory: prev.memory,
    isRepeatedNpcLine: normalized.npcText ? isSimilarToPriorNpcLine(normalized.npcText, priorNpcLines || []) : false,
  }
}
