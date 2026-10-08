import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Award, Bell } from 'lucide-react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { useAchievements } from '@/lib/achievements/AchievementsContext'

const TIER_COLOR = { gold: 'var(--warning)', silver: 'var(--info)', bronze: 'var(--accent)' }
const MAX_VISIBLE = 8

/**
 * Topbar notification bell — shows recently earned achievement badges.
 * Reads from AchievementsContext rather than fetching its own data, so it
 * never independently "consumes" the unseen-badge diff (see
 * AchievementsContext's docstring for why that matters).
 */
export default function NotificationBell() {
  const { badges, unseenBadges } = useAchievements()
  const [open, setOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const containerRef = useRef(null)
  const reduceMotion = useReducedMotion()

  const earned = badges
    .filter((badge) => badge.earned)
    .sort((a, b) => new Date(b.earned_at) - new Date(a.earned_at))
    .slice(0, MAX_VISIBLE)
  const unseenKeys = new Set(unseenBadges.map((badge) => badge.badge_key))
  const showDot = unseenBadges.length > 0 && !acknowledged

  useEffect(() => {
    if (!open) return undefined
    const onClickAway = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickAway)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        className="icon-btn"
        aria-label="Notifications"
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          setAcknowledged(true)
        }}
        style={{ position: 'relative' }}
      >
        <Bell size={14} strokeWidth={1.6} />
        {showDot && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--danger)',
              border: '1.5px solid var(--bg-elevated)',
            }}
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.2, ease: 'easeOut' }}
            style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 320, zIndex: 100 }}
          >
            <Card variant="elevated" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
                <span className="t-over">Achievements</span>
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {earned.length === 0 ? (
                  <div className="t-cap" style={{ padding: 16, textAlign: 'center' }}>
                    Complete a session to start earning badges
                  </div>
                ) : (
                  earned.map((badge) => (
                    <BadgeRow key={badge.badge_key} badge={badge} isNew={unseenKeys.has(badge.badge_key)} />
                  ))
                )}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function BadgeRow({ badge, isNew }) {
  const tierColor = TIER_COLOR[badge.tier] || 'var(--accent)'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          flexShrink: 0,
          background: `color-mix(in oklch, ${tierColor} 16%, transparent)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: tierColor,
        }}
      >
        <Award size={14} strokeWidth={1.8} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{badge.title}</span>
          {isNew && <Badge variant="success" size="sm">New</Badge>}
        </div>
        <div className="t-cap" style={{ marginTop: 2, lineHeight: 1.4 }}>{badge.description}</div>
      </div>
    </div>
  )
}
