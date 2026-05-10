import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  RefreshCw,
  ShieldAlert,
  Target,
} from 'lucide-react'
import SkillTwinRadar from '../../components/analytics/SkillTwinRadar'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsNav from './AnalyticsNav'
import AnalyticsSessionSelect from './AnalyticsSessionSelect'
import { loadComponentSessionOptions, selectPreferredComponentSession } from './analyticsIntegrationUtils'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import PageHead from '@/components/ui/PageHead'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

const SKILL_LABELS = {
  vocal_command: 'Vocal Command',
  speech_fluency: 'Speech Fluency',
  presence_engagement: 'Presence & Engagement',
  emotional_intelligence: 'Emotional Intelligence',
  overall: 'Overall',
}

const DEMO_REPORT = {
  session_id: 'demo-session',
  user_id: 'demo-user',
  summary: {
    headline: 'Session completed with focused improvement areas.',
    strengths: ['Vocal Command', 'Speech Fluency'],
    improvement_areas: ['Presence & Engagement', 'Emotional Intelligence'],
    completion_status: 'complete',
  },
  aggregate: {
    scores: { metric_count: 1 },
    feedback: {
      total_count: 4,
      average_rating: 78,
      self_rating_averages: {
        vocal_command: 85,
        speech_fluency: 72,
        presence_engagement: 90,
        emotional_intelligence: 68,
      },
      latest_entries: [
        {
          id: 1,
          feedback_type: 'self',
          skill_area: 'presence_engagement',
          rating: 90,
          sentiment: 'positive',
          comment: 'I felt confident and engaged during the negotiation.',
        },
        {
          id: 2,
          feedback_type: 'system',
          skill_area: 'presence_engagement',
          rating: 56,
          sentiment: 'neutral',
          comment: 'Observed performance shows eye contact and engagement need work.',
        },
      ],
    },
    predictions: {
      total_count: 1,
      latest_predictions: [
        {
          id: 1,
          predicted_skill: 'presence_engagement',
          current_score: 58,
          predicted_score: 52,
          risk_level: 'high',
          recommendation: 'Practice maintaining eye contact and presence before the next scenario.',
        },
      ],
    },
  },
  skill_scores: {
    overall_score: 76,
    completeness: 0.86,
    skill_scores: {
      vocal_command: 80,
      speech_fluency: 74,
      presence_engagement: 58,
      emotional_intelligence: 82,
    },
  },
  blind_spots: {
    summary: { total_count: 1, high_count: 1, medium_count: 0, low_count: 0 },
    blind_spots: [
      {
        skill_area: 'presence_engagement',
        blind_spot_type: 'overestimation',
        severity: 'high',
        gap: 34,
        recommendation: 'Review Presence & Engagement evidence and set one measurable eye-contact goal.',
      },
    ],
  },
  action_items: [
    {
      priority: 'high',
      skill_area: 'presence_engagement',
      title: 'Review Presence & Engagement blind spot',
      detail: 'Compare self-rating with observed system evidence before the next session.',
    },
    {
      priority: 'medium',
      skill_area: 'emotional_intelligence',
      title: 'Practice Emotional Intelligence',
      detail: 'Use a pause-breathe-answer pattern during difficult role-play prompts.',
    },
  ],
}

const RAW_TO_COMPOSITE = {
  confidence: 'Presence & Engagement',
  eye_contact: 'Presence & Engagement',
  confidence_score: 'Presence & Engagement',
  speech_pace: 'Speech Fluency',
  clarity: 'Speech Fluency',
  communication_clarity: 'Speech Fluency',
  speech_volume: 'Vocal Command',
  professionalism: 'Vocal Command',
  empathy: 'Emotional Intelligence',
  emotional_control: 'Emotional Intelligence',
  listening: 'Emotional Intelligence',
  active_listening: 'Emotional Intelligence',
  adaptability: 'Emotional Intelligence',
}

const PRIORITY_VARIANT = { high: 'danger', medium: 'warning', low: 'success' }

function labelFor(value) {
  return SKILL_LABELS[value] || RAW_TO_COMPOSITE[value] || value?.replaceAll('_', ' ') || 'Unknown'
}

