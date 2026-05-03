import React, { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  CheckCircle2,
  LineChart,
  RefreshCw,
  Search,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import ProgressTrendVisualization from '../../components/analytics/ProgressTrendVisualization'
import { Button } from '../../components/ui/Button'
import { analyticsService } from '../../services/analytics/analyticsService'

const SKILL_LABELS = {
  confidence: 'Confidence',
  communication_clarity: 'Communication Clarity',
  empathy: 'Empathy',
  active_listening: 'Active Listening',
  adaptability: 'Adaptability',
  emotional_control: 'Emotional Control',
  professionalism: 'Professionalism',
  overall: 'Overall',
}

const SKILL_OPTIONS = Object.entries(SKILL_LABELS).map(([value, label]) => ({ value, label }))

const DEMO_DATA = {
  user_id: 'demo-user',
  summary: {
    analyzed_skill_count: 8,
    improving_count: 3,
    stable_count: 2,
    declining_count: 1,
    insufficient_data_count: 2,
    strongest_improvement: trend('confidence', 'improving', [55, 65, 78]),
    strongest_decline: trend('empathy', 'declining', [90, 82, 70]),
  },
  trends: [
    trend('confidence', 'improving', [55, 65, 78]),
    trend('communication_clarity', 'stable', [72, 73, 74]),
    trend('empathy', 'declining', [90, 82, 70]),
    trend('active_listening', 'improving', [66, 72, 79]),
    trend('professionalism', 'improving', [70, 75, 80]),
  ],
  trend_version: 'rule-based-v1',
}

function trend(skillArea, trendLabel, scores) {
  return {
    skill_area: skillArea,
    trend_label: trendLabel,
    first_score: scores[0],
    latest_score: scores[scores.length - 1],
    delta: scores[scores.length - 1] - scores[0],
    slope: scores.length > 1 ? (scores[scores.length - 1] - scores[0]) / (scores.length - 1) : 0,
    session_count: scores.length,
    recommendation: `${labelFor(skillArea)} trend should be reviewed before the next training plan.`,
    points: scores.map((score, index) => ({
      session_id: `S${index + 1}`,
      score,
      created_at: `2026-05-${String(index + 1).padStart(2, '0')}T00:00:00`,
    })),
  }
}

function labelFor(value) {
  return SKILL_LABELS[value] || value?.replaceAll('_', ' ') || 'Unknown'
}

export default function ProgressTrendsDetail() {
  const params = useParams()
  const [userId, setUserId] = useState(params.userId || 'demo-user')
  const [selectedSkill, setSelectedSkill] = useState('overall')
  const [data, setData] = useState(DEMO_DATA)
  const [selectedTrend, setSelectedTrend] = useState(DEMO_DATA.trends[0])
  const [status, setStatus] = useState('demo')
  const [error, setError] = useState('')

  const sortedTrends = useMemo(
    () => [...(data.trends || [])].sort((a, b) => Math.abs(Number(b.delta || 0)) - Math.abs(Number(a.delta || 0))),
    [data.trends]
  )

  const hasLiveData = status !== 'live' || Boolean(data.trends?.some((item) => item.points?.length > 1))

  const loadTrends = async () => {
    if (!userId.trim()) {
      setError('Enter a user id')
      return
    }

    setStatus('loading')
    setError('')

    try {
      const [trendResult, skillResult] = await Promise.all([
        analyticsService.getProgressTrendsByUser(userId.trim()),
        analyticsService.getProgressTrendBySkill(userId.trim(), selectedSkill),
      ])
      setData(trendResult)
      setSelectedTrend(skillResult)
      setStatus('live')
    } catch (err) {
      setData(DEMO_DATA)
      setSelectedTrend(DEMO_DATA.trends.find((item) => item.skill_area === selectedSkill) || DEMO_DATA.trends[0])
      setStatus('demo')
      setError('Backend trend data unavailable. Showing demo progress trends.')
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Feedback System & Predictive Analytics</p>
            <h1 className="mt-1 text-2xl font-semibold">Progress Trends</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input label="User" value={userId} onChange={setUserId} />
            <SelectInput label="Skill" value={selectedSkill} onChange={setSelectedSkill} options={SKILL_OPTIONS} />
            <Button className="h-10 self-end" onClick={loadTrends}>
              {status === 'loading' ? <RefreshCw className="animate-spin" /> : <Search />}
              Load
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl space-y-4 px-4 py-5 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          <span className="text-xs text-muted-foreground">{data.trend_version || 'rule-based-v1'}</span>
          {error ? <span className="text-sm text-warning">{error}</span> : null}
        </div>

        {!hasLiveData ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            Live API is connected, but no progress trend history was found for this user.
          </div>
        ) : null}

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_520px]">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LineChart className="h-4 w-4 text-secondary" />
                <span>{data.user_id || userId}</span>
              </div>
              <h2 className="mt-3 text-xl font-semibold">Longitudinal skill progress</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Trend analysis compares session scores over time to identify improving, stable, declining, and insufficient-data skills.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric icon={Target} label="Analyzed" value={data.summary?.analyzed_skill_count || 0} />
              <Metric icon={TrendingUp} label="Improving" value={data.summary?.improving_count || 0} />
              <Metric icon={CheckCircle2} label="Stable" value={data.summary?.stable_count || 0} />
              <Metric icon={TrendingDown} label="Declining" value={data.summary?.declining_count || 0} />
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <Panel title="Trend Visualization" icon={LineChart}>
            <ProgressTrendVisualization trends={data.trends || []} labelFor={labelFor} />
          </Panel>

          <Panel title="Selected Skill" icon={Activity}>
            <SelectedTrendCard item={selectedTrend} selectedSkill={selectedSkill} />
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Strongest Improvement" icon={TrendingUp}>
            <TrendHighlight item={data.summary?.strongest_improvement} emptyText="No strongest improvement yet" />
          </Panel>

          <Panel title="Strongest Decline" icon={TrendingDown}>
            <TrendHighlight item={data.summary?.strongest_decline} emptyText="No strongest decline yet" />
          </Panel>
        </div>

        <Panel title="Trend Details" icon={BarChart3}>
          <TrendTable trends={sortedTrends} />
        </Panel>
      </section>
    </main>
  )
}

