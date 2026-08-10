/**
 * Shared labels and flags for the Personalised Training Plan UI.
 *
 * Note: the focus-skill vocabulary is deliberately NOT here — it is fetched
 * from GET /apa/training-plan/skill-vocabulary so the frontend cannot drift
 * from the backend's adapter.RPE_SKILL_VOCABULARY.
 */

/**
 * RPE owns scenario generation from a plan and it has not shipped yet.
 * Flip this to true (one line) once /roleplay accepts a planId param.
 */
export const RPE_PLAN_HANDOFF_ENABLED = false

/** Where the handoff will point once RPE ships. */
export const RPE_PLAN_HANDOFF_PATH = '/roleplay'

export const DOMAIN_LABEL = {
  conflict_resolution: 'Conflict resolution',
  feedback_delivery: 'Giving feedback',
  negotiation: 'Negotiation',
  presentation: 'Presenting',
  interview: 'Interview',
  client_communication: 'Client communication',
  team_collaboration: 'Team collaboration',
  performance_review: 'Performance review',
  crisis_handling: 'Crisis handling',
  networking: 'Networking',
  onboarding: 'Onboarding',
  other: 'General practice',
}

export const DISPOSITION_LABEL = {
  supportive: 'Supportive',
  neutral: 'Neutral',
  skeptical: 'Skeptical',
  resistant: 'Resistant',
  distracted: 'Distracted',
}

export const DISPOSITION_VARIANT = {
  supportive: 'success',
  neutral: 'neutral',
  skeptical: 'info',
  resistant: 'warning',
  distracted: 'neutral',
}

export const INTENSITY_LABEL = {
  gentle: 'Gentle',
  balanced: 'Balanced',
  challenging: 'Challenging',
}

export const SESSION_LENGTH_LABEL = {
  short: 'Short',
  standard: 'Standard',
  extended: 'Extended',
}

export const SESSION_LENGTH_HINT = {
  short: '~5 turns',
  standard: '~8 turns',
  extended: '~12 turns',
}

export const MEDIUM_LABEL = {
  in_person: 'In person',
  video_call: 'Video call',
  phone: 'Phone call',
  chat: 'Chat',
}

export const STATUS_VARIANT = {
  active: 'success',
  draft: 'info',
  consumed: 'info',
  archived: 'neutral',
}

export const STATUS_LABEL = {
  active: 'Active',
  draft: 'Draft',
  consumed: 'In use',
  archived: 'Archived',
}

export const BAND_VARIANT = {
  beginner: 'success',
  intermediate: 'info',
  advanced: 'warning',
}

export const TONE_LABEL = {
  gentle: 'Supportive',
  direct: 'Direct',
  challenging: 'Challenging',
}
export const PACING_LABEL = { slow: 'Relaxed', moderate: 'Moderate', fast: 'Fast' }
export const COMPLEXITY_LABEL = { simple: 'Simple', moderate: 'Moderate', complex: 'Complex' }
export const NPC_LABEL = {
  warm_supportive: 'Warm & supportive',
  professional: 'Professional',
  demanding_critical: 'Demanding',
  analytical_probing: 'Analytical',
}
export const FEEDBACK_LABEL = {
  encouraging: 'Encouraging',
  balanced: 'Balanced',
  blunt: 'Blunt',
}

export const KOLB_LABEL = {
  concrete_experience: 'Concrete experience',
  reflective_observation: 'Reflective observation',
  abstract_conceptualisation: 'Abstract conceptualisation',
  active_experimentation: 'Active experimentation',
}

export const SUPPORT_LABEL = { high: 'High', moderate: 'Moderate', low: 'Low' }

/** "boundary_setting" → "Boundary setting" */
export function humanise(value) {
  if (!value) return ''
  const spaced = String(value).replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
