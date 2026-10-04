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
// (deliverable_choice only; there is no way to infer content_request from
// that older shape, so it's never guessed).
//
// Root cause this exists to fix: a single requestsDeliverable boolean used
// to cover both "commit to sending something in general terms" (a real
// first-person reply is a complete, sendable thing to say) and "hand over
// the literal content right now" (the model has no actual paragraph/
// filename to put in a sample reply, so it invented placeholders like
// "[paste text here]" into responseOptions text — which then got sent to
// the NPC verbatim as if it were real content). interactionType splits
// those; this resolver is where that split becomes a render decision.

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

  // Current contract: backend already classified this turn — no frontend
  // text-sniffing of the NPC's dialogue at all.
  if (backendType === 'content_request' || backendType === 'direct_input') {
    return {
      type: backendType,
      contentType: response.content_type || (backendType === 'direct_input' ? 'short_text' : 'long_text'),
      prompt: response.content_prompt || 'Provide the requested content.',
    }
  }
  if (backendType === 'normal') return NORMAL

  // backendType === 'deliverable_choice', or the field is absent entirely
  // (older backend response, requests_deliverable/response_options only).
  const options = response.response_options
  const isDeliverableChoice = backendType === 'deliverable_choice' || !!response.requests_deliverable

  if (!isDeliverableChoice || !options || options.length < 2) {
    return NORMAL
  }

  // Defense in depth — rpe_npc_service.py already guards against this
  // server-side and downgrades to content_request when it happens, but an
  // older backend deploy (no interaction_type field yet) has no such guard.
  // Never present an option whose text is an unresolved placeholder as a
  // legitimate, selectable, submittable line.
  if (options.some((o) => looksLikePlaceholder(o.text))) {
    return {
      type: 'content_request',
      contentType: 'long_text',
      prompt: 'Go ahead and provide exactly what they asked for.',
    }
  }

  return { type: 'deliverable_choice', options }
}
