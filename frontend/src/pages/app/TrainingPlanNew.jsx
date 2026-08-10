import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute'
import { getMyProfile } from '@/lib/api/survey'
import PageHead from '@/components/ui/PageHead'
import Banner from '@/components/ui/Banner'
import { goalStepSchema } from '@/lib/validation/trainingPlan'
import { PLAN_ERROR, trainingPlanService } from '@/services/trainingPlan/trainingPlanService'
import StepGoal from '@/components/training-plan/wizard/StepGoal'
import StepRefine from '@/components/training-plan/wizard/StepRefine'
import StepReview from '@/components/training-plan/wizard/StepReview'
import PlanGeneratingState from '@/components/training-plan/PlanGeneratingState'

const STEPS = [
  { id: 1, label: 'Goal' },
  { id: 2, label: 'Refine' },
  { id: 3, label: 'Review' },
]

const EMPTY_FORM = {
  goal_text: '',
  domain: '',
  workplace_context: '',
  learner_role: '',
  counterpart_role: '',
  counterpart_disposition: '',
  intensity_preference: '',
  session_length: '',
  focus_skills: [],
}

function StepIndicator({ current }) {
  return (
    <ol
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        listStyle: 'none',
        margin: '0 0 20px',
        padding: 0,
      }}
      aria-label="Wizard progress"
    >
      {STEPS.map((step, i) => {
        const state = step.id < current ? 'done' : step.id === current ? 'current' : 'todo'
        return (
          <li key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12.5,
                color: state === 'todo' ? 'var(--text-quaternary)' : 'var(--text-primary)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  background: state === 'current' ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: state === 'current' ? 'var(--bg-canvas)' : 'var(--text-tertiary)',
                  border:
                    state === 'current' ? 'none' : '1px solid var(--border-subtle)',
                }}
              >
                {step.id}
              </span>
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                style={{ width: 24, height: 1, background: 'var(--border-subtle)' }}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

export default function TrainingPlanNew() {
  const { isLoading: authLoading } = useProtectedRoute()
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()

  const [step, setStep] = useState(1)
  const [values, setValues] = useState(EMPTY_FORM)
  const [goalError, setGoalError] = useState('')

  const [skills, setSkills] = useState([])
  const [skillsLoading, setSkillsLoading] = useState(true)
  const [vocabularyError, setVocabularyError] = useState('')

  const [generating, setGenerating] = useState(false)
  const [startedAt, setStartedAt] = useState(null)
  const [submitError, setSubmitError] = useState(null)

  const headingRef = useRef(null)

  const setValue = (key, value) => setValues((v) => ({ ...v, [key]: value }))

  // Pre-check the personality profile on mount so nobody fills in the whole
  // wizard only to be bounced by a 409 at the end.
  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    getMyProfile()
      .then((profile) => {
        if (cancelled || profile) return
        toast.error('Complete the personality survey first — your plan is built from it.')
        navigate('/survey?from=training-plan', { replace: true })
      })
      .catch(() => {
        /* Non-fatal: generate still guards with a 409. */
      })
    return () => {
      cancelled = true
    }
  }, [authLoading, navigate])

  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    trainingPlanService
      .getSkillVocabulary()
      .then((list) => {
        if (!cancelled) setSkills(list)
      })
      .catch(() => {
        if (!cancelled) {
          setVocabularyError(
            "Couldn't load the focus-skill list. You can still continue — we'll pick focus skills from your profile.",
          )
        }
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [authLoading])

  // Move focus to the new step heading so keyboard/SR users land in the right place.
  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  const validateGoal = () => {
    const result = goalStepSchema.safeParse({ goal_text: values.goal_text })
    if (result.success) {
      setGoalError('')
      return true
    }
    setGoalError(result.error.issues[0]?.message ?? 'Please describe the situation.')
    return false
  }

  const goNext = () => {
    if (step === 1 && !validateGoal()) return
    setStep((s) => Math.min(3, s + 1))
  }

  const goBack = () => setStep((s) => Math.max(1, s - 1))

  async function handleGenerate() {
    setSubmitError(null)
    setGenerating(true)
    setStartedAt(Date.now())
    try {
      const plan = await trainingPlanService.generate(values)
      toast.success('Your training plan is ready')
      navigate(`/training-plan/${plan.plan_id}`, { replace: true })
    } catch (err) {
      setGenerating(false)

      if (err.code === PLAN_ERROR.PERSONALITY_PROFILE_MISSING) {
        toast.error(err.message)
        navigate('/survey?from=training-plan', { replace: true })
        return
      }

      if (err.code === PLAN_ERROR.INVALID_FOCUS_SKILLS) {
        // Send them back to the field that caused it — form state is untouched.
        setSubmitError(err)
        setStep(2)
        toast.error('Some focus skills were not recognised.')
        return
      }

      setSubmitError(err)
      toast.error(err.message)
    }
  }

  if (generating) {
    return (
      <div className="page page-read">
        <PageHead
          eyebrow="Adaptive Pedagogy"
          title="Generating your plan"
          sub="Hold tight — this only takes a moment."
        />
        <PlanGeneratingState startedAt={startedAt} />
      </div>
    )
  }

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: 'easeOut' }
  const variants = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, x: 24 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -24 },
      }

  return (
    <div className="page page-read">
      <PageHead
        eyebrow="Adaptive Pedagogy"
        title="New training plan"
        sub="Tell us what you want to practise and we'll build a scenario brief around it."
        right={
          <Link to="/training-plan" className="btn btn-ghost">
            <span className="btn-label">Cancel</span>
          </Link>
        }
      />

      <StepIndicator current={step} />

      {submitError && submitError.code !== PLAN_ERROR.INVALID_FOCUS_SKILLS && (
        <div style={{ marginBottom: 16 }}>
          <Banner variant="danger">
            <div className="fg" style={{ fontWeight: 500 }}>
              {submitError.message}
            </div>
            {submitError.isRetryable && (
              <div className="t-cap" style={{ marginTop: 6 }}>
                Nothing you typed was lost — try again when you're ready.
              </div>
            )}
          </Banner>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={transition}
        >
          {step === 1 && (
            <StepGoal
              value={values.goal_text}
              onChange={(v) => {
                setValue('goal_text', v)
                if (goalError) setGoalError('')
              }}
              error={goalError}
              headingRef={headingRef}
            />
          )}
          {step === 2 && (
            <StepRefine
              values={values}
              setValue={(key, value) => {
                setValue(key, value)
                if (key === 'focus_skills') setSubmitError(null)
              }}
              skills={skills}
              skillsLoading={skillsLoading}
              vocabularyError={vocabularyError}
              focusSkillsError={
                submitError?.code === PLAN_ERROR.INVALID_FOCUS_SKILLS
                  ? submitError.message
                  : null
              }
              allowedSkills={submitError?.allowedSkills}
              headingRef={headingRef}
            />
          )}
          {step === 3 && <StepReview values={values} headingRef={headingRef} />}
        </motion.div>
      </AnimatePresence>

      <div
        style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'space-between',
          marginTop: 20,
          paddingBottom: 32,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-lg"
          onClick={goBack}
          disabled={step === 1}
        >
          <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={14} strokeWidth={1.8} />
            Back
          </span>
        </button>

        {step < 3 ? (
          <button type="button" className="btn btn-primary btn-lg" onClick={goNext}>
            <span
              className="btn-label"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {step === 1 ? 'Continue' : 'Review'}
              <ArrowRight size={14} strokeWidth={1.8} />
            </span>
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-lg" onClick={handleGenerate}>
            <span
              className="btn-label"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <Sparkles size={14} strokeWidth={1.8} />
              Generate my plan
            </span>
          </button>
        )}
      </div>

      {step === 2 && (
        <p className="t-cap" style={{ marginTop: -16, paddingBottom: 32, textAlign: 'center' }}>
          Nothing here is required — skip straight to review if you like.
        </p>
      )}
    </div>
  )
}
