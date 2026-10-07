import { Fragment, useState, useRef, useCallback, useEffect } from 'react'
import { API_URL } from '@/lib/config'
import { synthesizeNpcSpeech, getTtsHealth, runTtsBenchmark } from '@/services/rpe/ttsService'

/*
 * TtsTestDev — dev-only harness for listening to NPC voice output across
 * Chirp 3 HD (via the backend TTS manager, /api/tts/speak — gender picks
 * the voice), the existing legacy Google /api/gtts proxy, and the
 * browser's own SpeechSynthesis, before trusting any of them in a real
 * session. No avatar, no TalkingHead, no auth — just raw audio playback,
 * so it loads fast and isolates voice quality/latency/pacing from
 * everything else in the session.
 *
 * Registered in App.jsx behind import.meta.env.DEV only — stripped from
 * production builds, same pattern as EnvironmentPreviewDev.
 */

const SAMPLE_LINES = [
  { label: 'Calm manager', text: "Let's take a step back and look at what's actually blocking this." },
  { label: 'Frustrated client', text: "This is the third time I've asked. I need this fixed today, not next week." },
  { label: 'Concerned colleague', text: "I'm a little worried this timeline doesn't leave room for testing. Can we talk it through?" },
  { label: 'Confident manager', text: "I've reviewed the numbers, and I'm comfortable moving forward with this plan." },
  { label: 'Supportive teammate', text: "You've got this. Let me know if there's anything I can take off your plate." },
]

const EMOTIONS = ['neutral', 'frustrated', 'concerned', 'confident', 'satisfied', 'happy', 'angry', 'sad', 'skeptical', 'surprised', 'thinking']

const GOOGLE_LEGACY_VOICE = { languageCode: 'en-GB', name: 'en-GB-Neural2-C' }

