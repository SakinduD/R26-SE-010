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
 * The backend (Backend/app/schemas/rpe.py RespondResponse) exposes real
 * conversation-intelligence fields as of the RPE V2 backend conversation-
 * intelligence pass: npc_objective, conversation_phase, unresolved_items,
 * commitments, agreed_deadlines, requested_items, user_constraints,
 * recent_topics — all produced by the SAME LLM call that generates the
 * NPC's dialogue (see rpe_npc_service.generate_response), evolved turn
 * over turn from the model's own prior-turn state, never guessed here.
 * An older/pre-existing session may still return these as null/[] (logged
 * before the field existed) — normalizeTurnResponse() treats that exactly
 * like "not present", never invents a value to fill the gap.
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
    npcObjective: response.npc_objective ?? response.objective ?? null,
    conversationPhaseFromBackend: response.conversation_phase ?? response.phase ?? null,
    completion: !!response.session_complete,
    endReason: response.end_reason ?? null,
    outcome: response.outcome ?? null,
    userIntent: passThroughUserIntent(response.user_behavior),
    communicationQuality: bucketCommunicationQuality(response.response_quality, response.clarity_score),
    // Real backend arrays (see this file's header) — always arrays, never
    // null, so advanceIntelligence below can fold them in unconditionally.
    // An older session/response with no such field yet reads as empty,
    // same as "nothing tracked" — not fabricated, just absent.
    memory: {
      commitments: response.commitments ?? [],
      unresolvedItems: response.unresolved_items ?? [],
      agreedDeadlines: response.agreed_deadlines ?? [],
      requestedItems: response.requested_items ?? [],
      userConstraints: response.user_constraints ?? [],
      recentTopics: response.recent_topics ?? [],
    },
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

// The starting (pre-first-turn) shape — real per-turn values now come from
// normalized.memory (see normalizeTurnResponse above) and are folded in by
// advanceIntelligence below. This function is still what session start
// seeds `memory` with, before any turn has happened.
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

  // Structural fallback (opening/resolution/closing, derived from turn
  // count/completion) only for whenever the backend doesn't supply a real
  // phase — an older session, or a turn the model wasn't confident about
  // (see rpe_npc_service's own "don't force a phase" instruction). The
  // real backend value — the model's own read of the actual conversation
  // shape (clarification/commitment/constraint/negotiation/escalation
  // included, not just these three structural ones) — always wins when present.
  const structuralPhase = derivePhase({ turnNumber, completion: normalized.completion, outcome: normalized.outcome })

  return {
    // Never overwritten by a turn — the whole point of section 2.
    scenarioObjective: prev.scenarioObjective,
    // Real only once the backend exposes it; otherwise stays null forever,
    // which is the honest state rather than a guess.
    npcObjective: normalized.npcObjective ?? prev.npcObjective,
    phase: normalized.conversationPhaseFromBackend ?? structuralPhase ?? prev.phase,
    userIntent: normalized.userIntent,
    communicationQuality: normalized.communicationQuality,
    relationshipImpact: {
      trust: computeDirection(priorTrust, normalized.trust),
      tension: computeDirection(priorTension, normalized.tension),
      clarity: computeDirection(priorClarity, normalized.clarity),
    },
    emotionTransition: { from: priorNpcEmotion ?? null, to: normalized.emotion ?? priorNpcEmotion ?? null },
    // Real backend arrays (normalized.memory — see normalizeTurnResponse)
    // replace the previous turn's outright, since the backend itself
    // already evolved them (removed resolved items, added new ones — see
    // rpe_npc_service._format_conversation_state) rather than this layer
    // trying to diff/merge two snapshots itself. Falls back to whatever
    // was already there only if this turn's response carried no memory at
    // all (e.g. an older cached response shape), never to an empty reset.
    memory: normalized.memory ?? prev.memory,
    isRepeatedNpcLine: normalized.npcText ? isSimilarToPriorNpcLine(normalized.npcText, priorNpcLines || []) : false,
  }
}
