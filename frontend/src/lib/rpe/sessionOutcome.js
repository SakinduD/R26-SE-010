// Shared "what actually happened" logic for the two screens a finished RPE
// session can show: SessionComplete (the quick transition right after the
// session ends) and FeedbackDashboard (the full deep-dive one tap later).
// Both read the exact same end_reason/outcome values from the backend, so
// they used to each keep their own slightly-different copy of this — which
// meant the outcome badge on SessionComplete didn't always say the same
// thing as the one you'd see a second later on FeedbackDashboard for the
// identical session. One source now; both screens import it.

export function outcomeBadge(endReason, outcome) {
  if (endReason === 'trust_sustained') return { tone: 'success', label: 'Trust Built' }
  if (endReason === 'npc_exit') return { tone: 'danger', label: 'NPC Exited' }
  if (endReason === 'max_turns_reached' && outcome === 'success') return { tone: 'accent', label: 'Completed' }
  if (endReason === 'max_turns_reached' && outcome === 'failure') return { tone: 'warning', label: 'Time Limit' }
  if (outcome === 'success') return { tone: 'success', label: 'Success' }
  if (outcome === 'failure') return { tone: 'danger', label: 'Needs Work' }
  return { tone: 'neutral', label: 'Session Ended' }
}

export function outcomeIcon(endReason, outcome) {
  if (endReason === 'trust_sustained') return '🎉'
  if (endReason === 'npc_exit') return '💢'
  if (endReason === 'max_turns_reached') return outcome === 'success' ? '✅' : '⏱'
  if (outcome === 'success') return '✅'
  return '👋'
}

// The one-or-two-sentence honest explanation under the headline — the
// session finishing and the scenario's objective being met are two
// different things (e.g. a low-score run at the turn limit is not the app
// "failing", it's the objective not landing), so this is deliberately
// separate from a generic "Session Complete" title rather than folded into
// it.
export function outcomeExplanation(endReason, outcome, scenarioTitle) {
  if (endReason === 'trust_sustained' || outcome === 'success') {
    return 'You built enough trust to resolve the situation.'
  }
  if (endReason === 'npc_exit') {
    return 'The conversation ended early because of repeated inappropriate language. Your feedback breaks down what happened and how to approach it differently.'
  }
  if (outcome === 'ended_by_user') {
    return 'You chose to end the conversation before it fully resolved. Review your outcome below to see where things stood.'
  }
  if (endReason === 'max_turns_reached') {
    return "You completed the conversation, but the core objective wasn't fully resolved by the turn limit."
  }
  return `You completed the conversation${scenarioTitle ? ` in "${scenarioTitle}"` : ''}, but the core objective wasn't fully resolved.`
}

// Escalation is "lower is better", unlike trust/quality (see feedbackTheme's
// scoreStatus) — needs its own thresholds rather than reusing that.
export function escalationStatus(value) {
  if (value == null) return null
  if (value === 0) return { tone: 'success', label: 'No escalation needed' }
  if (value <= 2) return { tone: 'accent', label: 'Mostly calm' }
  if (value === 3) return { tone: 'warning', label: 'Some tension' }
  return { tone: 'danger', label: 'Escalated' }
}

export function turnsStatus(total, recommended, max) {
  if (total == null) return null
  if (recommended != null && total <= recommended) return { tone: 'success', label: 'Efficient' }
  if (max != null && total >= max) return { tone: 'warning', label: 'Ran long' }
  return { tone: 'neutral', label: 'On track' }
}
