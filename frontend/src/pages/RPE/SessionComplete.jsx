import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, RefreshCw, Home, PlayCircle, BarChart2, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { submitSessionFeedback } from '@/lib/api/pedagogy'
import Card from '@/components/ui/Card'
import StatCard from '@/components/ui/StatCard'
import Badge from '@/components/ui/Badge'

// REDESIGN: emotion chips switched from hardcoded -100/-700 light-mode pairs to Badge variants
const EMOTION_BADGE_VARIANT = {
  calm:       'success',
  assertive:  'accent',
  anxious:    'warning',
  frustrated: 'danger',
  confused:   'neutral',
}

// Map RPE emotion labels → APM turn metric scores (0-1)
const EMOTION_SCORES = {
  assertive:  { assertiveness_score: 0.9, empathy_score: 0.5, clarity_score: 0.8, response_quality: 0.85 },
  calm:       { assertiveness_score: 0.6, empathy_score: 0.7, clarity_score: 0.7, response_quality: 0.70 },
  anxious:    { assertiveness_score: 0.2, empathy_score: 0.4, clarity_score: 0.4, response_quality: 0.30 },
  frustrated: { assertiveness_score: 0.3, empathy_score: 0.2, clarity_score: 0.4, response_quality: 0.30 },
  confused:   { assertiveness_score: 0.3, empathy_score: 0.4, clarity_score: 0.3, response_quality: 0.35 },
}
const DEFAULT_SCORES = { assertiveness_score: 0.5, empathy_score: 0.5, clarity_score: 0.5, response_quality: 0.5 }

async function _sendApmFeedback(data, sessionId, scenarioTitle) {
  try {
    const finalTrust = data.final_trust ?? 50
    const rating = finalTrust >= 70 ? 'good' : finalTrust >= 40 ? 'fair' : 'poor'
    const summary = finalTrust >= 70
      ? 'Strong trust maintained throughout the session.'
      : finalTrust >= 40
      ? 'Moderate trust — focus on clearer assertive communication.'
      : 'Low trust recorded — review de-escalation and emotional regulation strategies.'

    await submitSessionFeedback({
      session_id: sessionId,
      scenario_id: data.scenario_id,
      scenario_title: scenarioTitle || data.scenario_title || 'Role-play session',
      user_id: data.user_id,
      outcome: data.outcome,
      final_trust: finalTrust,
      final_escalation: data.final_escalation ?? 0,
      total_turns: data.turns?.length ?? 0,
      turn_metrics: (data.turns ?? []).map((t) => ({
        turn: t.turn,
        ...(EMOTION_SCORES[t.emotion] ?? DEFAULT_SCORES),
        flags: [],
      })),
      coaching_advice: { overall_rating: rating, summary, advice: [], strengths: [], focus_areas: [] },
    })
  } catch (err) {
    console.warn('APM feedback update failed (non-blocking):', err.message)
  }
}

// REDESIGN: trust color helpers now use semantic CSS variables instead of Tailwind named shades
const getTrustColor = (s) =>
  s >= 70 ? 'var(--success)' : s >= 40 ? 'var(--warning)' : 'var(--danger)'

const computeNpcTone = (trust) =>
  trust >= 70 ? 'cooperative' : trust >= 40 ? 'neutral' : 'hostile'

const NPC_TONE_VARIANT = {
  cooperative: 'success',
  neutral:     'warning',
  hostile:     'danger',
}

