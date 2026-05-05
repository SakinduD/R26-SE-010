import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  RefreshCw,
  Search,
  ShieldAlert,
  Target,
  UserCircle,
  Users,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsUserBadge from './AnalyticsUserBadge'
import { useAnalyticsIdentity } from './analyticsAuth'

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

const DEMO_DATA = {
  blindSpots: {
    scope: 'user',
    user_id: 'demo-user',
    session_id: null,
    summary: {
      total_count: 2,
      high_count: 1,
      medium_count: 1,
      low_count: 0,
      strongest_blind_spot: {
        skill_area: 'confidence',
        blind_spot_type: 'overestimation',
        severity: 'high',
        self_rating: 92,
        comparison_score: 55,
        comparison_source: 'observed',
        gap: 37,
        confidence: 0.92,
        recommendation: 'Review confidence evidence and set one measurable improvement target.',
      },
    },
    blind_spots: [
      {
        skill_area: 'confidence',
        blind_spot_type: 'overestimation',
        severity: 'high',
        self_rating: 92,
        comparison_score: 55,
        comparison_source: 'observed',
        gap: 37,
        confidence: 0.92,
        recommendation: 'Review confidence evidence and set one measurable improvement target.',
      },
      {
        skill_area: 'empathy',
        blind_spot_type: 'underestimation',
        severity: 'medium',
        self_rating: 64,
        comparison_score: 90,
        comparison_source: 'peer',
        gap: 26,
        confidence: 0.81,
        recommendation: 'Use positive peer evidence to build confidence and maintain this behaviour.',
      },
    ],
  },
  feedbackAnalysis: {
    summary: {
      self_feedback_count: 3,
      peer_feedback_count: 3,
      analyzed_skill_count: 4,
      aligned_count: 2,
      blind_spot_count: 2,
      average_self_rating: 78,
      average_peer_rating: 72,
    },
    items: [
      alignment('confidence', 92, 58, 55, 'self_overestimation', 'high'),
      alignment('empathy', 64, 88, 90, 'self_underestimation', 'medium'),
      alignment('communication_clarity', 78, 74, 76, 'aligned', 'none'),
    ],
  },
}

function alignment(skillArea, selfRating, peerRating, observedScore, alignmentLabel, severity) {
  return {
    skill_area: skillArea,
    self_rating: selfRating,
    peer_rating: peerRating,
    observed_score: observedScore,
    self_peer_gap: selfRating - peerRating,
    self_observed_gap: selfRating - observedScore,
    peer_observed_gap: peerRating - observedScore,
    alignment: alignmentLabel,
    severity,
    recommendation: `${labelFor(skillArea)} feedback should be reviewed with evidence from the session.`,
  }
}

function labelFor(value) {
  return SKILL_LABELS[value] || value?.replaceAll('_', ' ') || 'Unknown'
}

