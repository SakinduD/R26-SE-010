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

export function normalizeAdaptivePlan(value) {
  if (!value) return null
  return {
    skill: value.skill,
    strategy: value.strategy || value.strategy_name || stringifyShort(value.strategy_json),
    difficulty: value.difficulty,
    recommended_scenario_ids: value.recommended_scenario_ids || value.scenario_ids || [],
    primary_scenario: value.primary_scenario || value.selected_scenario_id || value.scenario_id,
    generation_source: value.generation_source,
    generation_status: value.generation_status,
  }
}

export function normalizeRpeSession(value) {
  return value || null
}

export function normalizeRpeFeedback(value) {
  return value || null
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

export function hasPulledComponentData(sources) {
  return Boolean(
    sources?.surveyProfile?.ok ||
      sources?.adaptivePlan?.ok ||
      sources?.rpeSession?.ok ||
      sources?.rpeFeedback?.ok ||
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
