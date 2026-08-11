import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Award,
  Calendar,
  Flame,
  Info,
  Lock,
  Sparkles,
  Trophy,
  Zap,
} from 'lucide-react'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsLoadButton from './AnalyticsLoadButton'
// REDESIGN: AnalyticsNav removed — sidebar Progress section now handles navigation
import { useAnalyticsIdentity } from './analyticsAuth'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import PageHead from '@/components/ui/PageHead'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TIER_VARIANT = { gold: 'warning', silver: 'info', bronze: 'neutral' }
const TIER_COLOR = { gold: 'var(--warning)', silver: 'var(--info)', bronze: 'var(--accent)' }

// This page deliberately has no demo/placeholder dataset. Showing invented XP,
// levels or badges would misrepresent the learner's actual record, so when the
// API is unreachable the page says so rather than filling the gap with fiction.

export default function GamifiedProgress() {
  const params = useParams()
  const { userId: connectedUserId, userLabel, isAuthLoading, isAuthenticated } =
    useAnalyticsIdentity(params.userId)

  const [data, setData] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [justEarned, setJustEarned] = useState([])

  const earnedBadges = useMemo(
    () => (data?.badges || []).filter((badge) => badge.earned),
    [data]
  )
  const lockedBadges = useMemo(
    () =>
      (data?.badges || [])
        .filter((badge) => !badge.earned)
        .sort((a, b) => (b.progress_percent || 0) - (a.progress_percent || 0)),
    [data]
  )

  // Sync first so any session completed since the last visit is scored, then the
  // response already carries the refreshed profile — no second round trip.
  const loadProgress = async (targetUserId = connectedUserId) => {
    if (!targetUserId) {
      setError('No connected user')
      return
    }
    setStatus('loading')
    setError('')
    try {
      const result = await analyticsService.syncGamificationByUser(targetUserId)
      setData(result.profile)
      setJustEarned(result.newly_earned_badges || [])
      setStatus('live')
    } catch {
      // The sync could not run — fall back to the last persisted profile, which
      // is still the learner's real record, and say that no new XP was awarded.
      try {
        setData(await analyticsService.getGamificationByUser(targetUserId))
        setJustEarned([])
        setStatus('live')
        setError('Could not award new XP — showing your last saved progress.')
      } catch {
        setData(null)
        setStatus('error')
        setError('Progress data is unavailable right now. Nothing is shown rather than a guess.')
      }
    }
  }

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated && connectedUserId) loadProgress(connectedUserId)
  }, [connectedUserId, isAuthLoading, isAuthenticated])

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="page page-wide">
      <PageHead
        eyebrow="Feedback System & Predictive Analytics"
        title="Your Skill Journey"
        sub="XP, levels, learning streaks and achievement badges — every award is earned from your own session data against a fixed, published rule."
      />

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 20 }}>
        <AnalyticsLoadButton loading={status === 'loading'} onClick={() => loadProgress(connectedUserId)} />
      </motion.div>

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Badge variant={status === 'error' ? 'danger' : 'neutral'}>
          {status === 'live'
            ? 'Live progress'
            : status === 'loading'
              ? 'Loading…'
              : status === 'error'
                ? 'Unavailable'
                : 'Not loaded'}
        </Badge>
        {isAuthenticated && <span className="t-cap">{userLabel}</span>}
        {data?.rules_version && <span className="t-cap">{data.rules_version}</span>}
        {error && (
          <span className="t-cap" style={{ color: status === 'error' ? 'var(--danger)' : 'var(--warning)' }}>
            {error}
          </span>
        )}
      </motion.div>

      {!data && (
        <motion.div variants={fadeInUp}>
          <Card>
            <EmptyMsg
              text={
                status === 'loading'
                  ? 'Loading your progress…'
                  : status === 'error'
                    ? 'Your progress could not be loaded. No figures are shown, because an invented number would be worse than none.'
                    : 'Press Load Results to calculate your progress from your recorded sessions.'
              }
            />
          </Card>
        </motion.div>
      )}

      {justEarned.length > 0 && (
        <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--radius)',
              border: '1px solid color-mix(in oklch, var(--success) 40%, transparent)',
              background: 'color-mix(in oklch, var(--success) 10%, transparent)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <Sparkles size={14} strokeWidth={1.8} style={{ color: 'var(--success)' }} />
            <span className="t-cap" style={{ color: 'var(--success)' }}>
              New badge{justEarned.length > 1 ? 's' : ''} unlocked:{' '}
              {justEarned.map((badge) => badge.title).join(', ')}
            </span>
          </div>
        </motion.div>
      )}

      {data && (
        <>
          {/* Overall level + streak */}
          <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
            <Card>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ minWidth: 260, flex: '1 1 320px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <Trophy size={14} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
                    <div className="t-over">Overall Level</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                    <span className="score-num fg" style={{ fontSize: 40, fontWeight: 600, lineHeight: 1 }}>
                      {data.level_progress.level}
                    </span>
                    <span className="t-cap">{data.level_progress.total_xp} XP total</span>
                  </div>
                  <ProgressTrack percent={data.level_progress.progress_percent} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <span className="t-cap">
                      {data.level_progress.xp_into_level} / {data.level_progress.xp_for_next_level} XP
                    </span>
                    <span className="t-cap">
                      {data.level_progress.xp_to_next_level} XP to level {data.level_progress.level + 1}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(88px, 1fr))', gap: 10, minWidth: 280 }}>
                  <MetricBox icon={Flame} label="Streak" value={data.streak.current_streak} hint="days" />
                  <MetricBox icon={Award} label="Best" value={data.streak.longest_streak} hint="days" />
                  <MetricBox icon={Calendar} label="Days" value={data.streak.total_learning_days} hint="active" />
                  <MetricBox icon={Zap} label="Sessions" value={data.session_count} hint="done" />
                </div>
              </div>
            </Card>
          </motion.div>

          <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
            <Panel title="Skill Levels" icon={Zap}>
              <SkillLevelList levels={data.skill_levels || []} />
            </Panel>
            <Panel title="Learning Streak" icon={Flame}>
              <StreakTracker streak={data.streak} />
            </Panel>
          </motion.div>

          <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
            <Panel
              title={`Achievement Badges — ${data.badge_summary.earned_count} / ${data.badge_summary.total_count}`}
              icon={Award}
            >
              {earnedBadges.length === 0 && lockedBadges.length === 0 ? (
                <EmptyMsg text="Complete a session to start earning badges" />
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 12,
                  }}
                >
                  {[...earnedBadges, ...lockedBadges].map((badge) => (
                    <BadgeTile key={badge.badge_key} badge={badge} />
                  ))}
                </div>
              )}
            </Panel>
          </motion.div>

          <motion.div variants={fadeInUp}>
            <Panel title="How XP Is Earned" icon={Info}>
              <RulesExplainer rules={data.rules} />
            </Panel>
          </motion.div>
        </>
      )}
    </motion.div>
  )
}

