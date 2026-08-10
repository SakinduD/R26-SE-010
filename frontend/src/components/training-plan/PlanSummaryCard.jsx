import React from 'react'
import { motion } from 'framer-motion'
import { Compass } from 'lucide-react'
import { fadeInUp } from '@/lib/animations'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import CardHeader from './CardHeader'
import DifficultyMeter from './DifficultyMeter'
import TargetSkillList from './TargetSkillList'
import {
  DISPOSITION_LABEL,
  DISPOSITION_VARIANT,
  DOMAIN_LABEL,
  INTENSITY_LABEL,
  MEDIUM_LABEL,
  SESSION_LENGTH_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  humanise,
} from './constants'

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span className="t-over">{label}</span>
      <span className="fg" style={{ fontSize: 14, lineHeight: 1.45 }}>
        {children}
      </span>
    </div>
  )
}

/** At-a-glance card: what you're practising, with whom, and how hard it is. */
export default function PlanSummaryCard({ plan }) {
  if (!plan) return null

  const intent = plan.intent ?? {}
  const blueprint = plan.blueprint ?? {}
  const pedagogy = plan.pedagogy ?? {}

  return (
    <motion.div variants={fadeInUp}>
      <Card>
        <CardHeader
          icon={Compass}
          title={blueprint.title_hint || DOMAIN_LABEL[intent.domain] || 'Your plan'}
          right={
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Badge variant="neutral">v{plan.plan_version}</Badge>
              <Badge variant={STATUS_VARIANT[plan.status] ?? 'neutral'}>
                {STATUS_LABEL[plan.status] ?? humanise(plan.status)}
              </Badge>
            </span>
          }
        />

        {intent.raw_text && (
          <p
            className="t-body"
            style={{
              margin: '0 0 16px',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              fontStyle: 'italic',
            }}
          >
            “{intent.raw_text}”
          </p>
        )}

        <div
          className="grid-2"
          style={{ gap: '14px 16px', marginBottom: 16 }}
        >
          <Field label="Focus area">{DOMAIN_LABEL[intent.domain] ?? humanise(intent.domain)}</Field>
          <Field label="Setting">{intent.workplace_context || '—'}</Field>
          <Field label="You are">{intent.learner_role || '—'}</Field>
          <Field label="You're talking to">
            {intent.counterpart_role || '—'}
            {intent.counterpart_disposition && (
              <span style={{ marginLeft: 8 }}>
                <Badge
                  size="sm"
                  variant={DISPOSITION_VARIANT[intent.counterpart_disposition] ?? 'neutral'}
                >
                  {DISPOSITION_LABEL[intent.counterpart_disposition]}
                </Badge>
              </span>
            )}
          </Field>
        </div>

        <div className="divider" style={{ margin: '0 0 16px' }} />

        <DifficultyMeter
          difficulty={pedagogy.difficulty}
          band={pedagogy.difficulty_band}
        />

        <div
          className="t-cap"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 14 }}
        >
          {blueprint.medium && <span>{MEDIUM_LABEL[blueprint.medium] ?? humanise(blueprint.medium)}</span>}
          {blueprint.target_turn_count != null && (
            <span>{blueprint.target_turn_count} turns</span>
          )}
          {blueprint.est_duration_minutes != null && (
            <span>~{blueprint.est_duration_minutes} min</span>
          )}
          {intent.intensity_preference && (
            <span>{INTENSITY_LABEL[intent.intensity_preference]} intensity</span>
          )}
          {intent.session_length && (
            <span>{SESSION_LENGTH_LABEL[intent.session_length]} session</span>
          )}
        </div>

        {plan.target_skills?.length > 0 && (
          <>
            <div className="divider" style={{ margin: '16px 0' }} />
            <TargetSkillList skills={plan.target_skills} />
          </>
        )}
      </Card>
    </motion.div>
  )
}
