import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  Save,
  Star,
  ShieldCheck,
  User,
  Layout,
  Activity,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { analyticsService } from '../../services/analytics/analyticsService'
import AnalyticsNav from './AnalyticsNav'
import { useAnalyticsIdentity } from './analyticsAuth'
import {
  normalizeComponentSessionOptions,
  optionalRequest,
  selectPreferredComponentSession,
} from './analyticsIntegrationUtils'

const SKILL_OPTIONS = [
  { value: 'vocal_command', label: 'Vocal Command', sub: 'Speech Volume' },
  { value: 'speech_fluency', label: 'Speech Fluency', sub: 'Pace & Clarity' },
  { value: 'presence_engagement', label: 'Presence & Engagement', sub: 'Eye Contact & Confidence' },
  { value: 'emotional_intelligence', label: 'Emotional Intelligence', sub: 'Empathy & Control' },
]

export default function FeedbackForm() {
  const params = useParams()
  const navigate = useNavigate()
  const {
    userId: connectedUserId,
    userLabel,
    isAuthenticated,
  } = useAnalyticsIdentity(null, 'user-123')

  const [form, setForm] = useState({
    user_id: connectedUserId,
    session_id: params.sessionId || '',
    ratings: {
      vocal_command: 75,
      speech_fluency: 75,
      presence_engagement: 75,
      emotional_intelligence: 75,
    },
    sentiment: 'neutral',
    comment: '',
  })

  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [sessionOptions, setSessionOptions] = useState([])
  const [sessionStatus, setSessionStatus] = useState('loading')

  const avgRating = useMemo(() => {
    const vals = Object.values(form.ratings)
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
  }, [form.ratings])

  const canSubmit = useMemo(
    () => form.user_id.trim() && form.session_id.trim(),
    [form]
  )

  const updateRating = (skill, value) => {
    setForm(prev => ({
      ...prev,
      ratings: { ...prev.ratings, [skill]: Number(value) }
    }))
    setMessage('')
  }

  const submitFeedback = async (event) => {
    event.preventDefault()
    if (!canSubmit) {
      setMessage('Session ID is required.')
      return
    }

    setStatus('saving')
    setMessage('')

    try {
      const promises = Object.entries(form.ratings).map(([skill, val]) => {
        return analyticsService.createFeedbackEntry({
          user_id: form.user_id.trim(),
          session_id: form.session_id.trim(),
          feedback_type: 'self',
          skill_area: skill,
          rating: val,
          sentiment: form.sentiment,
          comment: skill === 'vocal_command' ? form.comment : null
        })
      })

      await Promise.all(promises)
      setStatus('success')
      setMessage('Self-evaluation completed!')
      if (params.sessionId) {
        setTimeout(() => navigate('/analytics-dashboard'), 2000)
      }
    } catch (error) {
      setStatus('error')
      setMessage('Error saving feedback.')
    }
  }

  useEffect(() => {
    setForm((current) => ({ ...current, user_id: connectedUserId }))
  }, [connectedUserId])

  useEffect(() => {
    let cancelled = false
    const loadCompletedSessions = async () => {
      setSessionStatus('loading')
      const [rpeSessions, mcaSessions] = await Promise.all([
        optionalRequest(() => analyticsService.getComponentRpeSessions()),
        optionalRequest(() => analyticsService.getComponentMcaSessions()),
      ])
      if (cancelled) return
      const options = normalizeComponentSessionOptions(rpeSessions.data, mcaSessions.data)
      const preferred = selectPreferredComponentSession(options)
      setSessionOptions(options)
      setSessionStatus(options.length ? 'ready' : 'empty')

      setForm((current) => {
        if (params.sessionId) return { ...current, session_id: params.sessionId }
        if (preferred) return { ...current, session_id: preferred.id }
        return current
      })
    }
    loadCompletedSessions().catch(() => { if (!cancelled) setSessionStatus('error') })
    return () => { cancelled = true }
  }, [params.sessionId])

  return (
    <main className="min-h-screen bg-background text-foreground pb-12">
      <section className="border-b border-border bg-card/60 sticky top-0 z-10 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-indigo-500 mb-1">Post-Session Evaluation</p>
          <h1 className="text-2xl font-black text-white">Self-Reflection Form</h1>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
        
        {/* Left Side: The Form */}
        <form onSubmit={submitFeedback} className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-indigo-500/10 p-2 rounded-lg">
                <ShieldCheck className="h-5 w-5 text-indigo-500" />
              </div>
              <div>
                <h2 className="font-bold">Session Verification</h2>
                <p className="text-xs text-muted-foreground">This form is compulsory to finalize your analytics</p>
              </div>
            </div>

            <label className="grid gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-tight">Active Session ID</span>
              <div className="h-12 flex items-center px-4 rounded-xl border border-border bg-background text-sm font-medium text-slate-300">
                {form.session_id || 'Waiting for session...'}
              </div>
            </label>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="font-bold mb-1 flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
              Rate Your Performance
            </h3>
            <p className="text-xs text-muted-foreground mb-8">How do you feel you performed in each area? (0-100)</p>

            <div className="space-y-10">
              {SKILL_OPTIONS.map((skill) => (
                <div key={skill.value}>
                  <div className="flex justify-between items-end mb-3">
                    <div>
                      <span className="text-sm font-bold block text-slate-100">{skill.label}</span>
                      <span className="text-[10px] text-slate-500 italic">{skill.sub}</span>
                    </div>
                    <span className="bg-indigo-600 text-white px-3 py-1 rounded-full text-sm font-bold ring-1 ring-indigo-400">
                      {form.ratings[skill.value]}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={form.ratings[skill.value]}
                    onChange={(e) => updateRating(skill.value, e.target.value)}
                    className="w-full h-2 bg-slate-700 rounded-full cursor-pointer accent-indigo-500 appearance-none [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-700 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-400 [&::-webkit-slider-thumb]:mt-[-4px]"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Star className="h-4 w-4 text-indigo-500" />
              Overall Sentiment
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                { val: 'positive', label: 'Positive', emoji: '😊', color: 'bg-green-500/10 border-green-500/20 text-green-500' },
                { val: 'neutral', label: 'Neutral', emoji: '😐', color: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500' },
                { val: 'negative', label: 'Negative', emoji: '☹️', color: 'bg-red-500/10 border-red-500/20 text-red-500' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setForm(p => ({ ...p, sentiment: opt.val }))}
                  className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-all ${
                    form.sentiment === opt.val ? opt.color + ' ring-2 ring-current' : 'border-border bg-background/40 hover:bg-background'
                  }`}
                >
                  <span className="text-2xl">{opt.emoji}</span>
                  <span className="text-[10px] font-bold uppercase">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="font-bold mb-4 flex items-center gap-2 text-slate-100">
              <MessageSquare className="h-4 w-4 text-indigo-400" />
              Additional Observations
            </h3>
            <textarea
              className="w-full min-h-[120px] rounded-xl border border-border bg-background p-4 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all"
              placeholder="What specific moment in the session made you feel this way? (Optional)"
              value={form.comment}
              onChange={(e) => setForm(prev => ({ ...prev, comment: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-4 items-center">
             <StatusMessage status={status} message={message} />
             <Button 
               type="submit" 
               className="px-8 h-11 text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-500/20"
               disabled={!canSubmit || status === 'saving'}
             >
                {status === 'saving' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Complete Evaluation
             </Button>
          </div>
        </form>

        {/* Right Side: Current Entry Preview */}
        <aside className="hidden lg:block sticky top-28 h-fit">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-6 text-indigo-400">
              <Star className="h-4 w-4" />
              <h2 className="font-bold text-sm tracking-tight uppercase">Current Entry</h2>
            </div>
            
            <div className="divide-y divide-border text-sm">
              <PreviewItem icon={<User className="h-3 w-3" />} label="User" value={userLabel || connectedUserId} />
              <PreviewItem icon={<Layout className="h-3 w-3" />} label="Session" value={form.session_id} isMono />
              <PreviewItem icon={<Activity className="h-3 w-3" />} label="Type" value="Self reflection" />
              <PreviewItem icon={<Star className="h-3 w-3" />} label="Skills" value="4 Real Skills" />
              <PreviewItem icon={<CheckCircle2 className="h-3 w-3" />} label="Avg Rating" value={avgRating} isHighlight />
              <PreviewItem icon={<MessageSquare className="h-3 w-3" />} label="Sentiment" value={form.sentiment} isCapitalized />
            </div>

            <div className="mt-6 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
              <p className="text-[10px] text-indigo-400 font-medium leading-relaxed">
                Confirm your ratings before submitting. Your self-reflection will be compared with AI-observed metrics to detect blind spots.
              </p>
            </div>
          </div>
        </aside>

      </div>
    </main>
  )
}

function PreviewItem({ icon, label, value, isMono, isHighlight, isCapitalized }) {
  return (
    <div className="flex items-center justify-between py-3 gap-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className={`text-xs font-bold truncate max-w-[180px] ${isMono ? 'font-mono bg-muted px-1.5 py-0.5 rounded' : ''} ${isHighlight ? 'text-indigo-400' : 'text-slate-200'} ${isCapitalized ? 'capitalize' : ''}`}>
        {value || 'N/A'}
      </span>
    </div>
  )
}

function StatusMessage({ status, message }) {
  if (!message) return null
  const colors = {
    success: 'bg-green-500/10 text-green-500 border-green-500/20',
    error: 'bg-red-500/10 text-red-500 border-red-500/20',
    saving: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  }
  return (
    <div className={`px-4 py-3 rounded-xl border text-sm font-medium flex items-center gap-2 ${colors[status]}`}>
      {message}
    </div>
  )
}