function SkillLevelList({ levels }) {
  if (!levels.length) return <EmptyMsg text="No skill progress yet" />

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {levels.map((item) => (
        <div key={item.skill_area}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</span>
            <span className="t-cap">
              Level {item.level}
              {item.latest_score != null ? ` · latest ${Math.round(item.latest_score)}` : ''}
            </span>
          </div>
          <ProgressTrack percent={item.progress_percent} />
          <div className="t-cap" style={{ marginTop: 4 }}>
            {item.xp} XP · {item.xp_to_next_level} to level {item.level + 1}
          </div>
        </div>
      ))}
    </div>
  )
}

function StreakTracker({ streak }) {
  const week = streak.week_activity?.length === 7 ? streak.week_activity : new Array(7).fill(false)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <Flame
          size={22}
          strokeWidth={1.8}
          style={{ color: streak.current_streak > 0 ? 'var(--warning)' : 'var(--text-quaternary)' }}
        />
        <span className="score-num fg" style={{ fontSize: 32, fontWeight: 600, lineHeight: 1 }}>
          {streak.current_streak}
        </span>
        <span className="t-cap">day streak</span>
      </div>

      <div className="t-cap" style={{ marginBottom: 8 }}>This week</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {week.map((active, index) => (
          <div key={WEEKDAYS[index]} style={{ textAlign: 'center' }}>
            <div
              style={{
                height: 32,
                borderRadius: 'var(--radius)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--border-subtle)',
                background: active
                  ? 'color-mix(in oklch, var(--warning) 22%, transparent)'
                  : 'var(--bg-input)',
                color: active ? 'var(--warning)' : 'var(--text-quaternary)',
                fontSize: 13,
              }}
              title={active ? `Trained on ${WEEKDAYS[index]}` : `No session on ${WEEKDAYS[index]}`}
            >
              {active ? '✓' : '·'}
            </div>
            <div className="t-cap" style={{ marginTop: 4 }}>{WEEKDAYS[index]}</div>
          </div>
        ))}
      </div>

      <p className="t-cap" style={{ marginTop: 14, lineHeight: 1.6 }}>
        {streak.active_today
          ? 'You have already trained today — your streak is safe.'
          : streak.current_streak > 0
            ? 'Train today to keep your streak alive.'
            : 'A streak starts on your next session. Training on consecutive days also increases the XP you earn.'}
      </p>
    </div>
  )
}

