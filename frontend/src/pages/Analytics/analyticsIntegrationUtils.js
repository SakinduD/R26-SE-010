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

export function hasPulledComponentData(sources) {
  return Boolean(
    sources?.surveyProfile?.ok ||
      sources?.adaptivePlan?.ok ||
      sources?.rpeSession?.ok ||
      sources?.rpeFeedback?.ok ||
      sources?.mcaNudges?.ok
  )
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
