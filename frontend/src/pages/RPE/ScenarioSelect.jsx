import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, RefreshCw, Sparkles, ChevronDown, ChevronUp, Brain } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { useAuth } from '@/lib/auth/context'
import ScenarioCard from '@/components/RPE/ScenarioCard'
import ScenarioDetailModal from '@/components/RPE/ScenarioDetailModal'
import PageHead from '@/components/ui/PageHead'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Banner from '@/components/ui/Banner'
import EmptyState from '@/components/ui/EmptyState'
import SegmentedControl from '@/components/ui/SegmentedControl'
import ChipToggle from '@/components/ui/ChipToggle'

const DIFFICULTY_FILTERS = ['all', 'beginner', 'intermediate', 'advanced']

// REDESIGN: replaced hardcoded light-mode chips (bg-emerald-100/amber-100/red-100)
// with semantic Badge variants
const DIFFICULTY_BADGE = {
  beginner:     'success',
  intermediate: 'warning',
  advanced:     'danger',
}

const MAX_SKILL_PILLS = 8

export default function ScenarioSelect() {
  const navigate = useNavigate()
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()

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
        setError(err.message || 'Failed to load scenarios')
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

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
      setError(err.message || 'Failed to filter scenarios')
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
      setError(err.message || 'Failed to filter by skill')
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
      setError(err.message || 'Failed to start session')
      setStartingId(null)
    }
  }

  const isFiltered = activeFilter !== 'all' || !!activeSkillFilter

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-canvas)' }}>

      {/* REDESIGN: hero replaced with PageHead component pattern */}
      <div style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '40px 16px' }}>
          <PageHead
            eyebrow="Practice"
            title="Role-Play Scenarios"
            sub="Practice workplace soft skills with AI-powered simulations"
            right={<Badge variant="neutral">{allScenarios.length} scenarios</Badge>}
          />

          {/* REDESIGN: APA pill now uses Badge accent */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Badge variant="accent">
              <Sparkles size={11} strokeWidth={1.8} />
              <span>Personalised ordering coming soon</span>
            </Badge>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* REDESIGN: guest banner replaced amber-50/200/700 hardcoded colors with semantic Banner */}
        {!authLoading && !isAuthenticated && (
          <Banner variant="warning">
            <span>
              You are browsing as a guest.{' '}
              <a href="/signin" style={{ color: 'var(--warning)', fontWeight: 600, textDecoration: 'underline' }}>
                Sign in
              </a>{' '}
              to save your session history.
            </span>
          </Banner>
        )}

        {/* REDESIGN: difficulty filter switched from primary-tinted pills to SegmentedControl */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
          <SegmentedControl
            value={!activeSkillFilter ? activeFilter : 'all'}
            onChange={(v) => handleDifficultyFilter(v)}
            options={DIFFICULTY_FILTERS.map((d) => ({
              label: d === 'all' ? 'All' : d.charAt(0).toUpperCase() + d.slice(1),
              value: d,
            }))}
          />

          {/* REDESIGN: select restyled to use .input class */}
          <select
            value={activeSortMode}
            onChange={(e) => setActiveSortMode(e.target.value)}
            className="input"
            style={{ width: 'auto', height: 36, paddingRight: 28 }}
          >
            <option value="default">Sort: Default</option>
            <option value="difficulty">Sort: By Difficulty</option>
            <option value="recommended">Sort: Recommended</option>
          </select>
        </div>

        {/* REDESIGN: skill filter row uses ChipToggle */}
        {allSkills.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="t-over" style={{ flexShrink: 0 }}>Filter by skill:</span>
            {visibleSkills.map((skill) => (
              <ChipToggle
                key={skill}
                active={activeSkillFilter === skill}
                onClick={() => handleSkillFilter(skill)}
              >
                <span style={{ textTransform: 'capitalize' }}>{skill.replace(/_/g, ' ')}</span>
              </ChipToggle>
            ))}
            {allSkills.length > MAX_SKILL_PILLS && (
              <button
                type="button"
                onClick={() => setShowAllSkills((v) => !v)}
                className="t-cap"
                style={{ background: 'transparent', border: 0, color: 'var(--accent)', cursor: 'pointer', fontWeight: 500 }}
              >
                {showAllSkills ? 'Less' : `+${allSkills.length - MAX_SKILL_PILLS} more`}
              </button>
            )}
          </div>
        )}

        {/* REDESIGN: active-filter summary chips converted to Badge accent */}
        {isFiltered && !isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="t-cap">
              Showing {displayedScenarios.length} of {allScenarios.length} scenarios
            </span>
            {activeFilter !== 'all' && (
              <button
                type="button"
                onClick={() => handleDifficultyFilter('all')}
                style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
              >
                <Badge variant="accent">
                  <span style={{ textTransform: 'capitalize' }}>Difficulty: {activeFilter} ×</span>
                </Badge>
              </button>
            )}
            {activeSkillFilter && (
              <button
                type="button"
                onClick={() => handleSkillFilter(activeSkillFilter)}
                style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
              >
                <Badge variant="accent">
                  <span style={{ textTransform: 'capitalize' }}>Skill: {activeSkillFilter.replace(/_/g, ' ')} ×</span>
                </Badge>
              </button>
            )}
          </div>
        )}

        {/* REDESIGN: error block replaced with Banner danger + retry button */}
        {error && (
          <Banner variant="danger">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
              <AlertCircle size={16} strokeWidth={1.8} style={{ flexShrink: 0, color: 'var(--danger)' }} />
              <span style={{ flex: 1 }}>{error}</span>
              <button
                type="button"
                onClick={() => handleDifficultyFilter(activeFilter)}
                className="btn btn-ghost btn-sm"
              >
                <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <RefreshCw size={12} strokeWidth={1.8} /> Retry
                </span>
              </button>
            </div>
          </Banner>
        )}

        {/* REDESIGN: skeleton uses .skel class instead of animate-pulse divs */}
        {isLoading && (
          <div className="grid-3">
            {[1, 2, 3].map((n) => (
              <Card key={n}>
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
              </Card>
            ))}
          </div>
        )}

        {/* Scenario grid */}
        {!isLoading && (
          <div className="grid-3">
            {displayedScenarios.length === 0 ? (
              <div style={{ gridColumn: '1 / -1' }}>
                {/* REDESIGN: empty grid replaced with EmptyState component */}
                <Card>
                  <EmptyState
                    icon={Brain}
                    title="No scenarios match this filter"
                    description="Try removing one or more filters to see all available scenarios."
                    action={
                      <button
                        type="button"
                        onClick={clearAllFilters}
                        className="btn btn-secondary"
                      >
                        <span className="btn-label">Clear filters</span>
                      </button>
                    }
                  />
                </Card>
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

        {/* REDESIGN: comparison table now wrapped in Card; difficulty pills use Badge */}
        {!isLoading && allScenarios.length > 0 && (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setShowCompare((v) => !v)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 20px',
                background: 'transparent',
                border: 0,
                color: 'var(--text-primary)',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <span>Compare all scenarios</span>
              {showCompare ? (
                <ChevronUp size={16} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} />
              ) : (
                <ChevronDown size={16} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} />
              )}
            </button>
            {showCompare && (
              <div style={{ overflowX: 'auto', borderTop: '1px solid var(--border-subtle)' }}>
                <table style={{ width: '100%', fontSize: 12, textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead style={{ background: 'var(--bg-elevated)' }}>
                    <tr>
                      {['Scenario', 'Difficulty', 'Turns', 'Min Trust', 'NPC Exits At', 'NPC Softens At'].map((h) => (
                        <th
                          key={h}
                          className="t-over"
                          style={{
                            padding: '12px 16px',
                            color: 'var(--text-tertiary)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allScenarios.map((s, i) => {
                      const coop = s.npc_behaviour?.trust_thresholds?.cooperative
                        ?? s.apa_metadata?.npc_behaviour?.trust_thresholds?.cooperative
                        ?? '—'
                      const criteria = s.success_criteria ?? {}
                      return (
                        <tr
                          key={s.scenario_id}
                          style={{ borderTop: i === 0 ? 0 : '1px solid var(--border-subtle)' }}
                        >
                          <td className="fg" style={{ padding: '10px 16px', fontWeight: 500, whiteSpace: 'nowrap' }}>{s.title}</td>
                          <td style={{ padding: '10px 16px' }}>
                            <Badge variant={DIFFICULTY_BADGE[s.difficulty] ?? 'neutral'}>
                              <span style={{ textTransform: 'capitalize' }}>{s.difficulty}</span>
                            </Badge>
                          </td>
                          <td className="score-num" style={{ padding: '10px 16px', color: 'var(--text-tertiary)' }}>{s.turns}</td>
                          <td className="score-num" style={{ padding: '10px 16px', color: 'var(--text-tertiary)' }}>{criteria.min_trust_score ?? '—'}</td>
                          <td className="score-num" style={{ padding: '10px 16px', color: 'var(--text-tertiary)' }}>
                            {s.end_conditions?.failure_escalation_threshold != null
                              ? `${s.end_conditions.failure_escalation_threshold}/5`
                              : '—'}
                          </td>
                          <td style={{ padding: '10px 16px', color: 'var(--text-tertiary)' }}>trust ≥ {coop}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

      </div>

      {/* Detail modal — untouched */}
      <ScenarioDetailModal
        scenario={selectedScenario}
        onClose={() => setSelectedScenario(null)}
        onStart={handleStart}
        isStarting={startingId === selectedScenario?.scenario_id}
      />
    </div>
  )
}
