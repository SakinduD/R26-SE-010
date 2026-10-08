// resolveInteraction(response) — turns one rpeService.sendTurn() response
// into a single, unambiguous interaction for RolePlaySessionV2 to render.
// The one place that decides "choice cards vs a real content input vs
// normal conversation" — nothing else in the frontend should re-derive that
// from message text.
//
// Backend-driven, not frontend guessing: interaction_type (see
// Backend/app/services/rpe_llm_service.py's InteractionType and
// rpe_npc_service.py's prompt instructions) is the source of truth whenever
// it's present. The only fallback here is for a backend response that
// predates interaction_type entirely — the older requests_deliverable +
// response_options-only contract — kept working exactly as it always did
// (deliverable_choice/commitment_choice only; there is no way to infer
// verbal_handoff from that older shape, so it's never guessed).
//
// Root cause this exists to fix: a single requestsDeliverable boolean used
// to cover both "commit to sending something in general terms" (a real
// first-person reply is a complete, sendable thing to say) and "hand over
// the literal content right now" (the model has no actual paragraph/
// filename to put in a sample reply, so it invented placeholders like
// "[paste text here]" into responseOptions text — which then got sent to
// the NPC verbatim as if it were real content). interactionType splits
// those; this resolver is where that split becomes a render decision.
//
// verbal_handoff (RPE V2 immersion pass): the backend's own
// "content_request" classification is real and stays useful — it tells us
// the NPC is asking for an actual artifact (a paragraph, evidence, a
// report) rather than a general commitment. What changed is what the
// LEARNER does about it: a live role-play conversation shouldn't stop for
// a textarea/upload form just because the NPC asked for something concrete
// — a real person in that situation would talk about what they have, not
// paste a document into a dialog box. So "content_request" is normalized
// here into "verbal_handoff", which resolveInteraction hands back looking
// just like NORMAL (same VoiceDock/text path, no special panel) — see
// RolePlaySessionV2.jsx's showContentPanel/voiceState, which only special-
// case "direct_input" now, not "verbal_handoff". "direct_input" (one short
// literal fact — a time, a name) keeps its existing compact single-line
// input; that one genuinely isn't the "form in the middle of a
// conversation" problem this change targets. ContentRequestInputV2 itself
// is untouched and still renders for direct_input, and stays available for
// a possible future dedicated artifact-assessment flow (see interaction
// target/artifact-state note below) — this pass never deletes it, only
// stops routing content_request through it.
//
// interactionTarget: real backend signal (response.content_type — e.g.
// "evidence", "paragraph") passed through as-is when present, never
// invented. artifactStatus has no backend signal to draw from yet (no
// endpoint computes "ready_with_missing_information" etc.) so it's always
// null in this pass — shown as such in DEV, not fabricated from message text.

const PLACEHOLDER_PATTERN =
  /\[[^\]]{0,40}\]|<[^>]{0,40}>|\b(?:paste|insert|add|enter)\s+\w+(?:\s+\w+){0,2}\s+here\b/i

export function looksLikePlaceholder(text) {
  return typeof text === 'string' && PLACEHOLDER_PATTERN.test(text)
}

const NORMAL = { type: 'normal' }

export function resolveInteraction(response) {
  if (!response) return NORMAL

  const result = resolveInteractionInner(response)

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[RPE interaction]', {
      interactionType: result.type,
      contentType: result.contentType ?? null,
      optionCount: result.options?.length ?? 0,
    })
  }

  return result
}

function resolveInteractionInner(response) {
  const backendType = response.interaction_type

  // content_request -> verbal_handoff: the NPC really is asking for an
  // artifact, but the learner responds about it in the normal VoiceDock/
  // text path, not a special form — see the file header. target is a real
  // backend signal (content_type) passed through as-is, never invented;
  // artifactStatus has no backend signal to draw from yet, so it's always
  // null rather than guessed from message text.
  if (backendType === 'content_request') {
    return {
      type: 'verbal_handoff',
      target: response.content_type || null,
      artifactStatus: null,
      prompt: response.content_prompt || null,
    }
  }
  // direct_input is unchanged — one short literal fact (a time, a name)
  // still gets its existing compact single-line input. That's not the
  // "form in the middle of a conversation" problem this pass targets.
  if (backendType === 'direct_input') {
    return {
      type: 'direct_input',
      contentType: response.content_type || 'short_text',
      prompt: response.content_prompt || 'Provide the requested detail.',
      target: response.content_type || null,
      artifactStatus: null,
    }
  }
  if (backendType === 'normal') return NORMAL

  // backendType === 'deliverable_choice' | 'commitment_choice' (the
  // preferred name going forward — see file header; no backend deploy
  // sends the new name yet, but both resolve identically), or the field is
  // absent entirely (older backend response, requests_deliverable/
  // response_options only).
  const options = response.response_options
  const isCommitmentChoice =
    backendType === 'deliverable_choice' || backendType === 'commitment_choice' || !!response.requests_deliverable

  if (!isCommitmentChoice || !options || options.length < 2) {
    return NORMAL
  }

  // Defense in depth — rpe_npc_service.py already guards against this
  // server-side and downgrades to content_request when it happens, but an
  // older backend deploy (no interaction_type field yet) has no such guard.
  // Never present an option whose text is an unresolved placeholder as a
  // legitimate, selectable, submittable line — falls through to the same
  // verbal_handoff (conversational) treatment as a real content_request.
  if (options.some((o) => looksLikePlaceholder(o.text))) {
    return {
      type: 'verbal_handoff',
      target: null,
      artifactStatus: null,
      prompt: 'Go ahead and describe exactly what they asked for.',
    }
  }

  return { type: 'commitment_choice', options }
}
