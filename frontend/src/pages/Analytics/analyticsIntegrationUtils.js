export async function optionalRequest(request) {
  try {
    return { ok: true, data: await request() }
  } catch {
    return { ok: false, data: null }
  }
}

export function normalizeSurveyProfile(value) {
  if (!value) return null
  return {
    profile: value.profile || value,
    ocean_scores: flattenOceanScores(value.ocean_scores || value.scores || {}),
    dominant_traits: value.dominant_traits || inferDominantTraits(value.ocean_scores || value.scores || {}),
  }
}

/**
 * A scenario reference, as an id string.
 *
 * The adaptive plan endpoint returns `primary_scenario` as the whole scenario -
 * title, context, npc_role, thresholds - not an id. Passed straight through it
 * reached the integration endpoint as `scenario_id: {…}` and every request came
 * back 422 "Input should be a valid string", which the screen reported as "No
 * component session data was found yet for this session ID."
 */
// Integrations already running, keyed by session. Two screens - and React's
// development double-invoke of effects - fire the same integration for the same
// session at the same moment. The work is not cheap (it writes a metric row,
// replaces generated feedback, runs sentiment over the comments) and doing it
// twice concurrently on one session is at best wasted and at worst two writers
// racing over the same rows.
//
// Module scope on purpose: a ref inside a component does not survive the
// remount that causes the second call.
const inFlightIntegrations = new Map()

/**
 * Run `integrate` for this session, or join the run already in progress.
 *
 * Callers get the same promise, so both see the same outcome and the server
 * sees one request.
 */
export function integrateOnce(sessionId, integrate) {
  const key = String(sessionId || '')
  if (!key) return integrate()

  const existing = inFlightIntegrations.get(key)
  if (existing) return existing

  const run = Promise.resolve()
    .then(integrate)
    .finally(() => inFlightIntegrations.delete(key))

  inFlightIntegrations.set(key, run)
  return run
}

export function scenarioIdOf(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    return value.scenario_id || value.id || value.scenarioId || null
  }
  return null
}

export function normalizeAdaptivePlan(value) {
  if (!value) return null
  return {
    skill: value.skill,
    strategy: value.strategy || value.strategy_name || stringifyShort(value.strategy_json),
    difficulty: value.difficulty,
    recommended_scenario_ids: value.recommended_scenario_ids || value.scenario_ids || [],
    primary_scenario:
      scenarioIdOf(value.primary_scenario) ||
      scenarioIdOf(value.selected_scenario_id) ||
      scenarioIdOf(value.scenario_id),
    generation_source: value.generation_source,
    generation_status: value.generation_status,
  }
}