export default function TtsTestDev() {
  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState(null)
  const [text, setText] = useState(SAMPLE_LINES[0].text)
  const [emotion, setEmotion] = useState('neutral')
  const [gender, setGender] = useState('female')
  const [busy, setBusy] = useState(null)
  const [results, setResults] = useState({})
  const [error, setError] = useState(null)
  const [benchmarkRows, setBenchmarkRows] = useState(null)
  const [benchmarkRunning, setBenchmarkRunning] = useState(false)
  const audioRef = useRef(null)

  useEffect(() => {
    getTtsHealth().then(setHealth).catch((err) => setHealthError(err.message))
  }, [])

  const stopAll = useCallback(() => {
    audioRef.current?.pause()
    window.speechSynthesis?.cancel()
  }, [])

  const playBuffer = useCallback((arrayBuffer, mimeType) => {
    const blob = new Blob([arrayBuffer], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onended = () => URL.revokeObjectURL(url)
    audio.play()
    return audio
  }, [])

  const runManaged = useCallback(async () => {
    setError(null)
    setBusy('chirp3')
    try {
      const t0 = performance.now()
      const result = await synthesizeNpcSpeech({ text, emotion, gender, provider: 'chirp3' })
      const generationMs = Math.round(performance.now() - t0)
      const audio = playBuffer(result.audioBuffer, result.contentType || 'audio/wav')
      setResults((prev) => ({
        ...prev,
        chirp3: {
          generationMs, durationS: (result.durationMs / 1000).toFixed(2),
          voice: result.voice, servedBy: result.provider, wordCount: result.words?.length ?? 0,
        },
      }))
      void audio
    } catch (err) {
      setError(`chirp3: ${err.message}`)
    } finally {
      setBusy(null)
    }
  }, [text, emotion, gender])

  const runGoogleLegacy = useCallback(async () => {
    setError(null)
    setBusy('google-legacy')
    try {
      const t0 = performance.now()
      const response = await fetch(`${API_URL}/api/gtts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { ssml: `<speak>${escapeSsml(text)}</speak>` },
          voice: GOOGLE_LEGACY_VOICE,
          audioConfig: { audioEncoding: 'MP3' },
        }),
      })
      if (!response.ok) throw new Error(`Google TTS request failed (${response.status})`)
      const data = await response.json()
      if (!data.audioContent) throw new Error('Google TTS returned no audio — is GOOGLE_CLOUD_API_KEY set?')
      const binary = atob(data.audioContent)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const generationMs = Math.round(performance.now() - t0)

      const audio = playBuffer(bytes.buffer, 'audio/mp3')
      audio.onloadedmetadata = () => {
        setResults((prev) => ({
          ...prev,
          'google-legacy': { generationMs, durationS: audio.duration.toFixed(2), voice: GOOGLE_LEGACY_VOICE.name, servedBy: 'google-legacy' },
        }))
      }
    } catch (err) {
      setError(`Google (legacy): ${err.message}`)
    } finally {
      setBusy(null)
    }
  }, [text])

  const runBrowser = useCallback(() => {
    setError(null)
    if (!window.speechSynthesis) { setError('Browser: SpeechSynthesis not available'); return }
    setBusy('browser')
    const t0 = performance.now()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onstart = () => {
      setResults((prev) => ({ ...prev, browser: { generationMs: Math.round(performance.now() - t0), durationS: '—', voice: 'system default', servedBy: 'browser' } }))
    }
    utterance.onend = () => setBusy(null)
    utterance.onerror = () => setBusy(null)
    window.speechSynthesis.speak(utterance)
  }, [text])

  const runBenchmark = useCallback(async () => {
    setBenchmarkRunning(true)
    setError(null)
    try {
      const { results: rows } = await runTtsBenchmark(['chirp3'])
      setBenchmarkRows(rows)
    } catch (err) {
      setError(`Benchmark: ${err.message}`)
    } finally {
      setBenchmarkRunning(false)
    }
  }, [])

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>RPE — TTS Provider Test <span style={styles.devTag}>DEV ONLY</span></h1>

      <section style={styles.card}>
        <h2 style={styles.h2}>Provider status</h2>
        {healthError && <p style={styles.error}>Health check failed: {healthError}</p>}
        {health && (
          <div style={styles.statusGrid}>
            <span>Primary provider</span><b>{health.primaryProvider}</b>
            {Object.entries(health.providers).map(([name, info]) => (
              <Fragment key={name}>
                <span>{name}</span>
                <b>{info.available ? 'available' : 'not configured'}</b>
              </Fragment>
            ))}
          </div>
        )}
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>Sample lines</h2>
        <div style={styles.row}>
          {SAMPLE_LINES.map((s) => (
            <button key={s.label} style={styles.chip} onClick={() => setText(s.text)}>{s.label}</button>
          ))}
        </div>
        <textarea style={styles.textarea} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} />
        <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
          <label style={styles.label}>Emotion
            <select style={styles.select} value={emotion} onChange={(e) => setEmotion(e.target.value)}>
              {EMOTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label style={styles.label}>NPC gender (Chirp3 voice)
            <select style={styles.select} value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="female">female</option>
              <option value="male">male</option>
            </select>
          </label>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>Generate &amp; compare</h2>
        <div style={styles.row}>
          <button style={styles.primaryBtn} disabled={busy !== null} onClick={runManaged}>
            {busy === 'chirp3' ? 'Generating…' : 'Play via Chirp 3 HD'}
          </button>
          <button style={styles.primaryBtn} disabled={busy !== null} onClick={runGoogleLegacy}>
            {busy === 'google-legacy' ? 'Generating…' : 'Play via Google (legacy)'}
          </button>
          <button style={styles.primaryBtn} disabled={busy !== null} onClick={runBrowser}>
            {busy === 'browser' ? 'Speaking…' : 'Play via Browser'}
          </button>
          <button style={styles.stopBtn} onClick={stopAll}>Stop</button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <table style={styles.table}>
          <thead><tr><th>Requested</th><th>Served by</th><th>Generation time</th><th>Audio duration</th><th>Voice used</th></tr></thead>
          <tbody>
            {['chirp3', 'google-legacy', 'browser'].map((p) => (
              <tr key={p}>
                <td>{p}</td>
                <td>{results[p]?.servedBy ?? '—'}</td>
                <td>{results[p] ? `${results[p].generationMs}ms` : '—'}</td>
                <td>{results[p] && results[p].durationS !== '—' ? `${results[p].durationS}s` : '—'}</td>
                <td>{results[p]?.voice ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>Benchmark (10 lines × Chirp 3 HD, alternating gender)</h2>
        <button style={styles.primaryBtn} disabled={benchmarkRunning} onClick={runBenchmark}>
          {benchmarkRunning ? 'Running…' : 'Run benchmark'}
        </button>
        {benchmarkRows && (
          <table style={{ ...styles.table, marginTop: 12 }}>
            <thead><tr><th>Provider</th><th>Line</th><th>Gender</th><th>Latency</th><th>Duration</th><th>RTF</th><th>Status</th></tr></thead>
            <tbody>
              {benchmarkRows.map((r, i) => (
                <tr key={i}>
                  <td>{r.provider}</td>
                  <td>{r.label}</td>
                  <td>{r.gender}</td>
                  <td>{r.success ? `${r.latencyMs}ms` : '—'}</td>
                  <td>{r.success ? `${r.durationMs}ms` : '—'}</td>
                  <td>{r.success ? r.rtf : '—'}</td>
                  <td style={{ color: r.success ? '#2a7' : '#c0392b' }}>{r.success ? 'ok' : r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function escapeSsml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const styles = {
  page: { maxWidth: 860, margin: '0 auto', padding: '24px 20px', fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' },
  h1: { fontSize: 20, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 },
  devTag: { fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: '#fff', background: '#c0392b', padding: '2px 8px', borderRadius: 100 },
  h2: { fontSize: 13, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#555', marginBottom: 10 },
  card: { border: '1px solid #e2e2e2', borderRadius: 10, padding: 16, marginBottom: 16, background: '#fafafa' },
  statusGrid: { display: 'grid', gridTemplateColumns: 'auto auto', gap: '4px 16px', fontSize: 13 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { fontSize: 12, padding: '4px 10px', borderRadius: 100, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' },
  textarea: { width: '100%', fontSize: 14, padding: 10, borderRadius: 8, border: '1px solid #ccc', fontFamily: 'inherit', resize: 'vertical' },
  label: { fontSize: 12, fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 4, width: 220 },
  select: { fontSize: 13, padding: '4px 6px', borderRadius: 6 },
  primaryBtn: { fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 8, border: '1px solid #333', background: '#1a1a1a', color: '#fff', cursor: 'pointer' },
  stopBtn: { fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 8, border: '1px solid #c0392b', background: '#fff', color: '#c0392b', cursor: 'pointer' },
  error: { color: '#c0392b', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 10 },
}
