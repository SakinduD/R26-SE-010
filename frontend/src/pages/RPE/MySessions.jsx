import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Swords, BarChart2, LogIn, Clock3, Trash2, RotateCcw, CheckCircle2, XCircle, MinusCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { useAuth } from '@/lib/auth/context'
import { cn } from '@/lib/utils'
import { FEEDBACK_THEME_VARS } from '@/components/RPE/feedback/feedbackTheme'

const STATUS_FILTERS = ['all', 'success', 'failure', 'incomplete']
const PAGE_SIZE = 8

// `outcome: 'ended_by_user'` (and any other end_reason/outcome combo that
// isn't a clear win/loss) means the session genuinely ended — it has real
// stats and a working "View Outcome" button below — just without a
// decisive result. Labeling that "Incomplete" (same word used for sessions
// that were abandoned mid-conversation, no ended_at at all) reads as a
// broken/unfinished session when it isn't. Mirrors the same honest-status
// split already made in SessionComplete.jsx.
function sessionStatus(session) {
  if (!session.ended_at) return { key: 'incomplete', tone: 'neutral', Icon: MinusCircle, label: 'Not Finished' }
  if (session.end_reason === 'trust_sustained') return { key: 'success', tone: 'success', Icon: CheckCircle2, label: 'Trust Built' }
  if (session.end_reason === 'npc_exit')        return { key: 'failure', tone: 'danger',  Icon: XCircle,      label: 'NPC Exited' }
  if (session.outcome === 'success')            return { key: 'success', tone: 'success', Icon: CheckCircle2, label: 'Success' }
  if (session.outcome === 'failure')            return { key: 'failure', tone: 'danger',  Icon: XCircle,      label: 'Needs Work' }
  return { key: 'incomplete', tone: 'neutral', Icon: MinusCircle, label: 'Session Ended' }
}

