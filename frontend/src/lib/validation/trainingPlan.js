import { z } from 'zod'

/** Mirrors GenerateTrainingPlanIn in Backend/app/schemas/training_plan.py. */

export const GOAL_TEXT_MIN = 15
export const GOAL_TEXT_MAX = 500

export const DOMAIN_VALUES = [
  'conflict_resolution',
  'feedback_delivery',
  'negotiation',
  'presentation',
  'interview',
  'client_communication',
  'team_collaboration',
  'performance_review',
  'crisis_handling',
  'networking',
  'onboarding',
  'other',
]

export const DISPOSITION_VALUES = [
  'supportive',
  'neutral',
  'skeptical',
  'resistant',
  'distracted',
]

export const INTENSITY_VALUES = ['gentle', 'balanced', 'challenging']

export const SESSION_LENGTH_VALUES = ['short', 'standard', 'extended']

/** Step 1 — the only step that can block progress. */
export const goalStepSchema = z.object({
  goal_text: z
    .string()
    .trim()
    .min(GOAL_TEXT_MIN, `Describe the situation in at least ${GOAL_TEXT_MIN} characters.`)
    .max(GOAL_TEXT_MAX, `Keep it under ${GOAL_TEXT_MAX} characters.`),
})

/**
 * Step 2 — every field optional; this schema must never block progress.
 * Empty strings are coerced to undefined so the service layer drops them and
 * the backend infers the value instead.
 */
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .or(z.literal(''))

export const refineStepSchema = z.object({
  workplace_context: optionalText(300),
  learner_role: optionalText(120),
  counterpart_role: optionalText(120),
  domain: z.enum(DOMAIN_VALUES).optional().or(z.literal('')),
  counterpart_disposition: z.enum(DISPOSITION_VALUES).optional().or(z.literal('')),
  intensity_preference: z.enum(INTENSITY_VALUES).optional().or(z.literal('')),
  session_length: z.enum(SESSION_LENGTH_VALUES).optional().or(z.literal('')),
  focus_skills: z.array(z.string()).optional(),
})

export const trainingPlanWizardSchema = goalStepSchema.merge(refineStepSchema)