export function normalizeMcaNudges(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function selectMcaSession(sessions, sessionId) {
  if (!Array.isArray(sessions) || !sessions.length) return null

  const exactMatch = sessions.find((session) => String(session.id) === String(sessionId))
  if (exactMatch) return exactMatch

  return sessions.find((session) => session.status === 'completed') || sessions[0]
}

// A session only belongs in the analytics dropdowns once it has finished.
// MCA tracks this with status ('active' | 'completed' | 'abandoned'); the
// timestamp fallbacks below cover sessions stored without one.
export function isCompletedSession(session) {
  if (!session) return false

  const status = String(session.status || session.completion_status || '').toLowerCase()
  if (status) return status === 'completed'

  return Boolean(session.ended_at || session.completed_at || session.outcome)
}

// Multimodal sessions only.
//
// Role-play sessions used to appear here too, and every page that reads this
// list answers a question about the four tracked skills - three of which are
// microphone and camera measurements. A role-play session is typed text, so it
// has none of them: selecting one produced "Vocal Command 0" and a post-session
// report headed "Vocal Command needs the most attention from this session",
// about a conversation in which nobody spoke.
//
// Removed rather than special-cased, because the honest per-page alternative is
// six different "this does not apply" states. Role-play sessions still have
// their own feedback screens inside the role-play module.
export function normalizeComponentSessionOptions(mcaSessions) {
  return normalizeSessionOptions(mcaSessions).sort(
    (a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0)
  )
}

// How many sessions a picker asks for at a time. Deliberately small: the
// dropdown reveals a few at a time rather than unrolling a hundred entries at
// once, and this is the size of one reveal.
export const SESSION_PAGE_SIZE = 5

/**
 * One page of the learner's completed sessions, ready for a picker.
 *
 * Returns the options plus what is behind them, so the dropdown can say "5 of
 * 115" and know whether asking again is worth it.
 */
export async function loadLearnerSessionPage(analyticsService, userId, offset = 0, limit = SESSION_PAGE_SIZE) {
  const page = await optionalRequest(() =>
    analyticsService.getLearnerSessions(userId, { limit, offset })
  )
  const data = page.data || {}
  return {
    options: normalizeLearnerSessions(data.items),
    total: Number(data.total) || 0,
    hasMore: Boolean(data.has_more),
    nextOffset: (Number(data.offset) || 0) + (data.items?.length || 0),
  }
}

/**
 * Every completed session the learner has, for a picker.
 *
 * Fetched in full rather than page by page: the payload is a few rows per
 * session and the pickers need to be able to reach the oldest one. What must
 * not happen all at once is the *rendering* - AnalyticsSessionSelect reveals a
 * few at a time - which is a different problem from how the data arrives.
 *
 * The loop is bounded. A learner cannot page forever, and a server that kept
 * answering has_more would otherwise spin here.
 */
export async function loadComponentSessionOptions(analyticsService, userId) {
  if (!userId) return []

  const collected = []
  let offset = 0
  for (let page = 0; page < 20; page += 1) {
    const result = await loadLearnerSessionPage(analyticsService, userId, offset, 500)
    collected.push(...result.options)
    if (!result.hasMore || result.nextOffset <= offset) break
    offset = result.nextOffset
  }
  return collected
}

/** The analytics session endpoint's shape, mapped onto a picker option. */
export function normalizeLearnerSessions(items) {
  if (!Array.isArray(items)) return []

  return items
    .map((item) => {
      if (!item?.session_id) return null
      const when = item.ended_at || item.started_at
      const labelDate = when ? new Date(when).toLocaleString() : null
      const title = item.friendly_id || `MCA${item.skill_type ? ` · ${humanizeKey(item.skill_type)}` : ''}`
      const score = item.overall_score == null ? null : `${Math.round(item.overall_score)}/100`

      return {
        id: String(item.session_id),
        friendlyId: item.friendly_id || null,
        source: 'mca',
        status: 'completed',
        startedAt: when,
        title,
        sublabel: [score, labelDate].filter(Boolean).join(' · '),
        label: `${title}${labelDate ? ` - ${labelDate}` : ''}`,
      }
    })
    .filter(Boolean)
}

// This preferred a role-play session over a multimodal one, so every page that
// auto-selects landed on the one kind of session it could not describe.
export function selectPreferredComponentSession(options) {
  if (!Array.isArray(options) || !options.length) return null
  return options.find((item) => item.status === 'completed') || options[0]
}

export function isGeneratedAnalyticsSessionId(value) {
  return String(value || '').startsWith('softskill-session-')
}

export function normalizeMcaSessionNudges(session) {
  if (!session) return []

  const nudgeLog = Array.isArray(session.nudge_log) ? session.nudge_log : []
  const nudgeEntries = nudgeLog.map((entry) => ({
    emotion: session.dominant_emotion || null,
    confidence: normalizeConfidence(entry.confidence),
    nudge: entry.message || entry.nudge || entry.text || 'Multimodal communication cue recorded.',
    nudge_category: normalizeCategory(entry.category),
    nudge_severity: entry.severity || 'info',
  }))

  const mechanicalEntries = Object.entries(session.mechanical_averages || {}).map(([key, value]) => ({
    emotion: session.dominant_emotion || null,
    confidence: normalizeConfidence(value),
    nudge: `Multimodal ${humanizeKey(key)} average was ${formatValue(value)}.`,
    nudge_category: normalizeCategory(key),
    nudge_severity: Number(value) < 50 ? 'warning' : 'info',
  }))

  const emotionEntries = Object.entries(session.emotion_distribution || {}).map(([emotion, value]) => ({
    emotion,
    confidence: normalizeConfidence(value),
    nudge: `Detected ${humanizeKey(emotion)} emotion during the communication session.`,
    nudge_category: 'fusion',
    nudge_severity: emotionSeverity(emotion, value),
  }))

  const overallEntry =
    session.overall_score !== null && session.overall_score !== undefined
      ? [
        {
          emotion: session.dominant_emotion || null,
          confidence: normalizeConfidence(session.overall_score),
          nudge: `Multimodal communication overall score was ${formatValue(session.overall_score)}.`,
          nudge_category: 'fusion',
          nudge_severity: Number(session.overall_score) < 50 ? 'warning' : 'info',
        },
      ]
      : []

  return [...nudgeEntries, ...mechanicalEntries, ...emotionEntries, ...overallEntry]
}

// Extract the accurate per-skill scores the MCA engine already computed.
// MCA names the fourth skill `emotional_regulation`; the feedback component
// calls it `emotional_intelligence` — both are accepted.
export function normalizeMcaSkillScores(session) {
  const raw = session?.skill_scores
  if (!raw || typeof raw !== 'object') return null

  const clamp = (value) => {
    const number = Number(value)
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null
  }

  const scores = {
    vocal_command: clamp(raw.vocal_command),
    speech_fluency: clamp(raw.speech_fluency),
    presence_engagement: clamp(raw.presence_engagement),
    emotional_intelligence: clamp(raw.emotional_intelligence ?? raw.emotional_regulation),
  }

  return Object.values(scores).some((value) => value !== null) ? scores : null
}

export function normalizeMcaOverallScore(session) {
  const number = Number(session?.overall_score)
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null
}

export function hasPulledComponentData(sources) {
  return Boolean(
    sources?.surveyProfile?.ok ||
    sources?.adaptivePlan?.ok ||
    sources?.mcaNudges?.ok
  )
}

function normalizeConfidence(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (number > 1) return Math.max(0, Math.min(1, number / 100))
  return Math.max(0, Math.min(1, number))
}

function normalizeCategory(value) {
  const key = String(value || '').toLowerCase()
  if (key.includes('pace')) return 'pace'
  if (key.includes('volume') || key.includes('pitch')) return 'volume'
  if (key.includes('silence') || key.includes('listening')) return 'silence'
  if (key.includes('clarity')) return 'clarity'
  if (key.includes('eye') || key.includes('gaze')) return 'fusion'
  if (key.includes('emotion') || key.includes('sentiment') || key.includes('affect')) return 'fusion'
  return key || 'fusion'
}

function emotionSeverity(emotion, value) {
  const key = String(emotion || '').toLowerCase()
  const confidence = normalizeConfidence(value) || 0
  if (['angry', 'sad', 'fear', 'disgust', 'frustrated'].some((item) => key.includes(item)) && confidence >= 0.35) {
    return 'warning'
  }
  return 'info'
}

function humanizeKey(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : value
}

function flattenOceanScores(scores) {
  return Object.fromEntries(
    Object.entries(scores).map(([key, value]) => [
      key,
      typeof value === 'object' && value !== null ? Number(value.score || 0) : Number(value || 0),
    ])
  )
}

function inferDominantTraits(scores) {
  return Object.entries(flattenOceanScores(scores))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key)
}

