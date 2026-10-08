import React from 'react'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { fadeInUp } from '@/lib/animations'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import CardHeader from './CardHeader'

/**
 * Hero card — the learner-facing "why this plan is yours" text, straight from
 * the backend's personalisation_brief.
 */
export default function PersonalisationBriefCard({ plan }) {
  if (!plan?.personalisation_brief) return null

  const snapshot = plan.inputs_snapshot ?? {}
  const sessions = snapshot.sessions_considered ?? 0

  return (
    <motion.div variants={fadeInUp}>
      <Card variant="accent">
        <CardHeader
          icon={Sparkles}
          title="Why this plan is yours"
          right={
            snapshot.baseline_present ? (
              <Badge variant="success">Baseline calibrated</Badge>
            ) : null
          }
        />

        <p className="t-body fg" style={{ lineHeight: 1.65, margin: 0 }}>
          {plan.personalisation_brief}
        </p>

        {plan.pedagogy?.zpd_rationale && (
          <>
            <div className="divider" style={{ margin: '16px 0' }} />
            <p className="t-cap" style={{ lineHeight: 1.55, margin: 0 }}>
              {plan.pedagogy.zpd_rationale}
            </p>
          </>
        )}

        <div
          className="t-cap"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16 }}
        >
          <span>
            Built from your personality profile
            {snapshot.baseline_present ? ' and voice baseline' : ''}
          </span>
          {sessions > 0 && (
            <span>
              Recalibrated from your last {sessions} session{sessions === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