export default function BlindSpotDetail() {
  const params = useParams()
  const {
    userId: connectedUserId,
    userLabel,
    isAuthLoading,
    isAuthenticated,
  } = useAnalyticsIdentity(params.userId)
  const [scope, setScope] = useState(params.sessionId ? 'session' : 'user')
  const [userId, setUserId] = useState(connectedUserId)
  const [sessionId, setSessionId] = useState(params.sessionId || 'demo-session')
  const [data, setData] = useState(DEMO_DATA)
  const [status, setStatus] = useState('demo')
  const [error, setError] = useState('')

  const currentId = scope === 'session' ? sessionId : userId
  const blindSpots = data.blindSpots?.blind_spots || []
  const analysisItems = data.feedbackAnalysis?.items || []
  const strongest = data.blindSpots?.summary?.strongest_blind_spot || blindSpots[0]

  const hasLiveData = useMemo(() => {
    if (status !== 'live') return true
    return Boolean(blindSpots.length || analysisItems.length)
  }, [analysisItems.length, blindSpots.length, status])

  const loadBlindSpots = async (nextScope = scope, nextUserId = userId, nextSessionId = sessionId) => {
    const targetId = nextScope === 'session' ? nextSessionId.trim() : nextUserId.trim()

    if (!targetId) {
      setError(`Enter a ${nextScope} id`)
      return
    }

    setStatus('loading')
    setError('')

    try {
      const [blindSpotResult, analysisResult] =
        nextScope === 'session'
          ? await Promise.all([
              analyticsService.getBlindSpotsBySession(targetId),
              analyticsService.getFeedbackAnalysisBySession(targetId),
            ])
          : await Promise.all([
              analyticsService.getBlindSpotsByUser(targetId),
              analyticsService.getFeedbackAnalysisByUser(targetId),
            ])

      setData({ blindSpots: blindSpotResult, feedbackAnalysis: analysisResult })
      setStatus('live')
    } catch (err) {
      setData(DEMO_DATA)
      setStatus('demo')
      setError('Backend blind spot data unavailable. Showing demo analysis.')
    }
  }

  useEffect(() => {
    if (scope === 'user') {
      setUserId(connectedUserId)
    }
  }, [connectedUserId, scope])

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated && connectedUserId && scope === 'user') {
      loadBlindSpots('user', connectedUserId, sessionId)
    }
  }, [connectedUserId, isAuthLoading, isAuthenticated, scope])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Feedback System & Predictive Analytics</p>
            <h1 className="mt-1 text-2xl font-semibold">Blind Spot Detection</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SelectInput
              label="Scope"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'user', label: 'User' },
                { value: 'session', label: 'Session' },
              ]}
            />
            {scope === 'session' ? (
              <Input label="Session" value={sessionId} onChange={setSessionId} />
            ) : (
              <Input label="User" value={userId} onChange={setUserId} />
            )}
            <Button className="h-10 self-end" onClick={() => loadBlindSpots()}>
              {status === 'loading' ? <RefreshCw className="animate-spin" /> : <Search />}
              Load
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl space-y-4 px-4 py-5 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          <AnalyticsUserBadge isAuthenticated={isAuthenticated} userLabel={userLabel} />
          {error ? <span className="text-sm text-warning">{error}</span> : null}
        </div>

        {!hasLiveData ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            Live API is connected, but no blind spot records were found for this {scope}.
          </div>
        ) : null}

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_520px]">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {scope === 'session' ? <BarChart3 className="h-4 w-4 text-secondary" /> : <UserCircle className="h-4 w-4 text-secondary" />}
                <span>{currentId}</span>
              </div>
              <h2 className="mt-3 text-xl font-semibold">Self-perception gap analysis</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Blind spots compare self feedback against peer and observed performance evidence to identify overestimation or underestimation.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric icon={ShieldAlert} label="Total" value={data.blindSpots?.summary?.total_count || 0} />
              <Metric icon={AlertTriangle} label="High" value={data.blindSpots?.summary?.high_count || 0} />
              <Metric icon={Target} label="Medium" value={data.blindSpots?.summary?.medium_count || 0} />
              <Metric icon={CheckCircle2} label="Aligned" value={data.feedbackAnalysis?.summary?.aligned_count || 0} />
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
          <Panel title="Strongest Blind Spot" icon={ShieldAlert}>
            {strongest ? <BlindSpotCard item={strongest} featured /> : <EmptyState text="No blind spot detected" />}
          </Panel>

          <Panel title="Feedback Alignment Summary" icon={Users}>
            <AlignmentSummary summary={data.feedbackAnalysis?.summary} />
          </Panel>
        </div>

        <Panel title="Detected Blind Spots" icon={AlertTriangle}>
          <BlindSpotList items={blindSpots} />
        </Panel>

        <Panel title="Self / Peer / Observed Alignment" icon={BarChart3}>
          <AlignmentTable items={analysisItems} />
        </Panel>
      </section>
    </main>
  )
}