function stringifyShort(value) {
  if (!value) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function normalizeSessionOptions(sessions) {
  if (!Array.isArray(sessions)) return []

  return sessions
    .filter((session) => isCompletedSession(session))
    .map((session) => {
      const id = session.id
      if (!id) return null

      const status = session.status || session.outcome || session.completion_status
      const scenario = session.scenario_title || session.scenario_id || session.scenarioId || session.skill_type
      const startedAt =
        session.ended_at ||
        session.completed_at ||
        session.started_at ||
        session.startedAt ||
        session.created_at ||
        session.createdAt
      const labelDate = startedAt ? new Date(startedAt).toLocaleString() : null
      const sourceLabel = 'MCA'
      const statusLabel = status ? humanizeKey(status) : 'Session'
      const friendlyId = session.friendly_id || null

      // Prefer the human-readable friendly id (e.g. MCA-AI-20260630-X7K2) as the
      // primary label; fall back to source + scenario for sessions without one.
      const title = friendlyId || `${sourceLabel}${scenario ? ` · ${humanizeKey(scenario)}` : ''}`
      const sublabel = [friendlyId ? sourceLabel : null, statusLabel, labelDate]
        .filter(Boolean)
        .join(' · ')

      return {
        id: String(id),
        friendlyId,
        // Kept on the option so callers that group or key by it keep working;
        // there is only one source now.
        source: 'mca',
        status,
        startedAt,
        title,
        sublabel,
        label: `${sourceLabel} - ${statusLabel}${scenario ? ` - ${humanizeKey(scenario)}` : ''}${labelDate ? ` - ${labelDate}` : ''}`,
      }
    })
    .filter(Boolean)
}

/**
 * Hand one finished session to the analytics module.
 *
 * The server reads the session out of its own tables, so this is a single call
 * carrying nothing but an id. It used to assemble the payload here instead —
 * fetching each component's view of the session and posting the combined
 * picture — which made a session's analytics depend on six requests all
 * returning before the learner navigated away. When they did not, the session
 * was never scored: no skill card, no trend point, no prediction, and a
 * dashboard reading zero for a session that had really been completed.
 *
 * Never throws: a session that fails to integrate must not disturb whatever the
 * caller was doing. Returns { integrated: boolean }.
 */
export async function integrateCompletedSession(analyticsService, sessionId) {
  if (!sessionId) return { integrated: false }

  try {
    const result = await analyticsService.integrateSession(sessionId)
    return { integrated: (result?.integrated_count ?? 0) > 0 }
  } catch {
    return { integrated: false }
  }
}
