import { authClient } from '../../lib/api/client'

/**
 * Personalised Training Plan API client — /api/v1/apa/training-plan/*
 *
 * One function per backend endpoint. Every failure is normalised into a
 * TrainingPlanError carrying a stable `code`, so components branch on codes
 * and never on message strings.
 */

const BASE = '/api/v1/apa/training-plan'

const unwrap = (response) => response.data

export const PLAN_ERROR = {
  PERSONALITY_PROFILE_MISSING: 'PERSONALITY_PROFILE_MISSING',
  INVALID_FOCUS_SKILLS: 'INVALID_FOCUS_SKILLS',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NETWORK: 'NETWORK',
  SERVER: 'SERVER',
  UNKNOWN: 'UNKNOWN',
}

export class TrainingPlanError extends Error {
  constructor({ code, status, message, allowedSkills = null, cause = null }) {
    super(message)
    this.name = 'TrainingPlanError'
    this.code = code
    this.status = status ?? null
    this.allowedSkills = allowedSkills
    this.cause = cause
  }

  /** True for errors worth offering an inline retry on. */
  get isRetryable() {
    return this.code === PLAN_ERROR.NETWORK || this.code === PLAN_ERROR.SERVER
  }
}

/**
 * The backend surfaces an unknown focus skill as a Pydantic validation error
 * whose message embeds the allowed vocabulary:
 *   "Unknown focus skills ['telepathy']. Allowed values: ['accountability', ...]"
 * Pull that list out so the form can render it against the field.
 */
function extractAllowedSkills(detail) {
  const entries = Array.isArray(detail) ? detail : [detail]
  for (const entry of entries) {
    const msg = typeof entry === 'string' ? entry : entry?.msg || ''
    const match = /Allowed values:\s*\[([^\]]*)\]/.exec(msg)
    if (match) {
      const skills = match[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
      if (skills.length) return skills
    }
  }
  return null
}

function firstDetailMessage(detail, fallback) {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const msg = detail.find((d) => d?.msg)?.msg
    if (msg) return msg
  }
  if (detail?.message) return detail.message
  return fallback
}

function normaliseError(err, fallback) {
  if (err instanceof TrainingPlanError) return err

  const status = err?.response?.status ?? null
  const detail = err?.response?.data?.detail

  if (!err?.response) {
    return new TrainingPlanError({
      code: PLAN_ERROR.NETWORK,
      status,
      message: "Couldn't reach the server. Check your connection and try again.",
      cause: err,
    })
  }

  if (status === 409 && detail?.error_code === PLAN_ERROR.PERSONALITY_PROFILE_MISSING) {
    return new TrainingPlanError({
      code: PLAN_ERROR.PERSONALITY_PROFILE_MISSING,
      status,
      message:
        detail.message ||
        'Complete the personality survey first — your plan is built from it.',
      cause: err,
    })
  }

  if (status === 422) {
    const allowedSkills = extractAllowedSkills(detail)
    return new TrainingPlanError({
      code: allowedSkills ? PLAN_ERROR.INVALID_FOCUS_SKILLS : PLAN_ERROR.VALIDATION_ERROR,
      status,
      message: firstDetailMessage(detail, 'Some of the details you entered are invalid.'),
      allowedSkills,
      cause: err,
    })
  }

  if (status === 404) {
    return new TrainingPlanError({
      code: PLAN_ERROR.NOT_FOUND,
      status,
      message: firstDetailMessage(detail, 'That training plan could not be found.'),
      cause: err,
    })
  }

  if (status === 401 || status === 403) {
    return new TrainingPlanError({
      code: PLAN_ERROR.UNAUTHORIZED,
      status,
      message: 'Your session has expired. Please sign in again.',
      cause: err,
    })
  }

  return new TrainingPlanError({
    code: status >= 500 ? PLAN_ERROR.SERVER : PLAN_ERROR.UNKNOWN,
    status,
    message: firstDetailMessage(detail, fallback),
    cause: err,
  })
}

/** Drop empty/undefined optional overrides so the backend infers them instead. */
function compactPayload(input) {
  const payload = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    payload[key] = typeof value === 'string' ? value.trim() : value
  }
  return payload
}

export const trainingPlanService = {
  /** POST /apa/training-plan/generate */
  generate: async (input) => {
    try {
      return await authClient.post(`${BASE}/generate`, compactPayload(input)).then(unwrap)
    } catch (err) {
      throw normaliseError(err, 'Failed to generate your training plan.')
    }
  },

  /** GET /apa/training-plan/active — resolves to null when the user has none. */
  getActive: async () => {
    try {
      return await authClient.get(`${BASE}/active`).then(unwrap)
    } catch (err) {
      const normalised = normaliseError(err, 'Failed to load your active plan.')
      if (normalised.code === PLAN_ERROR.NOT_FOUND) return null
      throw normalised
    }
  },

  /** GET /apa/training-plan/{planId} */
  getById: async (planId) => {
    try {
      return await authClient.get(`${BASE}/${encodeURIComponent(planId)}`).then(unwrap)
    } catch (err) {
      throw normaliseError(err, 'Failed to load that training plan.')
    }
  },

  /** GET /apa/training-plan?limit=&offset= */
  list: async ({ limit = 20, offset = 0 } = {}) => {
    try {
      return await authClient.get(BASE, { params: { limit, offset } }).then(unwrap)
    } catch (err) {
      throw normaliseError(err, 'Failed to load your plan history.')
    }
  },

  /** POST /apa/training-plan/{planId}/regenerate */
  regenerate: async (planId) => {
    try {
      return await authClient
        .post(`${BASE}/${encodeURIComponent(planId)}/regenerate`)
        .then(unwrap)
    } catch (err) {
      throw normaliseError(err, 'Failed to regenerate your plan.')
    }
  },

  /** PATCH /apa/training-plan/{planId}/status — action: 'activate' | 'archive' */
  setStatus: async (planId, action) => {
    try {
      return await authClient
        .patch(`${BASE}/${encodeURIComponent(planId)}/status`, { action })
        .then(unwrap)
    } catch (err) {
      throw normaliseError(err, 'Failed to update the plan status.')
    }
  },

  /** GET /apa/training-plan/skill-vocabulary — the 11 RPE skills. */
  getSkillVocabulary: async () => {
    try {
      const data = await authClient.get(`${BASE}/skill-vocabulary`).then(unwrap)
      return data?.skills ?? []
    } catch (err) {
      throw normaliseError(err, 'Failed to load the focus-skill list.')
    }
  },
}

export default trainingPlanService