export default function PostSessionReport() {
  const params = useParams()
  const [sessionId, setSessionId] = useState(params.sessionId || '')
  const [sessionOptions, setSessionOptions] = useState([])
  const [report, setReport] = useState(DEMO_REPORT)
  const [status, setStatus] = useState('demo')
  const [error, setError] = useState('')
  const loadedSessionRef = useRef(null)

  const radarScores = useMemo(() => {
    const scores = report.skill_scores?.skill_scores || {}
    return Object.entries(SKILL_LABELS)
      .filter(([key]) => key !== 'overall')
      .map(([key, label]) => ({ key, label, value: scores[key] ?? undefined }))
  }, [report])

  const selfScores = useMemo(() => {
    const selfRatings = report.aggregate?.feedback?.self_rating_averages || {}
    return Object.entries(SKILL_LABELS)
      .filter(([key]) => key !== 'overall')
      .map(([key, label]) => ({ key, label, value: selfRatings[key] ?? undefined }))
  }, [report])

  const overallScore = report.skill_scores?.overall_score ?? null

  const loadReport = async (nextSessionId = sessionId) => {
    const targetSessionId = String(nextSessionId || '').trim()
    if (!targetSessionId) { setError('Select a session before loading the report.'); return }
    setStatus('loading'); setError('')
    try {
      const nextReport = await analyticsService.getPostSessionReport(targetSessionId)
      setReport(nextReport); setStatus('live')
    } catch {
      setReport(DEMO_REPORT); setStatus('demo')
      setError('Backend report unavailable. Showing demo report.')
    }
  }

  useEffect(() => {
    let isActive = true
    async function loadSessions() {
      const options = await loadComponentSessionOptions(analyticsService)
      if (!isActive) return
      setSessionOptions(options)
      if (!params.sessionId && !sessionId) {
        const preferred = selectPreferredComponentSession(options)
        if (preferred) setSessionId(preferred.id)
      }
    }
    loadSessions()
    return () => { isActive = false }
  }, [params.sessionId])

  useEffect(() => {
    if (sessionId && sessionId !== loadedSessionRef.current) {
      loadedSessionRef.current = sessionId
      loadReport(sessionId)
    }
  }, [sessionId])

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="page page-wide">
      <PageHead
        eyebrow="Feedback System & Predictive Analytics"
        title="Post-Session Report"
        sub="Complete performance review synthesised from skill scores, feedback, and predictions."
      />

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 20 }}>
        <AnalyticsNav />
        <AnalyticsSessionSelect value={sessionId} options={sessionOptions} onChange={setSessionId} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <Button onClick={() => loadReport()} variant="secondary" size="sm" loading={status === 'loading'}>
            {status !== 'loading' && <RefreshCw size={12} strokeWidth={1.8} />}
            Load
          </Button>
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Badge variant="neutral">
          {status === 'live' ? 'Live API report' : status === 'loading' ? 'Loading…' : 'Demo report'}
        </Badge>
        {error && <span className="t-cap" style={{ color: 'var(--warning)' }}>{error}</span>}
      </motion.div>

      <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <FileText size={13} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} />
                <span className="t-cap">
                  {sessionOptions.find((o) => o.id === sessionId)?.label || (status === 'live' ? 'Session Report' : 'Demo Report')}
                </span>
              </div>
              <div className="t-h3" style={{ maxWidth: 520 }}>{report.summary?.headline}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, minWidth: 240 }}>
              <MetricBox label="Overall" value={formatScore(overallScore)} />
              <MetricBox label="Feedback" value={report.aggregate?.feedback?.total_count || 0} />
              <MetricBox label="Actions" value={report.action_items?.length || 0} />
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        <Panel title="Skill Twin" icon={Target}>
          <SkillTwinRadar scores={radarScores} selfScores={selfScores} overallScore={overallScore} />
        </Panel>
        <Panel title="Report Summary" icon={CheckCircle2}>
          <SummaryList title="Strengths" items={report.summary?.strengths || []} emptyText="No strengths detected yet" />
          <div style={{ marginTop: 16 }}>
            <SummaryList title="Improvement Areas" items={report.summary?.improvement_areas || []} emptyText="No improvement areas detected yet" />
          </div>
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2" style={{ marginBottom: 16 }}>
        <Panel title="Action Plan" icon={ClipboardList}>
          <ActionList actions={report.action_items || []} />
        </Panel>
        <Panel title="Blind Spots" icon={ShieldAlert}>
          <BlindSpotList blindSpots={report.blind_spots?.blind_spots || []} />
        </Panel>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-2">
        <Panel title="Feedback Evidence" icon={FileText}>
          <FeedbackList entries={report.aggregate?.feedback?.latest_entries || []} />
        </Panel>
        <Panel title="Prediction Evidence" icon={AlertTriangle}>
          <PredictionList predictions={report.computed_predictions?.length ? report.computed_predictions : (report.aggregate?.predictions?.latest_predictions || [])} />
        </Panel>
      </motion.div>
    </motion.div>
  )
}

