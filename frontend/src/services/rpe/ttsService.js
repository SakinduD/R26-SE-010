import { API_URL } from '@/lib/config'

// Fetch + decode only — no provider selection or fallback-orchestration
// logic here. That lives in RolePlaySessionV2.jsx's startSpeaking() (the
// only production caller), which decides when to use this vs. the
// existing Google TTS (/api/gtts via speakText) vs. the browser's own
// SpeechSynthesis. This module talks to the backend's TTSManager
// (Backend/app/services/tts/tts_manager.py) at /api/tts/speak, which
// resolves Chirp 3 HD server-side — the frontend never picks a voice
// directly, only the NPC's gender (see lib/rpe/ttsConfig.js for the
// managed-vs-legacy switch).

const DEV_CACHE = new Map()
const MAX_CACHE_ENTRIES = 30

// A plain fetch() has no timeout at all — on a stalled connection it hangs
// forever. Since speak() awaits this before re-enabling the next turn (see
// RolePlaySessionV2.jsx's startSpeaking), a hang here reads as the whole
// session freezing, not just a slow voice line. Bounded slightly above the
// backend's own REQUEST_TIMEOUT_S (15s, see chirp3_provider.py) so the
// backend's own clean timeout error gets a chance to come back first.
const FETCH_TIMEOUT_MS = 20000

function base64ToArrayBuffer(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`TTS request timed out after ${timeoutMs}ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Synthesizes one line of NPC dialogue via the backend TTS manager.
// Throws on any failure (network, or every backend provider failing) —
// the caller is expected to catch and fall back, never to surface this
// raw to the user. `gender` ("male"|"female", the NPC's own — same value
// used to pick their avatar/profile picture) selects the Chirp3 voice.
// `provider`/`voice`/`speed` are overrides for the dev test page only —
// real NPC dialogue never sets them.
export async function synthesizeNpcSpeech({ text, emotion = 'neutral', intensity = null, gender = null, provider = null, voice = null, speed = null }) {
  const requestStart = performance.now()

  // Cached on the request's own inputs — speech_performance.py's mapping
  // is deterministic, so identical inputs always resolve the same way.
  // DEV-only per spec; a repeat line in production always re-synthesizes.
  const cacheKey = `${provider}::${voice}::${speed}::${gender}::${emotion}::${intensity}::${text}`
  if (import.meta.env.DEV && DEV_CACHE.has(cacheKey)) {
    console.log('[TTS] cache hit —', text.slice(0, 40))
    return DEV_CACHE.get(cacheKey)
  }

  const response = await fetchWithTimeout(`${API_URL}/api/tts/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, emotion, intensity, gender, provider, voice, speed }),
  })
  const networkDoneAt = performance.now()

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail || `TTS request failed (${response.status})`)
  }

  const data = await response.json()
  const audioBuffer = base64ToArrayBuffer(data.audio)
  const readyAt = performance.now()

  const result = {
    audioBuffer,
    contentType: data.contentType,
    provider: data.provider,
    voice: data.voice,
    durationMs: data.durationMs,
    words: data.words,
    wtimes: data.wtimes,
    wdurations: data.wdurations,
    pauseBeforeMs: data.pauseBeforeMs,
    pauseAfterMs: data.pauseAfterMs,
  }

  if (import.meta.env.DEV) {
    const latency = {
      requestMs: Math.round(networkDoneAt - requestStart),
      decodeMs: Math.round(readyAt - networkDoneAt),
      totalMs: Math.round(readyAt - requestStart),
    }
    console.log('[TTS] request', `provider=${data.provider}`, text.slice(0, 40), latency)
    result.latency = latency
    DEV_CACHE.set(cacheKey, result)
    if (DEV_CACHE.size > MAX_CACHE_ENTRIES) {
      DEV_CACHE.delete(DEV_CACHE.keys().next().value)
    }
  }

  return result
}

export async function getTtsHealth() {
  const response = await fetchWithTimeout(`${API_URL}/api/tts/speak/health`, {}, 5000)
  if (!response.ok) throw new Error(`TTS health check failed (${response.status})`)
  return response.json()
}

// Benchmark runs many synthesis calls in sequence server-side — give it a
// much longer budget than a single utterance.
export async function runTtsBenchmark(providers = ['chirp3']) {
  const response = await fetchWithTimeout(`${API_URL}/api/v1/rpe/tts/benchmark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providers }),
  }, 120000)
  if (!response.ok) throw new Error(`TTS benchmark failed (${response.status})`)
  return response.json()
}