function trustTone(v) {
  if (v == null) return 'neutral'
  return v >= 70 ? 'success' : v >= 40 ? 'warning' : 'danger'
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
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

const DIFFICULTY_TONE = { beginner: 'success', intermediate: 'warning', advanced: 'danger' }

function SessionCard({ session, scenarioInfo, onOpenFeedback, selectMode, selected, onToggleSelect }) {
  const status = sessionStatus(session)
  const duration = formatDuration(session.started_at, session.ended_at)

  return (
    <div
      className={cn('session-card', status.tone, selectMode && 'selectable', selected && 'selected')}
      onClick={() => selectMode && onToggleSelect(session.session_id)}
    >
      <span className="session-accent" aria-hidden />

      {selectMode && (
        <label className="session-check" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect(session.session_id)} />
        </label>
      )}

      <div className="session-card-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="session-title">{scenarioInfo?.title ?? session.scenario_id}</h3>
          <div className="session-meta-row">
            {scenarioInfo?.difficulty && <span className={cn('pill', DIFFICULTY_TONE[scenarioInfo.difficulty] ?? 'neutral')}>{scenarioInfo.difficulty}</span>}
            <span className="session-date">{formatDate(session.started_at)}</span>
          </div>
        </div>
        <span className={cn('pill', status.tone)}>
          <status.Icon size={11} strokeWidth={2.2} /> {status.label}
        </span>
      </div>

      {session.ended_at ? (
        <div className="session-stats">
          <div className="session-stat">
            <span className="session-stat-label">Trust</span>
            <span className={cn('session-stat-val', trustTone(session.final_trust))}>{session.final_trust ?? '—'}</span>
          </div>
          <div className="session-stat">
            <span className="session-stat-label">Escalation</span>
            <span className="session-stat-val">{session.final_escalation ?? '—'}<span className="unit">/5</span></span>
          </div>
          <div className="session-stat">
            <span className="session-stat-label">Duration</span>
            <span className="session-stat-val small">
              {duration ? <><Clock3 size={11} strokeWidth={2} /> {duration}</> : '—'}
            </span>
          </div>
        </div>
      ) : (
        <div className="session-noresult">
          <Clock3 size={14} strokeWidth={1.8} />
          <span>Left mid-conversation — no results recorded</span>
        </div>
      )}

      {!selectMode && session.ended_at && (
        <div className="session-actions">
          <button type="button" onClick={() => onOpenFeedback(session.session_id)} className="btn-c primary">
            <BarChart2 size={13} strokeWidth={1.8} /> View Outcome
          </button>
        </div>
      )}
    </div>
  )
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
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setIsMutating(false)
    }
  }

  return (
    <div className="rpe-cinema">
      <div className="hero-band">
        <div className="hero-inner">
          <p className="eyebrow">Practice</p>
          <h1 className="hero-title">Your Sessions</h1>
          <p className="hero-sub">
            {activeView === 'trash'
              ? 'Sessions you\'ve removed — restore them or delete for good.'
              : 'Review past role-play sessions and revisit your outcomes.'}
          </p>
        </div>
      </div>

      <div className={cn('page', selectMode && selectedIds.size > 0 && 'page-with-actionbar')}>

        {!authLoading && !isAuthenticated && (
          <div className="signin-prompt">
            <LogIn size={22} strokeWidth={1.8} />
            <p className="signin-title">Sign in to view your session history</p>
            <p className="signin-sub">Session records are tied to your account.</p>
            <a href="/signin" className="btn-c primary" style={{ textDecoration: 'none' }}>Sign in</a>
          </div>
        )}

        {isAuthenticated && (
          <>
            <div className="toolbar">
              <div className="seg-control">
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
                    {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)} ({statusCounts[f]})
                  </button>
                ))}
              </div>
            )}

            {error && (
              <div className="banner danger">{error}</div>
            )}

            {isLoading && (
              <div className="grid-2">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="skel-card">
                    <div className="skel" style={{ height: 16, width: '60%', marginBottom: 10 }} />
                    <div className="skel" style={{ height: 12, width: '40%', marginBottom: 16 }} />
                    <div className="skel" style={{ height: 40, width: '100%' }} />
                  </div>
                ))}
              </div>
            )}

            {!isLoading && !error && sessions.length === 0 && (
              activeView === 'trash' ? (
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

            {!isLoading && !error && sessions.length > 0 && filteredSessions.length === 0 && (
              <div className="empty-state">
                <p className="empty-title">No sessions match this filter</p>
                <button type="button" onClick={() => setActiveStatus('all')} className="btn-c secondary">
                  Clear filter
                </button>
              </div>
            )}

            {!isLoading && paginatedSessions.length > 0 && (
              <>
                <div className="grid-2">
                  {paginatedSessions.map((session) => (
                    <SessionCard
                      key={session.session_id}
                      session={session}
                      scenarioInfo={scenarioMap[session.scenario_id]}
                      onOpenFeedback={(id) => navigate(`/roleplay/feedback/${id}`)}
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

  .rpe-cinema .hero-band{ border-bottom:1px solid var(--border); background:radial-gradient(120% 140% at 0% 0%, rgba(124,58,237,0.08) 0%, transparent 55%), var(--surface); }
  .rpe-cinema .hero-inner{ max-width:1024px; margin:0 auto; padding:40px 20px 32px; }
  .rpe-cinema .eyebrow{ font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); margin:0 0 8px; }
  .rpe-cinema .hero-title{ font-size:29px; font-weight:800; letter-spacing:-0.01em; margin:0; }
  .rpe-cinema .hero-sub{ font-size:13.5px; color:var(--text-med); margin:8px 0 0; }

  .rpe-cinema .page{ max-width:1024px; margin:0 auto; padding:28px 20px 40px; display:flex; flex-direction:column; gap:20px; }
  /* The bulk action bar is now fixed to the viewport bottom (not inline
     sticky) so it reads as a clearly separate floating layer instead of
     crowding directly under the pagination row — reserve room for it only
     while it's actually showing. */
  .rpe-cinema .page-with-actionbar{ padding-bottom:96px; }

  .rpe-cinema .toolbar{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }

  .rpe-cinema .signin-prompt{
    display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px;
    background:var(--surface); border:1px solid var(--border); border-radius:18px; padding:48px 24px; color:var(--text-med);
    box-shadow:0 10px 28px rgba(17,12,34,0.05);
  }
  .rpe-cinema .signin-title{ font-size:15px; font-weight:700; color:var(--text-hi); margin:8px 0 0; }
  .rpe-cinema .signin-sub{ font-size:13px; margin:0 0 12px; }

  .rpe-cinema .seg-control{ display:inline-flex; background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:3px; gap:2px; flex-wrap:wrap; }
  .rpe-cinema .seg-btn{ display:inline-flex; align-items:center; gap:6px; background:transparent; border:none; cursor:pointer; color:var(--text-med); font-size:12.5px; font-weight:600; padding:7px 14px; border-radius:8px; transition:all .2s var(--ease); }
  .rpe-cinema .seg-btn:hover{ color:var(--text-hi); }
  .rpe-cinema .seg-btn.active{ background:var(--accent); color:#fff; }

  .rpe-cinema .banner.danger{ background:var(--danger-glow); border:1px solid rgba(248,81,73,0.3); color:var(--danger-text, #FF9490); border-radius:12px; padding:12px 16px; font-size:13px; }

  .rpe-cinema .grid-2{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:680px){ .rpe-cinema .grid-2{ grid-template-columns:1fr; } }

  .rpe-cinema .skel-card{ background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:18px; }
  .rpe-cinema .skel{ background:linear-gradient(90deg, var(--surface-hi) 25%, var(--border) 50%, var(--surface-hi) 75%); background-size:200% 100%; border-radius:6px; animation:cinemaShimmer 1.4s ease-in-out infinite; }
  @keyframes cinemaShimmer{ 0%{ background-position:200% 0; } 100%{ background-position:-200% 0; } }

  .rpe-cinema .empty-state{
    display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px;
    background:var(--surface); border:1px solid var(--border); border-radius:18px; padding:48px 24px; color:var(--text-med);
    grid-column: 1 / -1;
    box-shadow:0 10px 28px rgba(17,12,34,0.05);
  }
  .rpe-cinema .empty-title{ font-size:15px; font-weight:700; color:var(--text-hi); margin:6px 0 0; }
  .rpe-cinema .empty-desc{ font-size:13px; margin:0 0 10px; max-width:340px; }

  .rpe-cinema .session-card{
    position:relative; overflow:hidden; background:var(--surface); border:1px solid var(--border); border-radius:16px;
    padding:18px 18px 18px 22px; display:flex; flex-direction:column; gap:14px;
    box-shadow:0 8px 22px rgba(17,12,34,0.05);
    transition:border-color .2s var(--ease), transform .2s var(--ease), box-shadow .2s var(--ease);
  }
  .rpe-cinema .session-card:hover{ border-color:rgba(124,58,237,0.35); transform:translateY(-2px); box-shadow:0 14px 30px rgba(17,12,34,0.09); }
  .rpe-cinema .session-card.selectable{ cursor:pointer; padding-left:50px; }
  .rpe-cinema .session-card.selected{ border-color:rgba(124,58,237,0.6); background:var(--accent-glow); }
  .rpe-cinema .session-check{ position:absolute; top:18px; left:20px; display:flex; z-index:1; }
  .rpe-cinema .session-check input{ width:17px; height:17px; accent-color:var(--accent); cursor:pointer; }

  .rpe-cinema .session-accent{ position:absolute; top:0; left:0; bottom:0; width:4px; background:var(--border); }
  .rpe-cinema .session-card.success .session-accent{ background:var(--success); }
  .rpe-cinema .session-card.danger  .session-accent{ background:var(--danger); }
  .rpe-cinema .session-card.neutral .session-accent{ background:var(--text-low); }

  .rpe-cinema .session-card-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
  .rpe-cinema .session-title{ font-size:14.5px; font-weight:700; margin:0; line-height:1.3; }
  .rpe-cinema .session-meta-row{ display:flex; align-items:center; gap:8px; margin-top:6px; flex-wrap:wrap; }
  .rpe-cinema .session-date{ font-size:11px; color:var(--text-low); }

  .rpe-cinema .pill{ display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:650; padding:3px 10px; border-radius:100px; text-transform:capitalize; flex-shrink:0; white-space:nowrap; }
  .rpe-cinema .pill.success{ color:var(--success); background:var(--success-glow); }
  .rpe-cinema .pill.warning{ color:var(--warning); background:var(--warning-glow); }
  .rpe-cinema .pill.danger{  color:var(--danger);  background:var(--danger-glow); }
  .rpe-cinema .pill.neutral{ color:var(--text-med); background:var(--surface-hi); }

  .rpe-cinema .session-stats{ display:flex; gap:10px; }
  .rpe-cinema .session-stat{ flex:1; background:var(--surface-hi); border:1px solid var(--border); border-radius:10px; padding:8px 10px; display:flex; flex-direction:column; gap:2px; align-items:center; }
  .rpe-cinema .session-stat-label{ font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:var(--text-low); }
  .rpe-cinema .session-stat-val{ font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--text-hi); }
  .rpe-cinema .session-stat-val.small{ font-size:11.5px; display:inline-flex; align-items:center; gap:4px; }
  .rpe-cinema .session-stat-val.success{ color:var(--success); }
  .rpe-cinema .session-stat-val.warning{ color:var(--warning); }
  .rpe-cinema .session-stat-val.danger{  color:var(--danger); }
  .rpe-cinema .session-stat-val .unit{ font-size:10px; font-weight:500; color:var(--text-med); }

  .rpe-cinema .session-noresult{
    display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-low); font-style:italic;
    background:var(--surface-hi); border-radius:10px; padding:10px 12px;
  }

  .rpe-cinema .session-actions{ display:flex; justify-content:flex-end; margin-top:auto; padding-top:2px; }

  .rpe-cinema .btn-c{ display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:650; padding:8px 15px; border-radius:9px; cursor:pointer; border:1px solid transparent; transition:filter .2s var(--ease), border-color .2s var(--ease); }
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
    min-width:32px; height:32px; padding:0 8px; display:inline-flex; align-items:center; justify-content:center;
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
    max-width:1024px; margin:0 auto; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
  }
  .rpe-cinema .action-count{ font-size:13px; font-weight:650; color:var(--text-hi); }
  .rpe-cinema .action-buttons{ display:flex; gap:8px; flex-wrap:wrap; }
`