function SummaryList({ title, items, emptyText }) {
  return (
    <div>
      <div className="t-cap" style={{ fontWeight: 500, marginBottom: 10 }}>{title}</div>
      {items.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {items.map((item) => (
            <Badge key={item} variant="neutral">{item}</Badge>
          ))}
        </div>
      ) : (
        <EmptyMsg text={emptyText} />
      )}
    </div>
  )
}

function ActionList({ actions }) {
  if (!actions.length) return <EmptyMsg text="No action items yet" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {actions.map((item, index) => (
        <div key={`${item.title}-${index}`} style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{item.title}</span>
            <Badge variant={PRIORITY_VARIANT[item.priority] ?? 'neutral'}>{item.priority}</Badge>
          </div>
          <p className="t-cap" style={{ lineHeight: 1.55 }}>{item.detail}</p>
        </div>
      ))}
    </div>
  )
}

function BlindSpotList({ blindSpots }) {
  if (!blindSpots.length) return <EmptyMsg text="No blind spots detected" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {blindSpots.map((item) => (
        <div key={item.skill_area} style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{labelFor(item.skill_area)}</span>
            <Badge variant={PRIORITY_VARIANT[item.severity] ?? 'neutral'}>{item.severity}</Badge>
          </div>
          <p className="t-cap" style={{ marginBottom: 4 }}>{item.blind_spot_type} gap of {formatScore(item.gap)}</p>
          <p className="t-cap" style={{ lineHeight: 1.55 }}>{item.recommendation}</p>
        </div>
      ))}
    </div>
  )
}

function FeedbackList({ entries }) {
  if (!entries.length) return <EmptyMsg text="No feedback entries yet" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((item) => (
        <div key={item.id} style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{labelFor(item.skill_area || item.feedback_type)}</span>
            <Badge variant="neutral">{item.feedback_type}</Badge>
          </div>
          <p className="t-cap" style={{ marginBottom: 4, lineHeight: 1.55 }}>{item.comment || 'No comment provided'}</p>
          <p className="t-cap">Rating {formatScore(item.rating)}</p>
        </div>
      ))}
    </div>
  )
}

function PredictionList({ predictions }) {
  if (!predictions.length) return <EmptyMsg text="No prediction evidence yet" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {predictions.map((item) => (
        <div key={item.id || item.predicted_skill} style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{labelFor(item.predicted_skill)}</span>
            <Badge variant={PRIORITY_VARIANT[item.risk_level] ?? 'neutral'}>{item.risk_level}</Badge>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
            <span className="t-cap">Current {formatScore(item.current_score)}</span>
            <span className="t-cap">Next {formatScore(item.predicted_score)}</span>
          </div>
          <p className="t-cap" style={{ lineHeight: 1.55 }}>{item.recommendation}</p>
        </div>
      ))}
    </div>
  )
}

function MetricBox({ label, value }) {
  return (
    <div style={{ padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border-subtle)', background: 'var(--bg-input)' }}>
      <div className="t-cap">{label}</div>
      <div className="fg" style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{value}</div>
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

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return Math.round(Number(value))
}
