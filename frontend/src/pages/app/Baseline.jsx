import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity, ArrowRight, CheckCircle2, Loader2, Mic, Sparkles, Users,
} from 'lucide-react'
import Webcam from 'react-webcam'
import * as faceMesh from '@mediapipe/face_mesh'
import * as cam from '@mediapipe/camera_utils'
import { toast } from 'sonner'
import { calculateEAR, calculateMAR, estimateHeadPose } from '@/utils/mca/heuristics'
import { mcaService } from '@/services/mca/mcaService'
import { getMyBaseline, completeBaseline, skipBaseline, chatBaseline } from '@/lib/api/baseline'
import { injectDemoPersona, listDemoPersonas } from '@/lib/api/pedagogy'
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute'
import { fadeInUp, staggerContainer } from '@/lib/animations'
import PageHead from '@/components/ui/PageHead'
import Card from '@/components/ui/Card'
import RadialScore from '@/components/ui/RadialScore'
import ChipToggle from '@/components/ui/ChipToggle'

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true'
const SESSION_DURATION = 60

// ---------------------------------------------------------------------------
// CountdownRing
// ---------------------------------------------------------------------------

function CountdownRing({ seconds, total = SESSION_DURATION }) {
  const r = 46
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - seconds / total)
  const stroke =
    seconds <= 10 ? 'var(--danger)' : seconds <= 20 ? 'var(--warning)' : 'var(--accent)'

  return (
    <svg width="112" height="112" viewBox="0 0 112 112" aria-label={`${seconds} seconds remaining`}>
      <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5" />
      <circle
        cx="56" cy="56" r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 56 56)"
        style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s ease' }}
      />
      <text x="56" y="52" textAnchor="middle" style={{ fill: '#fff', fontSize: 22, fontWeight: 700 }}>
        {seconds}
      </text>
      <text x="56" y="67" textAnchor="middle" style={{ fill: 'rgba(255,255,255,0.5)', fontSize: 8, fontWeight: 600, letterSpacing: 1 }}>
        SEC
      </text>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// BaselineSummaryCard — uses actual BaselineSnapshotOut schema
// ---------------------------------------------------------------------------

