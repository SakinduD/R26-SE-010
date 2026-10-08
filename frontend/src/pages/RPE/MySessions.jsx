import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Swords, LogIn, Trash2, RotateCcw, CheckCircle2, XCircle, MinusCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { useAuth } from '@/lib/auth/context'
import { cn } from '@/lib/utils'
import { FEEDBACK_THEME_VARS } from '@/components/RPE/feedback/feedbackTheme'
import PracticeJourneyHero from '@/components/RPE/journey/PracticeJourneyHero'
import PerformanceOverview from '@/components/RPE/journey/PerformanceOverview'
import TrustJourneyChart from '@/components/RPE/journey/TrustJourneyChart'
import SessionDetailPanel from '@/components/RPE/journey/SessionDetailPanel'
import PracticeFocus from '@/components/RPE/journey/PracticeFocus'
import SessionSnapshotCard from '@/components/RPE/journey/SessionSnapshotCard'
import GrowthMoments from '@/components/RPE/journey/GrowthMoments'
import EmptyPracticeState from '@/components/RPE/journey/EmptyPracticeState'
import JourneySkeleton from '@/components/RPE/journey/JourneySkeleton'

const STATUS_FILTERS = ['all', 'success', 'failure', 'incomplete']
const STATUS_FILTER_LABEL = { all: 'All', success: 'Strong', failure: 'Needs Work', incomplete: 'Not Finished' }
const PAGE_SIZE = 8
const TRUST_JOURNEY_WINDOW = 20 // most recent completed sessions shown on the chart — keeps it readable for accounts with a long history

