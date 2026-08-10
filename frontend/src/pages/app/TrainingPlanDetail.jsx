import React, { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Archive, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import PageHead from '@/components/ui/PageHead'
import Banner from '@/components/ui/Banner'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import { PLAN_ERROR, trainingPlanService } from '@/services/trainingPlan/trainingPlanService'
import PersonalisationBriefCard from '@/components/training-plan/PersonalisationBriefCard'
import PlanSummaryCard from '@/components/training-plan/PlanSummaryCard'
import ScenarioBlueprintCard from '@/components/training-plan/ScenarioBlueprintCard'
import PedagogyCard from '@/components/training-plan/PedagogyCard'
import AdaptationRulesDisclosure from '@/components/training-plan/AdaptationRulesDisclosure'
import StartRolePlayButton from '@/components/training-plan/StartRolePlayButton'
import ConfirmDialog from '@/components/training-plan/ConfirmDialog'
import PlanSkeleton from '@/components/training-plan/PlanSkeleton'

export default function TrainingPlanDetail() {
  const { isLoading: authLoading } = useProtectedRoute()
  const { planId } = useParams()
  const navigate = useNavigate()

  const [plan, setPlan] = useState(undefined) // undefined = loading
  const [error, setError] = useState(null)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setError(null)
    setPlan(undefined)
    trainingPlanService
      .getById(planId)
      .then(setPlan)
      .catch((err) => {
        setPlan(null)
        setError(err)
        if (err.code === PLAN_ERROR.PERSONALITY_PROFILE_MISSING) {
          toast.error(err.message)
          navigate('/survey?from=training-plan', { replace: true })
        }
      })
  }, [planId, navigate])

  useEffect(() => {
    if (authLoading) return
    load()
  }, [authLoading, load])

  async function handleRegenerate() {
    setBusy(true)
    try {
      const next = await trainingPlanService.regenerate(planId)
      toast.success(`Plan regenerated — now version ${next.plan_version}`)
      setConfirmRegenerate(false)
      navigate(`/training-plan/${next.plan_id}`, { replace: true })
    } catch (err) {
      if (err.code === PLAN_ERROR.PERSONALITY_PROFILE_MISSING) {
        toast.error(err.message)
        navigate('/survey?from=training-plan', { replace: true })
        return
      }
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleArchive() {
    setBusy(true)
    try {
      const next = await trainingPlanService.setStatus(planId, 'archive')
      setPlan(next)
      toast.success('Plan archived')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleActivate() {
    setBusy(true)
    try {
      const next = await trainingPlanService.setStatus(planId, 'activate')
      setPlan(next)
      toast.success('Plan set as active')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || plan === undefined) {
    return (
      <div className="page">
        <PageHead eyebrow="Adaptive Pedagogy" title="Training plan" />
        <PlanSkeleton />
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="page">
        <PageHead eyebrow="Adaptive Pedagogy" title="Training plan" />
        <Card>
          <EmptyState
            title={error?.code === PLAN_ERROR.NOT_FOUND ? 'Plan not found' : 'Could not load plan'}
            description={
              error?.message ??
              "We couldn't load this plan. It may have been removed."
            }
            action={
              <>
                {error?.isRetryable && (
                  <button type="button" className="btn btn-primary" onClick={load}>
                    <span className="btn-label">Try again</span>
                  </button>
                )}
                <Link to="/training-plan" className="btn btn-ghost">
                  <span className="btn-label">Back to plans</span>
                </Link>
              </>
            }
          />
        </Card>
      </div>
    )
  }

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="page">
      <PageHead
        eyebrow="Adaptive Pedagogy"
        title={plan.blueprint?.title_hint || 'Your training plan'}
        sub={`Version ${plan.plan_version} · created ${new Date(plan.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`}
        right={
          <Link to="/training-plan" className="btn btn-ghost">
            <span
              className="btn-label"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <ArrowLeft size={14} strokeWidth={1.8} />
              All plans
            </span>
          </Link>
        }
      />

      {plan.status === 'archived' && (
        <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
          <Banner variant="info">
            <div className="fg" style={{ fontWeight: 500 }}>
              This plan is archived
            </div>
            <div className="t-cap" style={{ marginTop: 2 }}>
              It's kept for reference. Set it active again to practise with it.
            </div>
          </Banner>
        </motion.div>
      )}

      <div className="col stagger" style={{ gap: 16 }}>
        <PersonalisationBriefCard plan={plan} />
        <PlanSummaryCard plan={plan} />
        <ScenarioBlueprintCard blueprint={plan.blueprint} />
        <PedagogyCard pedagogy={plan.pedagogy} />
        <AdaptationRulesDisclosure
          adaptation={plan.adaptation}
          generationSources={plan.generation_sources}
          schemaVersion={plan.schema_version}
        />

        <motion.div
          variants={fadeInUp}
          style={{
            display: 'flex',
            gap: 12,
            paddingTop: 8,
            paddingBottom: 32,
            flexWrap: 'wrap',
          }}
        >
          <StartRolePlayButton planId={plan.plan_id} style={{ flex: '1 1 240px' }} />

          <button
            type="button"
            className="btn btn-secondary btn-lg"
            onClick={() => setConfirmRegenerate(true)}
            disabled={busy}
          >
            <span
              className="btn-label"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={14} strokeWidth={1.8} />
              Regenerate
            </span>
          </button>

          {plan.status === 'archived' ? (
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              onClick={handleActivate}
              disabled={busy}
            >
              <span className="btn-label">Set as active</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              onClick={handleArchive}
              disabled={busy}
            >
              <span
                className="btn-label"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Archive size={14} strokeWidth={1.8} />
                Archive
              </span>
            </button>
          )}
        </motion.div>
      </div>

      <ConfirmDialog
        open={confirmRegenerate}
        title="Regenerate this plan?"
        description="We'll rebuild it from the same goal using your latest profile, baseline and session history. This plan will be archived and a new version created — you can still view it afterwards."
        confirmLabel="Regenerate"
        busy={busy}
        onConfirm={handleRegenerate}
        onCancel={() => setConfirmRegenerate(false)}
      />
    </motion.div>
  )
}