function BaselineSummaryCard({ baseline }) {
  const overall = Math.round(baseline.overall_score ?? 0)
  const scoreColor =
    overall >= 70 ? 'var(--success)' : overall >= 50 ? 'var(--warning)' : 'var(--accent)'
  const scoreSub = overall >= 70 ? 'STRONG' : overall >= 50 ? 'MID' : 'EARLY'
  const skipped = baseline.mca_session_id === 'skipped'

  const emotionDist = baseline.emotion_distribution || {}
  const dominantEmotion =
    Object.entries(emotionDist).sort((a, b) => b[1] - a[1])[0]?.[0] || null

  const skillScores = baseline.skill_scores
    ? Object.entries(baseline.skill_scores).filter(([, v]) => typeof v === 'number')
    : []

  return (
    <motion.div variants={fadeInUp}>
      <Card variant="accent">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success)', marginBottom: 8 }}>
          <CheckCircle2 size={16} strokeWidth={1.8} />
          <span className="t-over" style={{ color: 'var(--success)' }}>
            {skipped ? 'Baseline skipped' : 'Baseline complete'}
          </span>
        </div>

        <div className="t-h2" style={{ marginBottom: 6 }}>
          {skipped ? 'Training plan generated.' : 'Your voice signal is calibrated.'}
        </div>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--text-secondary)' }}>
          {skipped
            ? 'Your plan is based on your personality profile. Complete the baseline later for a more personalised experience.'
            : "We've used the prosodic and emotional cues from your recording to seed your training plan."}
        </p>

        {!skipped && (
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 24, alignItems: 'center' }}>
            <RadialScore value={overall} label="Overall" sub={scoreSub} color={scoreColor} />
            <div>
              {dominantEmotion && (
                <>
                  <div className="t-over" style={{ marginBottom: 10 }}>Dominant emotion</div>
                  <ChipToggle staticOnly>
                    <span style={{ textTransform: 'capitalize' }}>{dominantEmotion}</span>
                  </ChipToggle>
                </>
              )}
              {baseline.duration_seconds != null && (
                <>
                  <div className="t-over" style={{ marginTop: 16, marginBottom: 6 }}>Duration</div>
                  <div className="score-num fg" style={{ fontSize: 16 }}>
                    {String(Math.floor(baseline.duration_seconds / 60)).padStart(2, '0')}
                    :
                    {String(baseline.duration_seconds % 60).padStart(2, '0')}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {skillScores.length > 0 && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <div className="t-over" style={{ marginBottom: 12 }}>Skill breakdown</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {skillScores.map(([skill, score]) => (
                <div key={skill} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="t-cap" style={{ textTransform: 'capitalize' }}>
                    {skill.replace(/_/g, ' ')}
                  </div>
                  <div className="fg" style={{ fontSize: 13, fontWeight: 600 }}>
                    {Math.round(Number(score))}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// DemoInjector
// ---------------------------------------------------------------------------

function DemoInjector({ onInjected }) {
  const [personas, setPersonas] = useState([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(null)

  useEffect(() => {
    listDemoPersonas()
      .then(setPersonas)
      .catch(() => setPersonas([]))
  }, [])

  async function handleInject(personaId) {
    setLoading(true)
    setActive(personaId)
    try {
      await injectDemoPersona(personaId)
      onInjected()
    } catch {
      setLoading(false)
      setActive(null)
    }
  }

  if (!personas.length) return null

  return (
    <motion.div variants={fadeInUp}>
      <Card variant="accent">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Users size={16} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
          <div className="t-over" style={{ color: 'var(--accent)' }}>Demo mode — inject a persona</div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
          Instantly load a pre-canned OCEAN profile + baseline for demonstration purposes.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {personas.map((p) => (
            <button
              key={p.id}
              onClick={() => handleInject(p.id)}
              disabled={loading}
              className="card card-interactive"
              style={{
                padding: 12, textAlign: 'left', display: 'flex', gap: 12,
                alignItems: 'flex-start', background: 'var(--bg-elevated)',
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'var(--accent-soft)', border: '1px solid var(--accent-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)', flexShrink: 0,
              }}>
                {loading && active === p.id
                  ? <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />
                  : <Sparkles size={14} strokeWidth={1.8} />}
              </div>
              <div>
                <div className="fg" style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</div>
                <div className="t-cap" style={{ marginTop: 2 }}>{p.description}</div>
              </div>
            </button>
          ))}
        </div>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// BaselineSession — 60-second guided recording
// ---------------------------------------------------------------------------

// Chat messages sent to the AI at each stage of the session
const STAGE_MESSAGES = [
  'start',           // 0s  — AI greets + asks first question
  'continue',        // 20s — AI gives a mid-session prompt
  'wrap up',         // 40s — AI signals the end is near
]

function BaselineSession({ onComplete, onError }) {
  // Stable refs (never trigger re-renders)
  const webcamRef        = useRef(null)
  const canvasRef        = useRef(null)
  const cameraUtilRef    = useRef(null)
  const socketRef        = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioStreamRef   = useRef(null)
  const recordRestartRef = useRef(null)
  const metricsRef       = useRef({ ear: 0, mar: 0, pose: { yaw: 0, pitch: 0, roll: 0 } })
  const emotionRef       = useRef('Sensing...')
  const emotionCountsRef = useRef({})
  const sessionIdRef     = useRef(null)
  const countdownRef     = useRef(null)
  const chatTurnRef      = useRef(0)
  const chatHistoryRef   = useRef([])
  const endingRef        = useRef(false)
  const onCompleteRef    = useRef(onComplete)
  const onErrorRef       = useRef(onError)

  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])
  useEffect(() => { onErrorRef.current = onError }, [onError])

  // Render state
  const [countdown, setCountdown]       = useState(SESSION_DURATION)
  const [emotionDisplay, setEmotionDisplay] = useState('Sensing...')
  const [aiMessages, setAiMessages]     = useState([])
  const [cameraReady, setCameraReady]   = useState(false)
  const [isEnding, setIsEnding]         = useState(false)

  // --- Audio stop (ref-only, stable) ---
  function stopAudio() {
    if (recordRestartRef.current) clearTimeout(recordRestartRef.current)
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
    mediaRecorderRef.current = null
    socketRef.current?.close()
    socketRef.current = null
    audioStreamRef.current?.getTracks().forEach((t) => t.stop())
    audioStreamRef.current = null
  }

  // --- FaceMesh results handler ---
  const onFaceMeshResults = useCallback((results) => {
    if (!webcamRef.current?.video || !canvasRef.current) return
    const video  = webcamRef.current.video
    const canvas = canvasRef.current
    if (canvas.width  !== video.videoWidth)  canvas.width  = video.videoWidth
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height)

    if (results.multiFaceLandmarks?.[0]) {
      const lm = results.multiFaceLandmarks[0]
      metricsRef.current = {
        ear: calculateEAR(lm),
        mar: calculateMAR(lm),
        pose: estimateHeadPose(lm),
      }
    }
    ctx.restore()
  }, [])

  // --- FaceMesh init (fires when webcam is ready) ---
  useEffect(() => {
    if (!cameraReady || !webcamRef.current?.video) return

    const fmModel = new faceMesh.FaceMesh({
      locateFile: (file) => {
        const base =
          import.meta.env.VITE_MEDIAPIPE_FACE_MESH_URL ||
          'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh'
        return `${base}/${file}`
      },
    })
    fmModel.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
    fmModel.onResults(onFaceMeshResults)

    cameraUtilRef.current = new cam.Camera(webcamRef.current.video, {
      onFrame: async () => { await fmModel.send({ image: webcamRef.current.video }) },
      width: 640,
      height: 480,
    })
    cameraUtilRef.current.start()

    return () => {
      cameraUtilRef.current?.stop()
      cameraUtilRef.current = null
      fmModel.close()
    }
  }, [cameraReady, onFaceMeshResults])

  // --- Mount: start session, audio, countdown, AI chat ---
  useEffect(() => {
    let cancelled = false

    async function callAI(turn) {
      const msg = STAGE_MESSAGES[Math.min(turn, STAGE_MESSAGES.length - 1)]
      try {
        const result = await chatBaseline(
          msg,
          chatHistoryRef.current,
          { metrics: { ...metricsRef.current, emotion: emotionRef.current } },
          turn,
        )
        if (result?.response && !cancelled) {
          setAiMessages((prev) => [...prev, result.response])
          chatHistoryRef.current = [
            ...chatHistoryRef.current,
            { type: 'user', text: msg },
            { type: 'model', text: result.response },
          ]
        }
      } catch { /* session continues regardless */ }
    }

    async function doEndSession() {
      if (endingRef.current) return
      endingRef.current = true
      setIsEnding(true)
      clearInterval(countdownRef.current)
      stopAudio()
      cameraUtilRef.current?.stop()

      const sid = sessionIdRef.current
      if (!sid) { onErrorRef.current(); return }

      const total = Object.values(emotionCountsRef.current).reduce((a, b) => a + b, 0)
      const distribution = {}
      if (total > 0) {
        Object.entries(emotionCountsRef.current).forEach(([emo, count]) => {
          distribution[emo] = count / total
        })
      }

      try {
        await mcaService.endSession(
          sid,
          [],
          { total_nudges: 0, final_emotion: emotionRef.current },
          null,
          distribution,
          {
            avg_ear: metricsRef.current.ear,
            avg_mar: metricsRef.current.mar,
            avg_pitch: metricsRef.current.pose?.pitch ?? 0,
          },
        )
        const result = await completeBaseline(sid)
        onCompleteRef.current(result)
      } catch {
        toast.error('Could not save baseline. Please try again.')
        onErrorRef.current()
      }
    }

    async function startAudio() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
      audioStreamRef.current = stream

      const socket = new WebSocket(mcaService.getAudioStreamUrl())
      socketRef.current = socket

      socket.onopen = () => {
        const startChunk = () => {
          if (socket.readyState !== WebSocket.OPEN) return
          const recorder = new MediaRecorder(stream)
          mediaRecorderRef.current = recorder

          recorder.ondataavailable = (e) => {
            if (e.data.size > 0 && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: 'visual_metrics',
                metrics: metricsRef.current,
                session_id: sessionIdRef.current,
              }))
              socket.send(e.data)
            }
          }

          recorder.start()
          recordRestartRef.current = setTimeout(() => {
            if (recorder.state === 'recording') { recorder.stop(); startChunk() }
          }, 1000)
        }
        startChunk()
      }

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.metrics?.emotion) {
            const emo = data.metrics.emotion.toLowerCase()
            const display = emo.charAt(0).toUpperCase() + emo.slice(1)
            emotionRef.current = display
            setEmotionDisplay(display)
            emotionCountsRef.current[emo] = (emotionCountsRef.current[emo] || 0) + 1
          }
        } catch { /* ignore */ }
      }

      socket.onerror = () => {}
    }

    async function init() {
      try {
        const session = await mcaService.startSession('baseline')
        if (cancelled) return
        sessionIdRef.current = session.id

        await startAudio()
        if (cancelled) return

        // Opening AI message (slight delay so the page renders first)
        setTimeout(() => callAI(chatTurnRef.current++), 800)

        let remaining = SESSION_DURATION
        countdownRef.current = setInterval(() => {
          remaining -= 1
          setCountdown(remaining)
          const elapsed = SESSION_DURATION - remaining
          if (elapsed === 20) callAI(chatTurnRef.current++)
          if (elapsed === 40) callAI(chatTurnRef.current++)
          if (remaining <= 0) {
            clearInterval(countdownRef.current)
            doEndSession()
          }
        }, 1000)
      } catch {
        if (!cancelled) {
          toast.error('Could not start baseline session. Check camera and mic permissions.')
          onErrorRef.current()
        }
      }
    }

    init()

    return () => {
      cancelled = true
      endingRef.current = true
      clearInterval(countdownRef.current)
      stopAudio()
    }
  }, []) // intentionally runs once on mount

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="page page-read"
    >
      <PageHead
        eyebrow="Voice baseline"
        title="Recording in progress"
        sub="Speak naturally. The AI will guide you through the session."
      />

      {/* Camera + countdown overlay */}
      <motion.div variants={fadeInUp}>
        <Card style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
          {/* Hidden webcam — FaceMesh reads from its video element */}
          <Webcam
            ref={webcamRef}
            onUserMedia={() => setCameraReady(true)}
            videoConstraints={{ width: 640, height: 480, facingMode: 'user' }}
            style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
            mirrored
          />

          {/* Canvas: camera feed + face metrics drawn by FaceMesh */}
          <div style={{ position: 'relative', background: 'var(--bg-elevated)', minHeight: 220 }}>
            {!cameraReady && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: 8,
              }}>
                <Loader2 size={20} strokeWidth={1.6} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Initialising camera…</span>
              </div>
            )}
            <canvas
              ref={canvasRef}
              style={{
                width: '100%', display: 'block', maxHeight: 280,
                objectFit: 'cover',
                opacity: cameraReady ? 1 : 0,
                transition: 'opacity 0.4s ease',
              }}
            />

            {/* Countdown ring overlay */}
            <div style={{
              position: 'absolute', top: 12, right: 12,
              background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
              borderRadius: '50%', padding: 4,
            }}>
              <CountdownRing seconds={countdown} />
            </div>

            {/* Live emotion badge */}
            <div style={{
              position: 'absolute', bottom: 12, left: 12,
              background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
              borderRadius: 'var(--radius)', padding: '4px 10px',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--success)', display: 'inline-block',
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
              <span style={{ fontSize: 11, color: '#fff', fontWeight: 500 }}>{emotionDisplay}</span>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* AI guide messages */}
      {aiMessages.length > 0 && (
        <motion.div variants={fadeInUp}>
          <Card>
            <div style={{
              fontSize: 10, color: 'var(--accent)', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10,
            }}>
              Guide
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {aiMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    padding: '10px 14px',
                    background: i === aiMessages.length - 1 ? 'var(--bg-input)' : 'transparent',
                    border: i === aiMessages.length - 1 ? '1px solid var(--border-subtle)' : '1px solid transparent',
                    borderRadius: 'var(--radius)',
                    fontSize: 14,
                    color: i === aiMessages.length - 1 ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    lineHeight: 1.6,
                    transition: 'all 0.3s ease',
                  }}
                >
                  {msg}
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Status bar */}
      <motion.div
        variants={fadeInUp}
        style={{ textAlign: 'center', paddingBottom: 24 }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          {isEnding
            ? <Loader2 size={14} strokeWidth={1.6} className="animate-spin" style={{ color: 'var(--accent)' }} />
            : <Mic size={14} strokeWidth={1.6} style={{ color: 'var(--accent)' }} />}
          <span>{isEnding ? 'Saving your baseline…' : 'Recording · speak naturally'}</span>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Baseline — main 4-state component
// ---------------------------------------------------------------------------

export default function Baseline() {
  const { isLoading: authLoading } = useProtectedRoute()
  const navigate = useNavigate()
  const [phase, setPhase]       = useState('checking') // checking | ready | session | complete
  const [baseline, setBaseline] = useState(null)
  const [skipping, setSkipping] = useState(false)

  useEffect(() => {
    if (authLoading) return
    getMyBaseline()
      .then((b) => {
        setBaseline(b)
        setPhase(b ? 'complete' : 'ready')
      })
      .catch(() => setPhase('ready'))
  }, [authLoading])

  async function handleSkip() {
    setSkipping(true)
    try {
      const result = await skipBaseline()
      setBaseline(result.baseline)
      setPhase('complete')
    } catch {
      navigate('/training-plan')
    } finally {
      setSkipping(false)
    }
  }

  function handleComplete(result) {
    setBaseline(result.baseline)
    setPhase('complete')
  }

  // Checking / loading
  if (authLoading || phase === 'checking') {
    return (
      <div style={{ display: 'flex', minHeight: '50vh', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={24} strokeWidth={1.6} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    )
  }

  // Session — renders within AppLayout (sidebar visible)
  if (phase === 'session') {
    return (
      <BaselineSession
        onComplete={handleComplete}
        onError={() => setPhase('ready')}
      />
    )
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="page page-read"
    >
      <PageHead
        eyebrow="Voice baseline"
        title="Voice baseline"
        sub="A 60-second voice assessment calibrates your training plan with real vocal and emotional evidence — on top of your personality profile."
      />

      {/* Ready: How it works */}
      {phase === 'ready' && (
        <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
          <Card className="violet-halo" style={{ position: 'relative', padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'var(--accent-soft)', border: '1px solid var(--accent-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
              }}>
                <Mic size={14} strokeWidth={1.8} />
              </div>
              <div className="t-h3" style={{ margin: 0 }}>How it works</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 22 }}>
              {[
                ['Allow mic & camera', 'Browser permission only'],
                ['Speak naturally', '60 seconds, guided by AI'],
                ['Get personalised plan', 'Calibrated to your voice'],
              ].map(([t, s], i) => (
                <div
                  key={t}
                  style={{
                    padding: 16, background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius)',
                  }}
                >
                  <div className="score-num" style={{ color: 'var(--accent)', fontSize: 11, marginBottom: 8 }}>
                    STEP 0{i + 1}
                  </div>
                  <div className="fg" style={{ fontSize: 14, fontWeight: 500 }}>{t}</div>
                  <div className="t-cap" style={{ marginTop: 4 }}>{s}</div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setPhase('session')}
              className="btn btn-primary btn-lg"
            >
              <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Activity size={14} strokeWidth={1.8} />
                Start voice baseline
                <ArrowRight size={14} strokeWidth={1.8} />
              </span>
            </button>

            <div className="t-cap" style={{ marginTop: 16 }}>
              Audio and facial cues are processed on-device where possible. Raw recordings are not retained.
            </div>
          </Card>
        </motion.div>
      )}

      {/* Complete: summary card */}
      {phase === 'complete' && baseline && (
        <BaselineSummaryCard baseline={baseline} />
      )}

      {/* Demo injector */}
      {IS_DEMO && (
        <div style={{ marginTop: 16 }}>
          <DemoInjector
            onInjected={() => {
              getMyBaseline()
                .then((b) => { setBaseline(b); setPhase('complete') })
                .catch(() => {})
            }}
          />
        </div>
      )}

      {/* CTAs */}
      <motion.div
        variants={fadeInUp}
        style={{ paddingTop: 16, paddingBottom: 32, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {phase === 'complete' ? (
          <Link to="/training-plan" className="btn btn-primary btn-lg" style={{ width: '100%' }}>
            <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              View your calibrated plan
              <ArrowRight size={14} strokeWidth={1.8} />
            </span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={handleSkip}
            disabled={skipping}
            className="btn btn-secondary btn-lg"
            style={{ width: '100%' }}
          >
            <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {skipping && <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />}
              Skip — generate plan without baseline
            </span>
          </button>
        )}
        <Link to="/dashboard" className="btn btn-ghost" style={{ width: '100%' }}>
          <span className="btn-label">Continue to dashboard</span>
        </Link>
      </motion.div>
    </motion.div>
  )
}