function SelectedTrendCard({ item, selectedSkill }) {
  if (!item) return <EmptyState text={`No trend loaded for ${labelFor(selectedSkill)}`} />

  return (
    <div className="rounded-lg border border-border bg-background/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{labelFor(item.skill_area || selectedSkill)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{item.session_count || item.points?.length || 0} sessions</p>
        </div>
        <TrendBadge label={item.trend_label} />
      </div>
      <ScoreMovement first={item.first_score} latest={item.latest_score} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <InfoBox label="Delta" value={formatDelta(item.delta)} />
        <InfoBox label="Slope" value={formatDelta(item.slope)} />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{item.recommendation}</p>
    </div>
  )
}

function TrendHighlight({ item, emptyText }) {
  if (!item) return <EmptyState text={emptyText} />
  return <SelectedTrendCard item={item} selectedSkill={item.skill_area} />
}

function TrendTable({ trends }) {
  if (!trends.length) return <EmptyState text="No trend details yet" />

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="min-w-[820px]">
        <div className="grid grid-cols-[1.2fr_repeat(5,0.8fr)_1.4fr] gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Skill</span>
          <span>Trend</span>
          <span>First</span>
          <span>Latest</span>
          <span>Delta</span>
          <span>Sessions</span>
          <span>Recommendation</span>
        </div>
        {trends.map((item) => (
          <div key={item.skill_area} className="grid grid-cols-[1.2fr_repeat(5,0.8fr)_1.4fr] gap-2 border-b border-border px-3 py-3 text-sm last:border-0">
            <span className="font-medium">{labelFor(item.skill_area)}</span>
            <span className="text-muted-foreground">{item.trend_label}</span>
            <span>{formatScore(item.first_score)}</span>
            <span>{formatScore(item.latest_score)}</span>
            <span>{formatDelta(item.delta)}</span>
            <span>{item.session_count || item.points?.length || 0}</span>
            <span className="truncate text-muted-foreground">{item.recommendation}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScoreMovement({ first, latest }) {
  return (
    <div className="mt-4 space-y-3">
      <ScoreBar label="First" value={first} />
      <ScoreBar label="Latest" value={latest} />
    </div>
  )
}

function ScoreBar({ label, value }) {
  const score = normalizeScore(value)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{formatScore(score)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div className="h-2 rounded-full bg-secondary" style={{ width: `${score || 0}%` }} />
      </div>
    </div>
  )
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <Icon className="mb-2 h-4 w-4 text-secondary" />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold">{value}</p>
    </div>
  )
}

function InfoBox({ label, value }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  )
}

function Panel({ title, icon: Icon, children }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-secondary" />
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Input({ label, value, onChange }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function SelectInput({ label, value, onChange, options }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function StatusPill({ status }) {
  const label = status === 'live' ? 'Live API trends' : status === 'loading' ? 'Loading trends' : 'Demo trends'
  return (
    <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

function TrendBadge({ label }) {
  const Icon = label === 'improving' ? TrendingUp : label === 'declining' ? TrendingDown : Activity
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" />
      {label || 'N/A'}
    </span>
  )
}

function EmptyState({ text }) {
  return <div className="rounded-md border border-dashed border-border p-5 text-center text-sm text-muted-foreground">{text}</div>
}

function normalizeScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null
  return Math.max(0, Math.min(100, Math.round(Number(value))))
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return Math.round(Number(value))
}

function formatDelta(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  const rounded = Math.round(Number(value) * 100) / 100
  return `${rounded > 0 ? '+' : ''}${rounded}`
}
