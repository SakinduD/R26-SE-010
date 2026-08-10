import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { RPE_PLAN_HANDOFF_ENABLED, RPE_PLAN_HANDOFF_PATH } from './constants'

/**
 * Hand off to RPE with this plan.
 *
 * RPE owns plan-driven scenario generation and hasn't shipped it yet, so the
 * button ships disabled behind RPE_PLAN_HANDOFF_ENABLED. Flip that one
 * constant when RPE lands — no other change needed here.
 */
export default function StartRolePlayButton({ planId, className = '', style }) {
  const label = 'Start role-play with this plan'

  if (!RPE_PLAN_HANDOFF_ENABLED) {
    return (
      <button
        type="button"
        className={`btn btn-secondary btn-lg ${className}`}
        style={style}
        disabled
        aria-disabled="true"
        title="Scenario generation coming soon"
      >
        <span
          className="btn-label"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {label}
        </span>
      </button>
    )
  }

  return (
    <Link
      to={`${RPE_PLAN_HANDOFF_PATH}?planId=${encodeURIComponent(planId)}`}
      className={`btn btn-primary btn-lg ${className}`}
      style={style}
    >
      <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {label}
        <ArrowRight size={14} strokeWidth={1.8} />
      </span>
    </Link>
  )
}