// `outcome: 'ended_by_user'` (and any other end_reason/outcome combo that
// isn't a clear win/loss) means the session genuinely ended — it has real
// stats and a working "View Outcome" button below — just without a
// decisive result. Labeling that "Incomplete" (same word used for sessions
// that were abandoned mid-conversation, no ended_at at all) reads as a
// broken/unfinished session when it isn't. Mirrors the same honest-status
// split already made in SessionComplete.jsx.
function sessionStatus(session) {
  if (!session.ended_at) return { key: 'incomplete', tone: 'neutral', Icon: MinusCircle, label: 'Not Finished', shape: 'hollow' }
  if (session.end_reason === 'trust_sustained') return { key: 'success', tone: 'success', Icon: CheckCircle2, label: 'Trust Built', shape: 'circle' }
  if (session.end_reason === 'npc_exit')        return { key: 'failure', tone: 'danger',  Icon: XCircle,      label: 'NPC Exited', shape: 'diamond' }
  if (session.outcome === 'success')            return { key: 'success', tone: 'success', Icon: CheckCircle2, label: 'Success', shape: 'circle' }
  if (session.outcome === 'failure')            return { key: 'failure', tone: 'danger',  Icon: XCircle,      label: 'Needs Work', shape: 'diamond' }
  return { key: 'incomplete', tone: 'neutral', Icon: MinusCircle, label: 'Session Ended', shape: 'hollow' }
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return null
  const ms = new Date(endedAt) - new Date(startedAt)
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.round(ms / 60000)
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

function humanizeSkill(skill) {
  return skill.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function buildPageList(current, total) {
  const delta = 1
  const range = []
  for (let i = Math.max(2, current - delta); i <= Math.min(total - 1, current + delta); i++) range.push(i)
  const pages = [1]
  if (range[0] > 2) pages.push('…')
  pages.push(...range)
  if (range[range.length - 1] < total - 1) pages.push('…')
  if (total > 1) pages.push(total)
  return pages
}

function Pagination({ page, totalPages, totalItems, onChange }) {
  if (totalPages <= 1) return null
  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, totalItems)
  const pages = buildPageList(page, totalPages)

  return (
    <div className="pagination">
      <span className="pagination-range">Showing {start}–{end} of {totalItems}</span>
      <div className="pagination-controls">
        <button
          type="button" className="page-btn nav" disabled={page === 1}
          onClick={() => onChange(page - 1)} aria-label="Previous page"
        >
          <ChevronLeft size={15} strokeWidth={2.2} />
        </button>
        {pages.map((p, i) => (
          p === '…'
            ? <span key={`e${i}`} className="page-ellipsis">…</span>
            : (
              <button
                key={p} type="button" className={cn('page-btn', p === page && 'active')}
                onClick={() => onChange(p)} aria-current={p === page ? 'page' : undefined}
              >
                {p}
              </button>
            )
        ))}
        <button
          type="button" className="page-btn nav" disabled={page === totalPages}
          onClick={() => onChange(page + 1)} aria-label="Next page"
        >
          <ChevronRight size={15} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}

export default function MySessions() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading: authLoading } = useAuth()

  const [activeView, setActiveView]       = useState('active') // 'active' | 'trash'
  const [sessions, setSessions]           = useState([])
  const [scenarios, setScenarios]         = useState([])
  const [isLoading, setIsLoading]         = useState(true)
  const [error, setError]                 = useState(null)
  const [activeStatus, setActiveStatus]   = useState('all')
  const [selectMode, setSelectMode]       = useState(false)
  const [selectedIds, setSelectedIds]     = useState(() => new Set())
  const [isMutating, setIsMutating]       = useState(false)
  const [page, setPage]                   = useState(1)
  const [selectedPointIndex, setSelectedPointIndex] = useState(null)

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [sessionData, scenarioData] = await Promise.all([
        rpeService.getMyRpeSessions(activeView === 'trash'),
        rpeService.getScenarios().catch(() => []),
      ])
      setSessions(sessionData)
      setScenarios(scenarioData)
    } catch (err) {
      setError(err.message || "We couldn't load your sessions right now.")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) { setIsLoading(false); return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, activeView])

  // Selection doesn't carry across views — switching tabs starts fresh.
  const switchView = (view) => {
    setActiveView(view)
    setSelectMode(false)
    setSelectedIds(new Set())
    setSelectedPointIndex(null)
  }

  const scenarioMap = useMemo(() => {
    const map = {}
    scenarios.forEach((s) => { map[s.scenario_id] = s })
    return map
  }, [scenarios])

  const filteredSessions = useMemo(() => {
    if (activeView === 'trash' || activeStatus === 'all') return sessions
    return sessions.filter((s) => sessionStatus(s).key === activeStatus)
  }, [sessions, activeStatus, activeView])

  const statusCounts = useMemo(() => {
    const counts = { all: sessions.length, success: 0, failure: 0, incomplete: 0 }
    sessions.forEach((s) => { counts[sessionStatus(s).key] += 1 })
    return counts
  }, [sessions])

  // ── Practice Journey derived data — real data only, everything below is
  // computed from `sessions`/`scenarios` already fetched above; no extra
  // API calls, no fabricated values. ────────────────────────────────────

  // The active-tab fetch (getMyRpeSessions(false)) already excludes
  // trashed sessions server-side, but the journey stats (hero count,
  // performance metrics, trust chart, practice focus, growth) should never
  // count a recycled session even transiently (e.g. mid view-switch, or if
  // that server-side filtering ever changes) — filtered explicitly here so
  // the guarantee lives in this component too, not only in the backend.
  const journeySessions = useMemo(() => sessions.filter((s) => !s.deleted_at), [sessions])

  const completedSessions = useMemo(
    () => journeySessions
      .filter((s) => s.ended_at && s.final_trust != null)
      .slice()
      .sort((a, b) => new Date(a.started_at) - new Date(b.started_at)),
    [journeySessions]
  )

  const trustJourneyPoints = useMemo(() => {
    const windowed = completedSessions.slice(-TRUST_JOURNEY_WINDOW)
    return windowed.map((s) => {
      const status = sessionStatus(s)
      const info = scenarioMap[s.scenario_id]
      const duration = formatDuration(s.started_at, s.ended_at)
      return {
        sessionId: s.session_id,
        scenarioId: s.scenario_id,
        title: info?.title ?? s.scenario_id,
        difficulty: info?.difficulty ?? '',
        trust: s.final_trust,
        tone: status.tone,
        shape: status.shape,
        statusLabel: status.label,
        dateLabel: new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        durationLabel: duration,
      }
    })
  }, [completedSessions, scenarioMap])

  const performanceMetrics = useMemo(() => {
    const metrics = []
    if (journeySessions.length > 0) metrics.push({ value: journeySessions.length, label: 'Sessions' })

    if (completedSessions.length > 0) {
      const latest = completedSessions[completedSessions.length - 1]
      metrics.push({ value: latest.final_trust, label: 'Latest Trust', tone: latest.final_trust >= 70 ? 'success' : latest.final_trust >= 40 ? 'warning' : 'danger' })
    }

    if (completedSessions.length >= 2) {
      const first = completedSessions[0].final_trust
      const latest = completedSessions[completedSessions.length - 1].final_trust
      const growth = latest - first
      metrics.push({
        value: Math.abs(growth),
        prefix: growth >= 0 ? '+' : '−',
        label: 'Trust Growth',
        tone: growth > 0 ? 'success' : growth < 0 ? 'danger' : undefined,
      })
    }

    const skillSet = new Set()
    journeySessions.forEach((s) => {
      const skills = scenarioMap[s.scenario_id]?.target_skills
      if (Array.isArray(skills)) skills.forEach((sk) => skillSet.add(sk))
    })
    if (skillSet.size > 0) metrics.push({ value: skillSet.size, label: 'Skills Practiced' })

    return metrics
  }, [journeySessions, completedSessions, scenarioMap])

  // Each skill's count is how many of your (non-recycled) sessions were
  // tagged with it — a practice-repetition tally, not a proficiency score.
  // "sessions" is spelled out in the label so that reads unambiguously
  // wherever this shows up, not just as a bare number.
  const practiceFocusSkills = useMemo(() => {
    const counts = {}
    journeySessions.forEach((s) => {
      const skills = scenarioMap[s.scenario_id]?.target_skills
      if (!Array.isArray(skills)) return
      skills.forEach((sk) => { counts[sk] = (counts[sk] || 0) + 1 })
    })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name: humanizeSkill(name), count }))
  }, [sessions, scenarioMap])

  const growthMoments = useMemo(() => {
    if (completedSessions.length < 4) return []
    const moments = []
    const recentN = Math.min(3, Math.floor(completedSessions.length / 2))
    const recent = completedSessions.slice(-recentN)
    const earlier = completedSessions.slice(0, completedSessions.length - recentN)
    const avg = (arr) => arr.reduce((sum, s) => sum + s.final_trust, 0) / arr.length
    const recentAvg = Math.round(avg(recent))
    const earlierAvg = Math.round(avg(earlier))
    const diff = recentAvg - earlierAvg

    if (Math.abs(diff) >= 3) {
      moments.push({
        type: diff > 0 ? 'up' : 'down',
        title: diff > 0 ? 'Trust is trending up' : 'Trust dipped recently',
        text: `Averaging ${recentAvg} in your last ${recentN} sessions, vs ${earlierAvg} before that.`,
      })
    }

    const skillsIn = (arr) => {
      const counts = {}
      arr.forEach((s) => {
        const skills = scenarioMap[s.scenario_id]?.target_skills
        if (Array.isArray(skills)) skills.forEach((sk) => { counts[sk] = (counts[sk] || 0) + 1 })
      })
      return counts
    }
    const recentSkillCounts = skillsIn(recent)
    const topRecentSkill = Object.entries(recentSkillCounts).sort((a, b) => b[1] - a[1])[0]
    if (topRecentSkill && topRecentSkill[1] >= 2) {
      moments.push({
        type: 'focus',
        title: `Recent focus: ${humanizeSkill(topRecentSkill[0])}`,
        text: `You've practiced this in ${topRecentSkill[1]} of your last ${recentN} sessions.`,
      })
    }

    return moments
  }, [completedSessions, scenarioMap])

  // Changing tabs/filters is a deliberate jump — start back at page 1.
  useEffect(() => { setPage(1) }, [activeView, activeStatus])

  // A bulk delete/restore can shrink the list out from under the current
  // page (e.g. purging the last item on page 3) — pull back into range
  // instead of leaving the user on a page invisible to normal Prev/Next.
  const totalPages = Math.max(1, Math.ceil(filteredSessions.length / PAGE_SIZE))
  useEffect(() => { setPage((p) => Math.min(p, totalPages)) }, [totalPages])

  const paginatedSessions = useMemo(
    () => filteredSessions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredSessions, page]
  )

  const toggleSelectMode = () => {
    setSelectMode((v) => !v)
    setSelectedIds(new Set())
  }

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const runBulkAction = async (action) => {
    const ids = [...selectedIds]
    if (ids.length === 0) return

    if (action === 'purge') {
      const ok = window.confirm(
        `Permanently delete ${ids.length} session${ids.length > 1 ? 's' : ''}? This cannot be undone.`
      )
      if (!ok) return
    }

    setIsMutating(true)
    setError(null)
    try {
      if (action === 'trash')   await rpeService.trashSessions(ids)
      if (action === 'restore') await rpeService.restoreSessions(ids)
      if (action === 'purge')   await rpeService.purgeSessions(ids)
      setSelectMode(false)
      setSelectedIds(new Set())
      await load()
      // Trash/restore happens without leaving this page, so the Topbar's
      // active-session pill (which otherwise only refetches on route
      // change) needs an explicit nudge to reflect the new count now.
      window.dispatchEvent(new Event('ez:rpe-sessions-changed'))
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setIsMutating(false)
    }
  }

  const selectedPoint = selectedPointIndex != null ? trustJourneyPoints[selectedPointIndex] : null
  const isTrashView = activeView === 'trash'

  return (
    <div className="rpe-cinema">
      <div className="page">

        <PracticeJourneyHero sessionCount={journeySessions.length} isTrashView={isTrashView} />

        {!authLoading && !isAuthenticated && (
          <div className="signin-prompt">
            <LogIn size={22} strokeWidth={1.8} />
            <p className="signin-title">Sign in to view your practice journey</p>
            <p className="signin-sub">Session records are tied to your account.</p>
            <a href="/signin" className="btn-c primary" style={{ textDecoration: 'none' }}>Sign in</a>
          </div>
        )}

        {isAuthenticated && isLoading && <JourneySkeleton />}

        {isAuthenticated && !isLoading && error && (
          <div className="banner danger">
            <p className="banner-title">Unable to load your practice journey.</p>
            <p className="banner-sub">We couldn't retrieve your sessions right now.</p>
            <button type="button" onClick={load} className="btn-c secondary" style={{ marginTop: 10 }}>Try again</button>
          </div>
        )}

        {isAuthenticated && !isLoading && !error && (
          <>
            {!isTrashView && sessions.length === 0 && (
              <EmptyPracticeState onBrowse={() => navigate('/roleplay')} />
            )}

            {!isTrashView && sessions.length > 0 && (
              <>
                <PerformanceOverview metrics={performanceMetrics} />

                {trustJourneyPoints.length > 0 && (
                  <section className="journey-section">
                    <p className="section-eyebrow">Trust Journey</p>
                    <h2 className="section-heading">How your trust is evolving</h2>
                    <TrustJourneyChart
                      sessions={trustJourneyPoints}
                      selectedIndex={selectedPointIndex}
                      onSelect={setSelectedPointIndex}
                    />
                    <SessionDetailPanel
                      point={selectedPoint}
                      onOpenFeedback={(id) => navigate(`/roleplay/feedback/${id}`)}
                      onClose={() => setSelectedPointIndex(null)}
                    />
                  </section>
                )}

                {practiceFocusSkills.length > 0 && (
                  <section className="journey-section">
                    <p className="section-eyebrow">Practice Focus</p>
                    <h2 className="section-heading">What you've been practicing</h2>
                    <PracticeFocus skills={practiceFocusSkills} />
                  </section>
                )}

                {growthMoments.length > 0 && (
                  <section className="journey-section">
                    <p className="section-eyebrow">Recent Growth</p>
                    <h2 className="section-heading">Patterns worth noticing</h2>
                    <GrowthMoments moments={growthMoments} />
                  </section>
                )}
              </>
            )}

            <section className="journey-section">
              {(sessions.length > 0 || isTrashView) && (
                <>
                  <p className="section-eyebrow">{isTrashView ? 'Recycle Bin' : 'Recent Sessions'}</p>
                  <h2 className="section-heading">{isTrashView ? 'Removed sessions' : 'Every conversation you\'ve practiced'}</h2>
                </>
              )}

              <div className="toolbar">
                <div className="seg-control manage-toggle">
                  <button type="button" className={cn('seg-btn', activeView === 'active' && 'active')} onClick={() => switchView('active')}>
                    Sessions
                  </button>
                  <button type="button" className={cn('seg-btn', activeView === 'trash' && 'active')} onClick={() => switchView('trash')}>
                    <Trash2 size={12} strokeWidth={2} /> Recycle Bin
                  </button>
                </div>

                {sessions.length > 0 && (
                  <button type="button" onClick={toggleSelectMode} className="btn-c secondary">
                    {selectMode ? 'Cancel' : 'Select'}
                  </button>
                )}
              </div>

              {activeView === 'active' && sessions.length > 0 && (
                <div className="seg-control">
                  {STATUS_FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={cn('seg-btn', activeStatus === f && 'active')}
                      onClick={() => setActiveStatus(f)}
                    >
                      {STATUS_FILTER_LABEL[f]} ({statusCounts[f]})
                    </button>
                  ))}
                </div>
              )}

              {sessions.length === 0 && (
                isTrashView ? (
                  <div className="empty-state">
                    <Trash2 size={28} strokeWidth={1.6} />
                    <p className="empty-title">Recycle bin is empty</p>
                    <p className="empty-desc">Sessions you move to the bin will show up here.</p>
                  </div>
                ) : (
                  <div className="empty-state">
                    <Swords size={28} strokeWidth={1.6} />
                    <p className="empty-title">No sessions yet</p>
                    <p className="empty-desc">Finish a role-play scenario and it'll show up here.</p>
                    <button type="button" onClick={() => navigate('/roleplay')} className="btn-c primary">
                      Browse scenarios
                    </button>
                  </div>
                )
              )}

              {sessions.length > 0 && filteredSessions.length === 0 && (
                <div className="empty-state">
                  <p className="empty-title">No sessions match this filter</p>
                  <button type="button" onClick={() => setActiveStatus('all')} className="btn-c secondary">
                    Clear filter
                  </button>
                </div>
              )}

              {paginatedSessions.length > 0 && (
                <>
                  <div className={cn('grid-2', selectMode && selectedIds.size > 0 && 'grid-with-actionbar')}>
                    {paginatedSessions.map((session) => (
                      <SessionSnapshotCard
                        key={session.session_id}
                        session={session}
                        status={sessionStatus(session)}
                        scenarioInfo={scenarioMap[session.scenario_id]}
                        onOpenFeedback={(id) => navigate(`/roleplay/feedback/${id}`)}
                        onResumeSession={(id) => navigate(`/roleplay/session/${id}`)}
                        selectMode={selectMode}
                        selected={selectedIds.has(session.session_id)}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                  </div>

                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    totalItems={filteredSessions.length}
                    onChange={setPage}
                  />
                </>
              )}
            </section>
          </>
        )}

      </div>

      {selectMode && selectedIds.size > 0 && (
        <div className="action-bar">
          <div className="action-bar-inner">
            <span className="action-count">{selectedIds.size} selected</span>
            <div className="action-buttons">
              {activeView === 'active' ? (
                <button type="button" onClick={() => runBulkAction('trash')} disabled={isMutating} className="btn-c secondary">
                  <Trash2 size={13} strokeWidth={1.8} /> Move to Recycle Bin
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => runBulkAction('restore')} disabled={isMutating} className="btn-c secondary">
                    <RotateCcw size={13} strokeWidth={1.8} /> Restore
                  </button>
                  <button type="button" onClick={() => runBulkAction('purge')} disabled={isMutating} className="btn-c danger">
                    <Trash2 size={13} strokeWidth={1.8} /> Delete Permanently
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{FEEDBACK_THEME_VARS}{PAGE_STYLES}</style>
    </div>
  )
}

const PAGE_STYLES = `
  .rpe-cinema{
    min-height:calc(100vh - 48px);
    background:var(--bg); color:var(--text-hi);
    font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing:antialiased;
    padding-bottom:0;
  }
  .rpe-cinema button{ font-family:inherit; }
  .rpe-cinema a{ color:inherit; }

  .rpe-cinema .page{ max-width:1160px; margin:0 auto; padding:36px 24px 60px; display:flex; flex-direction:column; gap:32px; }

  .rpe-cinema .journey-section{ display:flex; flex-direction:column; gap:16px; }
  .rpe-cinema .section-eyebrow{ font-size:10.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); margin:0; }
  .rpe-cinema .section-heading{ font-size:21px; font-weight:750; letter-spacing:-0.01em; margin:2px 0 0; }

  .rpe-cinema .toolbar{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }

  .rpe-cinema .signin-prompt{
    display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px;
    background:var(--surface); border:1px solid var(--border); border-radius:18px; padding:48px 24px; color:var(--text-med);
    box-shadow:0 10px 28px rgba(17,12,34,0.05);
  }
  .rpe-cinema .signin-title{ font-size:15px; font-weight:700; color:var(--text-hi); margin:8px 0 0; }
  .rpe-cinema .signin-sub{ font-size:13px; margin:0 0 12px; }

  .rpe-cinema .seg-control{ display:inline-flex; background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:3px; gap:2px; flex-wrap:wrap; }
  .rpe-cinema .seg-control.manage-toggle{ opacity:.88; }
  .rpe-cinema .seg-btn{ display:inline-flex; align-items:center; gap:6px; background:transparent; border:none; cursor:pointer; color:var(--text-med); font-size:12.5px; font-weight:600; padding:7px 14px; border-radius:8px; transition:all .2s var(--ease); min-height:32px; }
  .rpe-cinema .seg-btn:hover{ color:var(--text-hi); }
  .rpe-cinema .seg-btn.active{ background:var(--accent); color:#fff; }

  .rpe-cinema .banner.danger{
    background:var(--danger-glow); border:1px solid rgba(248,81,73,0.3); color:var(--danger-text, #FF9490);
    border-radius:14px; padding:20px 22px;
  }
  .rpe-cinema .banner-title{ font-size:14px; font-weight:700; margin:0; }
  .rpe-cinema .banner-sub{ font-size:12.5px; margin:4px 0 0; opacity:.85; }

  .rpe-cinema .grid-2{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:680px){ .rpe-cinema .grid-2{ grid-template-columns:1fr; } }
  .rpe-cinema .grid-with-actionbar{ padding-bottom:80px; }

  .rpe-cinema .empty-state{
    display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px;
    background:var(--surface); border:1px solid var(--border); border-radius:18px; padding:48px 24px; color:var(--text-med);
    grid-column: 1 / -1;
    box-shadow:0 10px 28px rgba(17,12,34,0.05);
  }
  .rpe-cinema .empty-title{ font-size:15px; font-weight:700; color:var(--text-hi); margin:6px 0 0; }
  .rpe-cinema .empty-desc{ font-size:13px; margin:0 0 10px; max-width:340px; }

  .rpe-cinema .btn-c{ display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:650; padding:8px 15px; border-radius:9px; cursor:pointer; border:1px solid transparent; transition:filter .2s var(--ease), border-color .2s var(--ease); min-height:36px; }
  .rpe-cinema .btn-c.primary{ background:linear-gradient(135deg, var(--accent), #9B6BFF); color:#fff; }
  .rpe-cinema .btn-c.primary:hover{ filter:brightness(1.08); }
  .rpe-cinema .btn-c.secondary{ background:var(--surface-hi); border-color:var(--border); color:var(--text-hi); }
  .rpe-cinema .btn-c.secondary:hover{ border-color:var(--text-med); }
  .rpe-cinema .btn-c.danger{ background:var(--danger-glow); border-color:rgba(248,81,73,0.4); color:var(--danger-text, #FF9490); }
  .rpe-cinema .btn-c.danger:hover:not(:disabled){ background:rgba(248,81,73,0.25); }
  .rpe-cinema .btn-c:disabled{ opacity:.5; cursor:default; }

  .rpe-cinema .pagination{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding-top:4px; }
  .rpe-cinema .pagination-range{ font-size:12px; color:var(--text-low); }
  .rpe-cinema .pagination-controls{ display:flex; align-items:center; gap:4px; }
  .rpe-cinema .page-btn{
    min-width:36px; height:36px; padding:0 8px; display:inline-flex; align-items:center; justify-content:center;
    background:var(--surface); border:1px solid var(--border); border-radius:9px; color:var(--text-med);
    font-size:12.5px; font-weight:650; font-variant-numeric:tabular-nums; cursor:pointer;
    transition:background .18s var(--ease), color .18s var(--ease), border-color .18s var(--ease);
  }
  .rpe-cinema .page-btn:hover:not(:disabled){ border-color:var(--text-med); color:var(--text-hi); }
  .rpe-cinema .page-btn.active{ background:var(--accent); border-color:var(--accent); color:#fff; }
  .rpe-cinema .page-btn:disabled{ opacity:.4; cursor:default; }
  .rpe-cinema .page-ellipsis{ width:20px; text-align:center; color:var(--text-low); font-size:12.5px; }

  .rpe-cinema .action-bar{
    position:fixed; left:0; right:0; bottom:0; z-index:20; background:var(--surface); border-top:1px solid var(--border);
    box-shadow:0 -8px 24px rgba(17,12,34,0.1);
    animation:actionBarIn .25s var(--ease);
  }
  @keyframes actionBarIn{ from{ opacity:0; transform:translateY(8px); } to{ opacity:1; transform:none; } }
  .rpe-cinema .action-bar-inner{
    max-width:1160px; margin:0 auto; padding:14px 24px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
  }
  .rpe-cinema .action-count{ font-size:13px; font-weight:650; color:var(--text-hi); }
  .rpe-cinema .action-buttons{ display:flex; gap:8px; flex-wrap:wrap; }

  @media (max-width:640px){
    .rpe-cinema .page{ padding:24px 16px 48px; gap:26px; }
    .rpe-cinema .toolbar{ flex-direction:row; overflow-x:auto; }
  }
`
