import React from 'react'
import { toast } from 'sonner'
import { motion, useReducedMotion } from 'framer-motion'
import { Award, Sparkles, X } from 'lucide-react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

// Mirrors GamifiedProgress.jsx's tier styling so an earned badge reads the
// same way everywhere it appears.
const TIER_VARIANT = { gold: 'warning', silver: 'info', bronze: 'neutral' }
const TIER_COLOR = { gold: 'var(--warning)', silver: 'var(--info)', bronze: 'var(--accent)' }

const TOAST_DURATION_MS = 6000
const STAGGER_MS = 300

/**
 * Fire one toast per newly-earned badge, staggered slightly so several at
 * once cascade in rather than all popping in on the same frame.
 * @param {Array<{badge_key: string, title: string, description: string, tier: string}>} badges
 */
export function showAchievementToasts(badges) {
  ;(badges || []).forEach((badge, index) => {
    setTimeout(() => {
      toast.custom((id) => <AchievementToastCard badge={badge} toastId={id} />, {
        duration: TOAST_DURATION_MS,
      })
    }, index * STAGGER_MS)
  })
}

function AchievementToastCard({ badge, toastId }) {
  const reduceMotion = useReducedMotion()
  const tierColor = TIER_COLOR[badge.tier] || 'var(--accent)'

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduceMotion ? 0.15 : 0.3, ease: 'easeOut' }}
      style={{ width: 360, maxWidth: '92vw' }}
    >
      <Card
        variant="elevated"
        style={{
          position: 'relative',
          border: `1px solid color-mix(in oklch, ${tierColor} 45%, transparent)`,
          background: `color-mix(in oklch, ${tierColor} 8%, var(--bg-input))`,
        }}
      >
        {/* toast.custom renders are excluded from the Toaster's global
            closeButton (sonner only adds it when !toast.jsx), so this
            needs its own dismiss control. */}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => toast.dismiss(toastId)}
          className="btn btn-ghost"
          style={{ position: 'absolute', top: 6, right: 6, padding: 4, height: 'auto', minWidth: 0 }}
        >
          <X size={13} strokeWidth={1.8} />
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingRight: 20 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              flexShrink: 0,
              background: `color-mix(in oklch, ${tierColor} 16%, transparent)`,
              border: `1px solid color-mix(in oklch, ${tierColor} 30%, transparent)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: tierColor,
            }}
          >
            <Award size={16} strokeWidth={1.8} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <Sparkles size={11} strokeWidth={1.8} style={{ color: tierColor }} />
              <span className="t-cap" style={{ color: tierColor }}>Badge unlocked</span>
              <Badge variant={TIER_VARIANT[badge.tier] || 'neutral'} size="sm">{badge.tier}</Badge>
            </div>
            <div className="fg" style={{ fontSize: 14, fontWeight: 600 }}>{badge.title}</div>
            <div className="t-cap" style={{ marginTop: 3, lineHeight: 1.5 }}>{badge.description}</div>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