function BadgeTile({ badge }) {
  const tierColor = TIER_COLOR[badge.tier] || 'var(--accent)'

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 'var(--radius)',
        border: `1px solid ${badge.earned ? `color-mix(in oklch, ${tierColor} 45%, transparent)` : 'var(--border-subtle)'}`,
        background: badge.earned
          ? `color-mix(in oklch, ${tierColor} 10%, transparent)`
          : 'var(--bg-input)',
        opacity: badge.earned ? 1 : 0.72,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        {badge.earned ? (
          <Award size={16} strokeWidth={1.8} style={{ color: tierColor }} />
        ) : (
          <Lock size={16} strokeWidth={1.8} style={{ color: 'var(--text-quaternary)' }} />
        )}
        <Badge variant={badge.earned ? TIER_VARIANT[badge.tier] || 'neutral' : 'neutral'} size="sm">
          {badge.earned ? badge.tier : 'locked'}
        </Badge>
      </div>

      <div className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{badge.title}</div>
      <div className="t-cap" style={{ marginTop: 4, lineHeight: 1.5 }}>{badge.description}</div>

      <div
        className="t-cap"
        style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border-subtle)', lineHeight: 1.5 }}
      >
        {badge.criteria}
      </div>

      {badge.earned ? (
        <div className="t-cap" style={{ marginTop: 6, color: tierColor }}>
          Earned{badge.earned_at ? ` · ${formatDate(badge.earned_at)}` : ''}
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <ProgressTrack percent={badge.progress_percent} />
          {badge.progress_hint && (
            <div className="t-cap" style={{ marginTop: 4 }}>{badge.progress_hint}</div>
          )}
        </div>
      )}
    </div>
  )
}

// The formula is served by the API rather than restated here, so the table can
// never drift away from the engine that actually awards the XP.
function RulesExplainer({ rules }) {
  if (!rules) return <EmptyMsg text="Rules unavailable" />

  const rows = [
    ['Participation', 'Every completed session', `+${rules.base_session_xp} XP`],
    [
      'Performance',
      `Your overall session score × ${rules.performance_xp_factor}`,
      `+0 – ${rules.max_performance_xp} XP`,
    ],
    [
      'Streak bonus',
      `${rules.streak_xp_per_day} XP per streak day, capped at ${rules.max_streak_bonus_days} days`,
      `+0 – ${rules.max_streak_bonus_xp} XP`,
    ],
    [
      'Level up',
      `Level n → n+1 costs ${rules.level_base_xp} + (n − 1) × ${rules.level_growth_xp} XP`,
      `L1→L2 = ${rules.level_base_xp} XP`,
    ],
    ['Learning day', `Days are counted in ${rules.timezone} local time`, '1 day per date'],
  ]

  return (
    <div>
      <div style={{ overflowX: 'auto', borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ minWidth: 520 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
            {['Source', 'Rule', 'Value'].map((header) => (
              <span key={header} className="t-cap" style={{ fontWeight: 500 }}>{header}</span>
            ))}
          </div>
          {rows.map(([source, rule, value]) => (
            <div key={source} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
              <span className="fg" style={{ fontWeight: 500 }}>{source}</span>
              <span className="t-cap">{rule}</span>
              <span className="fg">{value}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="t-cap" style={{ marginTop: 12, lineHeight: 1.6 }}>
        Every value on this page is recomputed from your recorded sessions, so a badge can always be
        traced back to the exact sessions that unlocked it. No score is ever awarded manually.
      </p>
    </div>
  )
}

function ProgressTrack({ percent }) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0))
  return (
    <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-input)', overflow: 'hidden' }}>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--accent)', width: `${value}%`, transition: 'width 0.3s' }} />
    </div>
  )
}

function MetricBox({ icon: Icon, label, value, hint }) {
  return (
    <div style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
      <Icon size={13} strokeWidth={1.8} style={{ color: 'var(--accent)', marginBottom: 6 }} />
      <div className="t-cap">{label}</div>
      <div className="fg" style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{value}</div>
      {hint && <div className="t-cap">{hint}</div>}
    </div>
  )
}

function Panel({ title, icon: Icon, children }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Icon size={14} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
        <div className="t-over">{title}</div>
      </div>
      {children}
    </Card>
  )
}

function EmptyMsg({ text }) {
  return (
    <div style={{ padding: 20, borderRadius: 'var(--radius)', border: '1px dashed var(--border-subtle)', textAlign: 'center' }}>
      <span className="t-cap">{text}</span>
    </div>
  )
}

function formatDate(value) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