const dominantEmotion = (history) => {
  const counts = {}
  for (const e of history) counts[e] = (counts[e] || 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'calm'
}

// REDESIGN: outcome banners are now semantic Card variants with accent stripes (no hex gradients)
const OUTCOME_META = {
  trust_sustained: {
    variant: 'success',
    title: 'Session Complete — Success!',
    sub: 'You built enough trust to resolve the situation.',
  },
  npc_exit: {
    variant: 'danger',
    title: 'The Conversation Broke Down',
    sub: 'The NPC ended the session due to high escalation. Review your feedback below.',
  },
}

function OutcomeBanner({ endReason, outcome, scenarioTitle }) {
  let meta = OUTCOME_META[endReason]
  let title, sub
  if (meta) {
    title = meta.title
    sub = meta.sub
  } else if (endReason === 'max_turns_reached') {
    meta = { variant: outcome === 'success' ? 'success' : 'warning' }
    title = outcome === 'success' ? 'Session Complete' : 'Maximum Turns Reached'
    sub = outcome === 'success'
      ? 'You reached the turn limit — scored on final results.'
      : 'Check your feedback for improvement tips.'
  } else {
    meta = { variant: outcome === 'success' ? 'success' : 'danger' }
    title = outcome === 'success' ? 'Session Complete — Success!' : 'Session Complete — Keep Practicing'
    sub = scenarioTitle
  }

  const accentColor =
    meta.variant === 'success' ? 'var(--success)'
      : meta.variant === 'warning' ? 'var(--warning)'
      : 'var(--danger)'
  const softBg =
    meta.variant === 'success' ? 'var(--success-soft)'
      : meta.variant === 'warning' ? 'var(--warning-soft)'
      : 'var(--danger-soft)'

  return (
    <Card
      style={{
        textAlign: 'center',
        background: softBg,
        borderColor: accentColor,
        borderLeftWidth: 3,
      }}
    >
      <div className="t-h2" style={{ color: 'var(--text-primary)' }}>{title}</div>
      <p className="t-body" style={{ color: 'var(--text-secondary)', marginTop: 6 }}>{sub}</p>
    </Card>
  )
}

export default function SessionComplete() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    sessionId, trustScore, escalationLevel, outcome,
    totalTurns, scenarioTitle, currentTurn,
    endReason, recommendedTurns, maxTurns,
  } = location.state || {}

  const [sessionData, setSessionData]   = useState(null)
  const [isLoading, setIsLoading]       = useState(true)
  const [showAllTurns, setShowAllTurns] = useState(false)

  useEffect(() => {
    if (!sessionId) { navigate('/roleplay'); return }
    rpeService.getSessionSummary(sessionId)
      .then((data) => {
        setSessionData(data)
        if (data?.outcome) {
          _sendApmFeedback(data, sessionId, scenarioTitle)
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [])

  const emotionHistory = sessionData?.emotion_history ?? []
  const trustHistory   = sessionData?.trust_history   ?? []
  const turns          = sessionData?.turns            ?? []
  const finalTrust     = sessionData?.final_trust      ?? trustScore ?? 0
  const finalEsc       = sessionData?.final_escalation ?? escalationLevel ?? 0
  const visibleTurns   = showAllTurns ? turns : turns.slice(0, 3)

  const trustDeltas = trustHistory.slice(1).map((v, i) => v - trustHistory[i])
  const toneHistory = trustHistory.map(computeNpcTone)
  const dom         = dominantEmotion(emotionHistory.slice(1))

  const trustInsight =
    finalTrust > 60 ? { icon: '✅', text: 'You maintained strong trust throughout.', color: 'var(--success)' }
    : finalTrust > 40 ? { icon: '⚠', text: 'Trust was moderate. Try more assertive responses.', color: 'var(--warning)' }
    : { icon: '❌', text: 'Trust was low. Focus on staying calm and professional.', color: 'var(--danger)' }

  const escInsight =
    finalEsc <= 1 ? { icon: '✅', text: 'You kept the conversation calm and controlled.', color: 'var(--success)' }
    : finalEsc <= 3 ? { icon: '⚠', text: 'Some tension arose. Try de-escalating earlier.', color: 'var(--warning)' }
    : { icon: '❌', text: 'High escalation. Avoid reactive or emotional responses.', color: 'var(--danger)' }

  const emotionInsight =
    dom === 'assertive' || dom === 'calm'
      ? { icon: '✅', text: 'Your tone was professional and composed.', color: 'var(--success)' }
      : dom === 'anxious' || dom === 'confused'
      ? { icon: '⚠', text: 'You seemed uncertain. Practice confident phrasing.', color: 'var(--warning)' }
      : { icon: '❌', text: 'Frustration came through. Try staying solution-focused.', color: 'var(--danger)' }

  return (
    <div style={{ padding: '40px 16px' }}>
      <div style={{ maxWidth: 768, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* REDESIGN: outcome banner is now Card with semantic variant + soft tint, no hex gradients */}
        <OutcomeBanner endReason={endReason} outcome={outcome} scenarioTitle={scenarioTitle} />

        {/* REDESIGN: 3 score boxes replaced with StatCard component */}
        <div className="grid-3">
          <StatCard
            label="Final Trust"
            value={trustScore ?? '—'}
            hint={trustScore != null ? (trustScore >= 70 ? 'Strong' : trustScore >= 40 ? 'Moderate' : 'Low') : null}
          />
          <StatCard
            label="Escalation"
            value={escalationLevel ?? '—'}
            unit="/5"
          />
          <StatCard
            label="Turns"
            value={currentTurn ?? '—'}
            unit={endReason !== 'npc_exit' && endReason !== 'trust_sustained' && recommendedTurns ? `/${recommendedTurns}` : ''}
            hint={
              endReason === 'npc_exit' ? 'NPC exited'
                : endReason === 'trust_sustained' ? 'resolved'
                : `of ${recommendedTurns ?? totalTurns ?? '?'} recommended`
            }
          />
        </div>

        {/* Session length context */}
        {(recommendedTurns || maxTurns) && (
          <p
            className="t-cap"
            style={{ textAlign: 'center', marginTop: -8 }}
          >
            Session lasted{' '}
            <span
              className="score-num"
              style={{
                fontWeight: 600,
                color:
                  (currentTurn ?? 0) <= (recommendedTurns ?? 6) ? 'var(--success)'
                    : (currentTurn ?? 0) <= (maxTurns ?? 999) ? 'var(--warning)'
                    : 'var(--danger)',
              }}
            >
              {currentTurn} turns
            </span>
            {recommendedTurns && ` (recommended: ${recommendedTurns}`}
            {maxTurns && ` / max: ${maxTurns}`}
            {(recommendedTurns || maxTurns) && ')'}
          </p>
        )}

        {/* REDESIGN: trust progression chart now uses bg-input track + token gradients */}
        {!isLoading && trustHistory.length > 0 && (() => {
          const minVal = Math.min(...trustHistory)
          const maxVal = Math.max(...trustHistory)
          const range  = maxVal - minVal || 1
          return (
            <Card>
              <div className="t-over" style={{ marginBottom: 14 }}>Trust progression</div>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 8, height: 128 }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: (50 / 100) * 96,
                    borderTop: '1px dashed var(--border-subtle)',
                    pointerEvents: 'none',
                  }}
                />
                {trustHistory.map((val, i) => {
                  const heightPct = 20 + ((val - minVal) / range) * 80
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
                      <span
                        className="score-num"
                        style={{ fontSize: 10, fontWeight: 700, color: getTrustColor(val) }}
                      >
                        {val}
                      </span>
                      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 96 }}>
                        <div
                          style={{
                            width: '100%',
                            height: `${heightPct}%`,
                            borderRadius: '2px 2px 0 0',
                            background: getTrustColor(val),
                            transition: 'height 500ms var(--ease)',
                          }}
                        />
                      </div>
                      <span className="t-cap score-num" style={{ fontSize: 9 }}>
                        {i === 0 ? 'S' : `T${i}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })()}

        {/* REDESIGN: trust delta pills converted to Badge variants */}
        {!isLoading && trustDeltas.length > 0 && (
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>Trust change per turn</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {trustDeltas.map((d, i) => (
                <Badge
                  key={i}
                  variant={d > 0 ? 'success' : d < 0 ? 'danger' : 'neutral'}
                >
                  {d > 0 ? <TrendingUp size={10} strokeWidth={2} /> : d < 0 ? <TrendingDown size={10} strokeWidth={2} /> : <Minus size={10} strokeWidth={2} />}
                  T{i + 1}: {d > 0 ? `+${d}` : d === 0 ? '±0' : d}
                </Badge>
              ))}
            </div>
          </Card>
        )}

        {/* REDESIGN: NPC tone chips → Badge */}
        {!isLoading && toneHistory.length > 0 && (
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>NPC attitude over time</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {toneHistory.map((tone, i) => (
                <Badge key={i} variant={NPC_TONE_VARIANT[tone] ?? 'neutral'}>
                  {i === 0 ? 'Start' : `T${i}`}: <span style={{ textTransform: 'capitalize' }}>{tone}</span>
                </Badge>
              ))}
            </div>
          </Card>
        )}

        {/* REDESIGN: emotion history pills → Badge */}
        {!isLoading && emotionHistory.length > 0 && (
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>Emotion history</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {emotionHistory.map((em, i) => (
                <Badge key={i} variant={EMOTION_BADGE_VARIANT[em] ?? 'neutral'}>
                  {i === 0 ? 'start' : `T${i}`}: {em}
                </Badge>
              ))}
            </div>
          </Card>
        )}

        {/* REDESIGN: turn-by-turn rows now use bg-elevated tile + Badge for emotion/trust */}
        {!isLoading && turns.length > 0 && (
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>Turn by turn</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visibleTurns.map((t) => (
                <div
                  key={t.turn}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius)',
                    padding: '10px 12px',
                  }}
                >
                  <span
                    className="score-num"
                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', width: 22, flexShrink: 0 }}
                  >
                    T{t.turn}
                  </span>
                  <Badge variant={EMOTION_BADGE_VARIANT[t.emotion] ?? 'neutral'}>{t.emotion}</Badge>
                  <span
                    className="score-num"
                    style={{ fontSize: 11, fontWeight: 700, color: getTrustColor(t.trust_score), flexShrink: 0 }}
                  >
                    {t.trust_score}
                  </span>
                  <p
                    className="t-cap"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      margin: 0,
                    }}
                  >
                    {t.user_input}
                  </p>
                </div>
              ))}
            </div>
            {turns.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAllTurns((v) => !v)}
                className="t-cap"
                style={{
                  marginTop: 12,
                  background: 'transparent',
                  border: 0,
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {showAllTurns
                  ? <><ChevronUp size={12} strokeWidth={2} /> Hide</>
                  : <><ChevronDown size={12} strokeWidth={2} /> Show all {turns.length} turns</>}
              </button>
            )}
          </Card>
        )}

        {/* REDESIGN: skeleton uses .skel class */}
        {isLoading && (
          <Card>
            <div className="skel" style={{ height: 16, width: '40%', marginBottom: 12 }} />
            <div className="skel" style={{ height: 12, width: '70%', marginBottom: 8 }} />
            <div className="skel" style={{ height: 12, width: '60%' }} />
          </Card>
        )}

        {/* REDESIGN: insights list uses semantic colors via inline styles */}
        {!isLoading && (
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>How did you do?</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[trustInsight, escInsight, emotionInsight].map((item, i) => (
                <li
                  key={i}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, fontWeight: 500, color: item.color }}
                >
                  <span aria-hidden>{item.icon}</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* REDESIGN: hardcoded bg-blue-600 etc. action buttons replaced with .btn variants */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'center',
            flexWrap: 'wrap',
            paddingBottom: 32,
          }}
        >
          <button
            type="button"
            onClick={() => navigate('/training-plan')}
            className="btn btn-secondary"
          >
            <span className="btn-label">View updated plan</span>
          </button>
          <button
            type="button"
            onClick={() => navigate(`/roleplay/feedback/${sessionId}`)}
            className="btn btn-primary"
          >
            <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <BarChart2 size={14} strokeWidth={1.8} />
              View full feedback
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/roleplay')}
            className="btn btn-secondary"
          >
            <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={14} strokeWidth={1.8} />
              Try again
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/roleplay')}
            className="btn btn-ghost"
          >
            <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <PlayCircle size={14} strokeWidth={1.8} />
              Try another
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="btn btn-ghost"
          >
            <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Home size={14} strokeWidth={1.8} />
              Back to home
            </span>
          </button>
        </div>

      </div>
    </div>
  )
}
