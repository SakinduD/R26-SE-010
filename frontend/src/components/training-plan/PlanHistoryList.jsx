import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { History, ChevronRight } from 'lucide-react'
import { fadeInUp } from '@/lib/animations'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import CardHeader from './CardHeader'
import { DOMAIN_LABEL, STATUS_LABEL, STATUS_VARIANT, humanise } from './constants'

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function HistoryRow({ item, isCurrent }) {
  return (
    <Link
      to={`/training-plan/${item.plan_id}`}
      className="card card-interactive"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        textDecoration: 'none',
        color: 'inherit',
      }}
      aria-current={isCurrent ? 'true' : undefined}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="fg"
          style={{
            fontSize: 14,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.title_hint || DOMAIN_LABEL[item.domain] || humanise(item.domain)}
        </div>
        <div className="t-cap" style={{ marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>v{item.plan_version}</span>
          <span>Difficulty {item.difficulty}/10</span>
          {formatDate(item.created_at) && <span>{formatDate(item.created_at)}</span>}
        </div>
      </div>
      <Badge variant={STATUS_VARIANT[item.status] ?? 'neutral'}>
        {STATUS_LABEL[item.status] ?? humanise(item.status)}
      </Badge>
      <span aria-hidden style={{ color: 'var(--text-tertiary)', display: 'inline-flex' }}>
        <ChevronRight size={16} strokeWidth={1.6} />
      </span>
    </Link>
  )
}

/** Previous plan versions — click through to the detail view. */
export default function PlanHistoryList({ items = [], total = 0, currentPlanId, action }) {
  return (
    <motion.div variants={fadeInUp}>
      <Card>
        <CardHeader
          icon={History}
          title={`Plan history${total ? ` (${total})` : ''}`}
          tone="muted"
          right={action}
        />

        {items.length === 0 ? (
          <EmptyState
            icon={History}
            title="No previous plans"
            description="Each plan you generate is kept here so you can look back at what you practised."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((item) => (
              <HistoryRow
                key={item.plan_id}
                item={item}
                isCurrent={item.plan_id === currentPlanId}
              />
            ))}
          </div>
        )}
      </Card>
    </motion.div>
  )
}