function BlindSpotList({ items }) {
  if (!items.length) return <EmptyState text="No blind spots detected" />

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((item) => (
        <BlindSpotCard key={`${item.skill_area}-${item.blind_spot_type}`} item={item} />
      ))}
    </div>
  )
}

function BlindSpotCard({ item, featured = false }) {
  return (
    <div className={`rounded-lg border border-border bg-background/30 p-4 ${featured ? 'min-h-[260px]' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{labelFor(item.skill_area)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{item.blind_spot_type} vs {item.comparison_source}</p>
        </div>
        <SeverityBadge severity={item.severity} />
      </div>

      <div className="mt-4 space-y-3">
        <ScoreBar label="Self rating" value={item.self_rating} />
        <ScoreBar label={`${item.comparison_source} score`} value={item.comparison_score} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <InfoBox label="Gap" value={formatScore(item.gap)} />
        <InfoBox label="Confidence" value={`${Math.round(Number(item.confidence || 0) * 100)}%`} />
      </div>

      <p className="mt-4 text-sm text-muted-foreground">{item.recommendation}</p>
    </div>
  )
}

function AlignmentSummary({ summary }) {
  if (!summary) return <EmptyState text="No feedback analysis summary yet" />

  return (
    <div className="grid grid-cols-2 gap-2">
      <Metric icon={UserCircle} label="Self Feedback" value={summary.self_feedback_count || 0} compact />
      <Metric icon={Users} label="Peer Feedback" value={summary.peer_feedback_count || 0} compact />
      <Metric icon={Target} label="Self Avg" value={formatScore(summary.average_self_rating)} compact />
      <Metric icon={BarChart3} label="Peer Avg" value={formatScore(summary.average_peer_rating)} compact />
      <Metric icon={CheckCircle2} label="Aligned" value={summary.aligned_count || 0} compact />
      <Metric icon={ShieldAlert} label="Blind Spots" value={summary.blind_spot_count || 0} compact />
    </div>
  )
}

function AlignmentTable({ items }) {
  if (!items.length) return <EmptyState text="No alignment analysis yet" />

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[1.2fr_repeat(4,0.8fr)_1fr] gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Skill</span>
          <span>Self</span>
          <span>Peer</span>
          <span>Observed</span>
          <span>Gap</span>
          <span>Alignment</span>
        </div>
        {items.map((item) => (
          <div key={item.skill_area} className="grid grid-cols-[1.2fr_repeat(4,0.8fr)_1fr] gap-2 border-b border-border px-3 py-3 text-sm last:border-0">
            <span className="font-medium">{labelFor(item.skill_area)}</span>
            <span>{formatScore(item.self_rating)}</span>
            <span>{formatScore(item.peer_rating)}</span>
            <span>{formatScore(item.observed_score)}</span>
            <span>{formatGap(item.self_observed_gap ?? item.self_peer_gap)}</span>
            <span className="truncate text-muted-foreground">{item.alignment}</span>
          </div>
        ))}
      </div>
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

function Metric({ icon: Icon, label, value, compact = false }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <Icon className="mb-2 h-4 w-4 text-secondary" />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${compact ? 'text-base' : 'text-xl'} mt-1 truncate font-semibold`}>{value}</p>
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
  const label = status === 'live' ? 'Live API blind spots' : status === 'loading' ? 'Loading blind spots' : 'Demo blind spots'
  return (
    <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

function SeverityBadge({ severity }) {
  const className =
    severity === 'high'
      ? 'bg-destructive/20 text-destructive'
      : severity === 'medium'
        ? 'bg-warning/20 text-warning'
        : severity === 'none'
          ? 'bg-muted text-muted-foreground'
          : 'bg-success/20 text-success'
  return <span className={`rounded-full px-2 py-1 text-xs ${className}`}>{severity}</span>
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

function formatGap(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  const rounded = Math.round(Number(value))
  return `${rounded > 0 ? '+' : ''}${rounded}`
}
