import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, RefreshCw, Sparkles, ChevronDown, ChevronUp, Brain, History } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { useAuth } from '@/lib/auth/context'
import ScenarioCard from '@/components/RPE/ScenarioCard'
import ScenarioDetailModal from '@/components/RPE/ScenarioDetailModal'
import { cn } from '@/lib/utils'

const DIFFICULTY_FILTERS = ['all', 'beginner', 'intermediate', 'advanced']

const DIFFICULTY_TONE = {
  beginner:     'success',
  intermediate: 'warning',
  advanced:     'danger',
}

const MAX_SKILL_PILLS = 8

export default function ScenarioSelect() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const planId = searchParams.get('planId')
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()

  const [planImporting, setPlanImporting] = useState(!!planId)
  const [planError, setPlanError]         = useState(null)

  const [allScenarios, setAllScenarios]           = useState([])
  const [filteredScenarios, setFilteredScenarios] = useState([])
  const [recommendedOrder, setRecommendedOrder]   = useState([])
  const [activeFilter, setActiveFilter]           = useState('all')
  const [activeSkillFilter, setActiveSkillFilter] = useState(null)
  const [activeSortMode, setActiveSortMode]       = useState('default')
  const [selectedScenario, setSelectedScenario]   = useState(null)
  const [startingId, setStartingId]               = useState(null)
  const [isLoading, setIsLoading]                 = useState(true)
  const [error, setError]                         = useState(null)
  const [showCompare, setShowCompare]             = useState(false)
  const [showAllSkills, setShowAllSkills]         = useState(false)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const [data, recs] = await Promise.all([
          rpeService.getScenarios(),
          rpeService.getApaRecommendations(isAuthenticated && user ? user.id : 'guest').catch(() => []),
        ])
        setAllScenarios(data)
        setFilteredScenarios(data)
        setRecommendedOrder(recs.map((s) => s.scenario_id))
      } catch (err) {
        setError(err.message || "We couldn't load the scenarios right now.")
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  // ?planId=<id> entry point from StartRolePlayButton on the Training Plan
  // detail page — generate a scenario from that plan and drop straight into
  // a live session, no manual picker.
  useEffect(() => {
    if (!planId || authLoading) return
    if (!isAuthenticated) {
      setPlanImporting(false)
      setPlanError('Sign in first to start a role-play from your training plan.')
      return
    }

    let cancelled = false
    const run = async () => {
      setPlanImporting(true)
      setPlanError(null)
      try {
        const response = await rpeService.startSessionFromPlan(planId)
        if (cancelled) return
        navigate('/roleplay/session', {
          replace: true,
          state: {
            sessionId:      response.session_id,
            openingNpcLine: response.opening_npc_line,
            scenarioTitle:  response.scenario_title,
            difficulty:     response.difficulty,
            conflictType:   response.conflict_type,
            totalTurns:     response.total_turns,
            recommendedTurns: response.recommended_turns,
            maxTurns:       response.max_turns,
          },
        })
      } catch (err) {
        if (!cancelled) {
          setPlanError(err.message || "We couldn't create a scenario from this plan.")
          setPlanImporting(false)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [planId, isAuthenticated, authLoading, navigate])

  const allSkills = useMemo(() => {
    const set = new Set()
    allScenarios.forEach((s) => {
      const skills = s.target_skills ?? s.apa_metadata?.target_skills ?? []
      skills.forEach((sk) => set.add(sk))
    })
    return [...set]
  }, [allScenarios])

  const visibleSkills = showAllSkills ? allSkills : allSkills.slice(0, MAX_SKILL_PILLS)

  const applySortMode = (list, mode) => {
    if (mode === 'difficulty') {
      return [...list].sort((a, b) => {
        const wa = a.difficulty_weight ?? a.apa_metadata?.difficulty_weight ?? 1.0
        const wb = b.difficulty_weight ?? b.apa_metadata?.difficulty_weight ?? 1.0
        return wa - wb
      })
    }
    if (mode === 'recommended' && recommendedOrder.length > 0) {
      return [...list].sort((a, b) => {
        const ia = recommendedOrder.indexOf(a.scenario_id)
        const ib = recommendedOrder.indexOf(b.scenario_id)
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
      })
    }
    return list
  }

  const displayedScenarios = useMemo(
    () => applySortMode(filteredScenarios, activeSortMode),
    [filteredScenarios, activeSortMode, recommendedOrder]
  )

  const handleDifficultyFilter = async (level) => {
    setActiveFilter(level)
    setActiveSkillFilter(null)
    setError(null)
    setIsLoading(true)
    try {
      const data = level === 'all'
        ? await rpeService.getScenarios()
        : await rpeService.getScenariosByDifficulty(level)
      setFilteredScenarios(data)
    } catch (err) {
      setError(err.message || "We couldn't apply that filter.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSkillFilter = async (skill) => {
    if (activeSkillFilter === skill) {
      setActiveSkillFilter(null)
      setActiveFilter('all')
      setFilteredScenarios(allScenarios)
      return
    }
    setActiveSkillFilter(skill)
    setActiveFilter('all')
    setError(null)
    setIsLoading(true)
    try {
      const data = await rpeService.getScenariosBySkill(skill)
      setFilteredScenarios(data)
    } catch (err) {
      setError(err.message || "We couldn't filter by that skill.")
    } finally {
      setIsLoading(false)
    }
  }

  const clearAllFilters = () => {
    setActiveFilter('all')
    setActiveSkillFilter(null)
    setFilteredScenarios(allScenarios)
  }

  const handleViewDetail = async (scenario) => {
    setSelectedScenario(scenario)
    try {
      const detail = await rpeService.getScenarioDetail(scenario.scenario_id)
      setSelectedScenario(detail)
    } catch {
      // keep summary-level data already set
    }
  }

  const handleStart = async (scenario) => {
    setStartingId(scenario.scenario_id)
    setError(null)
    try {
      const response = await rpeService.startSession(
        scenario.scenario_id,
        isAuthenticated && user ? user.id : null
      )
      navigate('/roleplay/session', {
        state: {
          sessionId:                   response.session_id,
          openingNpcLine:              response.opening_npc_line,
          scenarioTitle:               response.scenario_title,
          difficulty:                  response.difficulty,
          conflictType:                response.conflict_type,
          totalTurns:                  response.total_turns,
          npcRole:                     scenario.npc_role || scenario.conflict_type,
          failureEscalationThreshold:  scenario.end_conditions?.failure_escalation_threshold,
        },
      })
    } catch (err) {
      setError(err.message || "We couldn't start that session — please try again.")
      setStartingId(null)
    }
  }

  const isFiltered = activeFilter !== 'all' || !!activeSkillFilter

  if (planImporting) {
    return (
      <div className="rpe-cinema">
        <div className="plan-import-screen">
          <div className="plan-import-spinner" />
          <p className="plan-import-title">Building your scenario…</p>
          <p className="plan-import-sub">Turning your training plan into a live scenario.</p>
        </div>
        <style>{`
          .rpe-cinema{ min-height:calc(100vh - 48px); background:#0D1117; color:#F0F6FC;
            font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif; }
          .plan-import-screen{ min-height:calc(100vh - 48px); display:flex; flex-direction:column;
            align-items:center; justify-content:center; gap:16px; text-align:center; padding:24px; }
          .plan-import-spinner{ width:36px; height:36px; border-radius:50%; border:2.5px solid #30363D;
            border-top-color:#4493F8; animation:planImportSpin .8s linear infinite; }
          @keyframes planImportSpin{ to{ transform:rotate(360deg); } }
          .plan-import-title{ font-size:16px; font-weight:700; margin:0; }
          .plan-import-sub{ font-size:13px; color:#8B949E; margin:0; }
        `}</style>
      </div>
    )
  }

  return (
    <div className="rpe-cinema">

      {planError && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <div className="banner danger">
            <AlertCircle size={16} strokeWidth={1.8} />
            <span style={{ flex: 1 }}>{planError}</span>
          </div>
        </div>
      )}

      <div className="hero-band">
        <div className="hero-inner">
          <div className="hero-row">
            <div>
              <p className="eyebrow">Practice</p>
              <h1 className="hero-title">Role-Play Scenarios</h1>
              <p className="hero-sub">Build workplace soft skills through realistic practice conversations</p>
            </div>
            <div className="hero-actions">
              <button type="button" onClick={() => navigate('/roleplay/my-sessions')} className="my-sessions-btn">
                <History size={13} strokeWidth={1.8} /> My Sessions
              </button>
              <span className="pill neutral">{allScenarios.length} scenarios</span>
            </div>
          </div>
          <span className="pill accent" style={{ marginTop: 14 }}>
            <Sparkles size={11} strokeWidth={1.8} />
            Personalised ordering coming soon
          </span>
        </div>
      </div>

      <div className="page">

        {!authLoading && !isAuthenticated && (
          <div className="banner warning">
            You're browsing as a guest —{' '}
            <a href="/signin" className="banner-link">Sign in</a>{' '}
            to save your session history.
          </div>
        )}

        <div className="filter-row">
          <div className="seg-control">
            {DIFFICULTY_FILTERS.map((d) => (
              <button
                key={d}
                type="button"
                className={cn('seg-btn', (!activeSkillFilter ? activeFilter : 'all') === d && 'active')}
                onClick={() => handleDifficultyFilter(d)}
              >
                {d === 'all' ? 'All' : d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

          <select
            value={activeSortMode}
            onChange={(e) => setActiveSortMode(e.target.value)}
            className="sort-select"
          >
            <option value="default">Default order</option>
            <option value="difficulty">By difficulty</option>
            <option value="recommended">Recommended for you</option>
          </select>
        </div>

        {allSkills.length > 0 && (
          <div className="skill-filter-row">
            <span className="micro-label">Filter by skill:</span>
            {visibleSkills.map((skill) => (
              <button
                key={skill}
                type="button"
                className={cn('chip', activeSkillFilter === skill && 'active')}
                onClick={() => handleSkillFilter(skill)}
              >
                {skill.replace(/_/g, ' ')}
              </button>
            ))}
            {allSkills.length > MAX_SKILL_PILLS && (
              <button type="button" onClick={() => setShowAllSkills((v) => !v)} className="more-toggle">
                {showAllSkills ? 'Less' : `+${allSkills.length - MAX_SKILL_PILLS} more`}
              </button>
            )}
          </div>
        )}

        {isFiltered && !isLoading && (
          <div className="active-filters">
            <span className="filter-summary">
              Showing {displayedScenarios.length} of {allScenarios.length} scenarios
            </span>
            {activeFilter !== 'all' && (
              <button type="button" onClick={() => handleDifficultyFilter('all')} className="pill accent clickable">
                Difficulty: {activeFilter} ×
              </button>
            )}
            {activeSkillFilter && (
              <button type="button" onClick={() => handleSkillFilter(activeSkillFilter)} className="pill accent clickable">
                Skill: {activeSkillFilter.replace(/_/g, ' ')} ×
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="banner danger">
            <AlertCircle size={16} strokeWidth={1.8} />
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" onClick={() => handleDifficultyFilter(activeFilter)} className="retry-btn">
              <RefreshCw size={12} strokeWidth={1.8} /> Retry
            </button>
          </div>
        )}

        {isLoading && (
          <div className="grid-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="skel-card">
                <div className="skel" style={{ height: 16, width: '75%', marginBottom: 12 }} />
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <div className="skel" style={{ height: 18, width: 80, borderRadius: 999 }} />
                  <div className="skel" style={{ height: 18, width: 64, borderRadius: 999 }} />
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                  <div className="skel" style={{ height: 18, width: 64, borderRadius: 999 }} />
                  <div className="skel" style={{ height: 18, width: 80, borderRadius: 999 }} />
                </div>
                <div className="skel" style={{ height: 36, width: '100%', borderRadius: 8 }} />
              </div>
            ))}
          </div>
        )}

        {!isLoading && (
          <div className="grid-3">
            {displayedScenarios.length === 0 ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <div className="empty-state">
                  <Brain size={28} strokeWidth={1.6} />
                  <p className="empty-title">No scenarios match this filter</p>
                  <p className="empty-desc">Remove a filter or two to see more scenarios.</p>
                  <button type="button" onClick={clearAllFilters} className="btn-c secondary">Clear filters</button>
                </div>
              </div>
            ) : (
              displayedScenarios.map((scenario) => (
                <ScenarioCard
                  key={scenario.scenario_id}
                  scenario={scenario}
                  onStart={handleStart}
                  onViewDetail={handleViewDetail}
                  isStarting={startingId === scenario.scenario_id}
                />
              ))
            )}
          </div>
        )}

        {!isLoading && allScenarios.length > 0 && (
          <div className="compare-panel">
            <button type="button" onClick={() => setShowCompare((v) => !v)} className="compare-toggle">
              <span>Compare all scenarios</span>
              {showCompare ? <ChevronUp size={16} strokeWidth={1.8} /> : <ChevronDown size={16} strokeWidth={1.8} />}
            </button>
            {showCompare && (
              <div className="compare-table-wrap">
                <table className="compare-table">
                  <thead>
                    <tr>
                      {['Scenario', 'Difficulty', 'Turns', 'Min Trust', 'They Walk Away At', 'They Warm Up At'].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allScenarios.map((s) => {
                      const coop = s.npc_behaviour?.trust_thresholds?.cooperative
                        ?? s.apa_metadata?.npc_behaviour?.trust_thresholds?.cooperative
                        ?? '—'
                      const criteria = s.success_criteria ?? {}
                      return (
                        <tr key={s.scenario_id}>
                          <td className="cmp-title">{s.title}</td>
                          <td><span className={cn('pill', DIFFICULTY_TONE[s.difficulty] ?? 'neutral')}>{s.difficulty}</span></td>
                          <td className="cmp-num">{s.turns}</td>
                          <td className="cmp-num">{criteria.min_trust_score ?? '—'}</td>
                          <td className="cmp-num">
                            {s.end_conditions?.failure_escalation_threshold != null
                              ? `${s.end_conditions.failure_escalation_threshold}/5`
                              : '—'}
                          </td>
                          <td className="cmp-num">trust ≥ {coop}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>

      <ScenarioDetailModal
        scenario={selectedScenario}
        onClose={() => setSelectedScenario(null)}
        onStart={handleStart}
        isStarting={startingId === selectedScenario?.scenario_id}
      />

      <style>{`
        .rpe-cinema{
          --bg:            #0D1117;
          --surface:       #161B22;
          --surface-hi:    #21262D;
          --border:        #30363D;
          --primary:       #4493F8;
          --primary-glow:  rgba(68,147,248,0.15);
          --accent:        #7C3AED;
          --accent-glow:   rgba(124,58,237,0.15);
          --success:       #3FB950;
          --success-glow:  rgba(63,185,80,0.15);
          --warning:       #D29922;
          --warning-glow:  rgba(210,153,34,0.15);
          --danger:        #F85149;
          --danger-glow:   rgba(248,81,73,0.15);
          --text-hi:       #F0F6FC;
          --text-med:      #8B949E;
          --text-low:      #484F58;
          --ease: cubic-bezier(0.22, 1, 0.36, 1);

          min-height:calc(100vh - 48px);
          background:var(--bg);
          color:var(--text-hi);
          font-family:-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        .rpe-cinema button, .rpe-cinema select{ font-family:inherit; }
        .rpe-cinema .cap{ text-transform:capitalize; }

        .rpe-cinema .hero-band{
          border-bottom:1px solid var(--border);
          background:radial-gradient(120% 140% at 0% 0%, rgba(124,58,237,0.08) 0%, transparent 55%), var(--surface);
        }
        .rpe-cinema .hero-inner{ max-width:1280px; margin:0 auto; padding:40px 20px 32px; }
        .rpe-cinema .hero-row{ display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
        .rpe-cinema .hero-actions{ display:flex; align-items:center; gap:10px; }
        .rpe-cinema .my-sessions-btn{
          display:inline-flex; align-items:center; gap:6px; background:var(--surface-hi); border:1px solid var(--border);
          color:var(--text-hi); font-size:12px; font-weight:650; padding:8px 14px; border-radius:9px; cursor:pointer;
          transition:border-color .2s var(--ease), background .2s var(--ease);
        }
        .rpe-cinema .my-sessions-btn:hover{ border-color:var(--primary); background:var(--primary-glow); }
        .rpe-cinema .eyebrow{ font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--primary); margin:0 0 8px; }
        .rpe-cinema .hero-title{ font-size:28px; font-weight:800; letter-spacing:-0.01em; margin:0; }
        .rpe-cinema .hero-sub{ font-size:13.5px; color:var(--text-med); margin:8px 0 0; }

        .rpe-cinema .page{ max-width:1280px; margin:0 auto; padding:28px 20px 64px; display:flex; flex-direction:column; gap:20px; }

        .rpe-cinema .pill{
          display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:650;
          padding:5px 12px; border-radius:100px; border:1px solid transparent; white-space:nowrap;
        }
        .rpe-cinema .pill.success{ color:var(--success); background:var(--success-glow); border-color:rgba(63,185,80,0.3); }
        .rpe-cinema .pill.warning{ color:var(--warning); background:var(--warning-glow); border-color:rgba(210,153,34,0.3); }
        .rpe-cinema .pill.danger{  color:var(--danger);  background:var(--danger-glow);  border-color:rgba(248,81,73,0.3); }
        .rpe-cinema .pill.accent{  color:var(--accent);  background:var(--accent-glow);  border-color:rgba(124,58,237,0.3); text-transform:capitalize; }
        .rpe-cinema .pill.neutral{ color:var(--text-med); background:var(--surface-hi); border-color:var(--border); }
        .rpe-cinema .pill.clickable{ cursor:pointer; }
        .rpe-cinema .pill.clickable:hover{ filter:brightness(1.25); }

        .rpe-cinema .banner{
          display:flex; align-items:center; gap:10px; border-radius:12px; padding:12px 16px; font-size:13px; border:1px solid transparent;
        }
        .rpe-cinema .banner.warning{ background:var(--warning-glow); border-color:rgba(210,153,34,0.3); color:#E3B341; }
        .rpe-cinema .banner.danger{ background:var(--danger-glow); border-color:rgba(248,81,73,0.3); color:#FF9490; }
        .rpe-cinema .banner-link{ color:inherit; font-weight:700; text-decoration:underline; }

        .rpe-cinema .filter-row{ display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; }
        .rpe-cinema .seg-control{ display:inline-flex; background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:3px; gap:2px; }
        .rpe-cinema .seg-btn{
          background:transparent; border:none; cursor:pointer; color:var(--text-med);
          font-size:12.5px; font-weight:600; padding:7px 14px; border-radius:8px; transition:all .2s var(--ease);
        }
        .rpe-cinema .seg-btn:hover{ color:var(--text-hi); }
        .rpe-cinema .seg-btn.active{ background:var(--primary); color:#fff; }

        .rpe-cinema .sort-select{
          background:var(--surface); border:1px solid var(--border); color:var(--text-hi);
          font-size:12.5px; padding:8px 12px; border-radius:9px; cursor:pointer;
        }
        .rpe-cinema .sort-select:focus{ outline:none; border-color:var(--primary); }

        .rpe-cinema .skill-filter-row{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .rpe-cinema .micro-label{ font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-low); flex-shrink:0; }
        .rpe-cinema .chip{
          background:var(--surface); border:1px solid var(--border); color:var(--text-med);
          font-size:12px; font-weight:600; padding:6px 13px; border-radius:100px; cursor:pointer;
          text-transform:capitalize; transition:all .2s var(--ease);
        }
        .rpe-cinema .chip:hover{ border-color:var(--text-med); color:var(--text-hi); }
        .rpe-cinema .chip.active{ background:var(--primary-glow); border-color:rgba(68,147,248,0.5); color:var(--primary); }
        .rpe-cinema .more-toggle{ background:none; border:none; color:var(--accent); font-size:12px; font-weight:600; cursor:pointer; }

        .rpe-cinema .active-filters{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .rpe-cinema .filter-summary{ font-size:12px; color:var(--text-med); }

        .rpe-cinema .retry-btn{
          display:inline-flex; align-items:center; gap:5px; background:none; border:1px solid rgba(248,81,73,0.35);
          color:inherit; font-size:11.5px; font-weight:650; padding:6px 12px; border-radius:8px; cursor:pointer; flex-shrink:0;
        }
        .rpe-cinema .retry-btn:hover{ background:rgba(248,81,73,0.15); }

        .rpe-cinema .grid-3{ display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; }
        @media (max-width:980px){ .rpe-cinema .grid-3{ grid-template-columns:repeat(2, 1fr); } }
        @media (max-width:640px){ .rpe-cinema .grid-3{ grid-template-columns:1fr; } }

        .rpe-cinema .skel-card{ background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px; }
        .rpe-cinema .skel{ background:linear-gradient(90deg, var(--surface-hi) 25%, var(--border) 50%, var(--surface-hi) 75%); background-size:200% 100%; border-radius:6px; animation:cinemaShimmer 1.4s ease-in-out infinite; }
        @keyframes cinemaShimmer{ 0%{ background-position:200% 0; } 100%{ background-position:-200% 0; } }

        .rpe-cinema .empty-state{
          display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px;
          background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:48px 24px; color:var(--text-med);
        }
        .rpe-cinema .empty-title{ font-size:15px; font-weight:700; color:var(--text-hi); margin:6px 0 0; }
        .rpe-cinema .empty-desc{ font-size:13px; margin:0 0 10px; max-width:340px; }

        .rpe-cinema .btn-c{
          display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:650;
          padding:9px 16px; border-radius:10px; cursor:pointer; border:1px solid transparent;
          transition:filter .2s var(--ease), border-color .2s var(--ease), background .2s var(--ease);
        }
        .rpe-cinema .btn-c.secondary{ background:var(--surface-hi); border-color:var(--border); color:var(--text-hi); }
        .rpe-cinema .btn-c.secondary:hover{ border-color:var(--text-med); }

        .rpe-cinema .compare-panel{ background:var(--surface); border:1px solid var(--border); border-radius:14px; overflow:hidden; }
        .rpe-cinema .compare-toggle{
          width:100%; display:flex; align-items:center; justify-content:space-between;
          padding:14px 20px; background:transparent; border:none; color:var(--text-hi);
          font-size:13.5px; font-weight:600; cursor:pointer;
        }
        .rpe-cinema .compare-toggle svg{ color:var(--text-med); }
        .rpe-cinema .compare-table-wrap{ overflow-x:auto; border-top:1px solid var(--border); }
        .rpe-cinema .compare-table{ width:100%; font-size:12px; text-align:left; border-collapse:collapse; }
        .rpe-cinema .compare-table thead{ background:var(--surface-hi); }
        .rpe-cinema .compare-table th{
          padding:12px 16px; color:var(--text-low); font-weight:700; text-transform:uppercase; letter-spacing:.08em; font-size:10px; white-space:nowrap;
        }
        .rpe-cinema .compare-table td{ padding:10px 16px; border-top:1px solid var(--border); color:var(--text-med); }
        .rpe-cinema .cmp-title{ color:var(--text-hi); font-weight:600; white-space:nowrap; }
        .rpe-cinema .cmp-num{ font-variant-numeric:tabular-nums; }
      `}</style>
    </div>
  )
}
