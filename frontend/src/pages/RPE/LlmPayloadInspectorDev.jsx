import { useState, useEffect, useCallback, useMemo } from 'react'
import { API_URL } from '@/lib/config'

/*
 * LlmPayloadInspectorDev — RPE V2 LLM PAYLOAD INSPECTOR (observability
 * only — see Backend/docs/INTEGRATION_RPE_LLM_PAYLOAD_INSPECTOR.md).
 *
 * Reads the DEV-only capture the backend already recorded for every real
 * NPC-dialogue LLM call (Backend/app/services/rpe_llm_debug.py) —this page
 * makes no LLM calls itself, changes nothing about a live session, and
 * shows nothing that isn't already true of what the backend actually sent.
 *
 * DEV-only, same convention as EnvironmentPreviewDev.jsx: registered in
 * App.jsx behind import.meta.env.DEV, so Vite strips this whole route from
 * a production build. The backend side of the gate (settings.debug) is
 * separate and enforced independently — every /llm/debug/* endpoint 404s
 * on its own when the backend isn't in dev mode, so this page shows a
 * plain "DEV mode is off" message rather than crashing if someone reaches
 * it against a non-dev backend.
 */

const BASE = `${API_URL}/api/v1/rpe/llm/debug`

const COMPONENT_KEYS = ['system', 'state', 'history', 'user', 'schema']
const DIFF_COLOR = {
  BASELINE: '#8B949E', UNCHANGED: '#3FB950', CHANGED: '#D29922',
}

function fmtNum(n) {
  return n == null ? '—' : n.toLocaleString()
}
function fmtMs(n) {
  return n == null ? 'null' : `${Math.round(n)}ms`
}

async function getJson(url) {
  const res = await fetch(url)
  if (res.status === 404) return { notFound: true }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export default function LlmPayloadInspectorDev() {
  const [sessionIds, setSessionIds] = useState([])
  const [selectedSession, setSelectedSession] = useState('')
  const [turns, setTurns] = useState([])
  const [providers, setProviders] = useState([])
  const [devModeOff, setDevModeOff] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const [compareA, setCompareA] = useState(null)
  const [compareB, setCompareB] = useState(null)

  const loadAll = useCallback(async (sessionOverride) => {
    setLoading(true)
    setError(null)
    try {
      const sessionsData = await getJson(`${BASE}/sessions`)
      if (sessionsData.notFound) { setDevModeOff(true); setLoading(false); return }
      setDevModeOff(false)
      const ids = sessionsData.session_ids || []
      setSessionIds(ids)

      const targetSession = sessionOverride || selectedSession || ids[ids.length - 1] || ''
      if (targetSession && targetSession !== selectedSession) setSelectedSession(targetSession)

      const providersData = await getJson(`${BASE}/providers`)
      if (!providersData.notFound) setProviders(providersData.providers || [])

      if (targetSession) {
        const sessionData = await getJson(`${BASE}/session/${targetSession}`)
        setTurns(sessionData.notFound ? [] : (sessionData.turns || []))
      } else {
        setTurns([])
      }
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const onSelectSession = async (sessionId) => {
    setSelectedSession(sessionId)
    setCompareA(null); setCompareB(null)
    setLoading(true)
    try {
      const sessionData = await getJson(`${BASE}/session/${sessionId}`)
      setTurns(sessionData.notFound ? [] : (sessionData.turns || []))
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const toggleExpanded = (turn) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(turn)) next.delete(turn); else next.add(turn)
      return next
    })
  }

  const latest = turns.length ? turns[turns.length - 1] : null

  const findings = useMemo(() => buildFindings(turns), [turns])

  if (devModeOff) {
    return (
      <div style={styles.page}>
        <h1 style={styles.h1}>RPE LLM PAYLOAD INSPECTOR</h1>
        <p style={{ color: '#D29922' }}>
          DEV mode is off on the backend (settings.debug is False) — no LLM turns are being captured,
          and every /llm/debug/* endpoint 404s by design. Set DEBUG=True in Backend/.env and restart
          the backend to use this inspector.
        </p>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <h1 style={styles.h1}>RPE LLM PAYLOAD INSPECTOR</h1>
        <button type="button" style={styles.btn} onClick={() => loadAll()}>Refresh</button>
      </div>
      <p style={styles.sub}>
        DEV-only observability of the exact per-turn NPC LLM payload — measurement only, nothing here
        changes the prompt, schema, model, or conversation behavior.
      </p>

      {error && <p style={{ color: '#F85149' }}>Error: {error}</p>}

      <div style={styles.row}>
        <label style={styles.label}>
          Session
          <select
            style={styles.select}
            value={selectedSession}
            onChange={(e) => onSelectSession(e.target.value)}
          >
            {sessionIds.length === 0 && <option value="">No sessions captured yet</option>}
            {sessionIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </label>
        {loading && <span style={{ color: '#8B949E' }}>Loading…</span>}
      </div>

      {!latest && !loading && (
        <p style={{ color: '#8B949E' }}>
          No turns captured for this session yet — run a real conversation turn (session-respond) with
          the backend in DEV mode, then hit Refresh.
        </p>
      )}

      {latest && (
        <>
          <CurrentTurnCard latest={latest} />
          <PayloadBreakdown turn={latest} />
          <TurnHistory
            turns={turns}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
            compareA={compareA} compareB={compareB}
            setCompareA={setCompareA} setCompareB={setCompareB}
          />
          <TurnComparison turns={turns} compareA={compareA} compareB={compareB} />
        </>
      )}

      <ProviderComparison providers={providers} />

      {turns.length > 0 && <Findings findings={findings} />}

      <style>{`
        body { color-scheme: dark; }
      `}</style>
    </div>
  )
}

const CACHE_COLOR = { HIT: '#3FB950', MISS: '#D29922', UNKNOWN: '#8B949E' }

function CurrentTurnCard({ latest }) {
  const cache = latest.cache || { status: 'UNKNOWN', cached_tokens: null }
  return (
    <div style={styles.card}>
      <div style={styles.cardGrid}>
        <Stat label="Current provider" value={latest.provider} />
        <Stat label="Current model" value={latest.model} />
        <Stat label="Prompt version" value={latest.prompt_version || 'current'} />
        <Stat label="Reasoning effort" value={latest.reasoning_effort || 'n/a (Gemini)'} />
        <Stat label="Current turn" value={latest.turn} />
        <Stat label="Total chars" value={fmtNum(latest.totals.chars)} />
        <Stat label="Est. input tokens" value={`~${fmtNum(latest.totals.estimated_input_tokens)}`} />
        <Stat
          label="Actual input tokens"
          value={latest.totals.actual_input_tokens != null ? fmtNum(latest.totals.actual_input_tokens) : 'null (not exposed)'}
        />
        <Stat
          label="Cached input tokens"
          value={cache.cached_tokens != null ? fmtNum(cache.cached_tokens) : 'unavailable'}
        />
        <Stat
          label="Cache"
          value={<span style={{ color: CACHE_COLOR[cache.status] }}>{cache.status}</span>}
        />
        <Stat
          label="Actual output tokens"
          value={latest.output.actual_output_tokens != null ? fmtNum(latest.output.actual_output_tokens) : 'null (not exposed)'}
        />
        <Stat label="Request time" value={fmtMs(latest.timing.request_to_complete_ms)} />
        <Stat label="First response time" value="unavailable (no streaming)" />
        <Stat label="Total LLM time" value={fmtMs(latest.timing.total_llm_latency_ms)} />
        <Stat
          label="Server processing (1s res.)"
          value={latest.timing.server_processing_s != null ? `${latest.timing.server_processing_s}s` : 'unavailable'}
        />
        <Stat label="Output success" value={latest.output.success === true ? 'yes' : latest.output.success === false ? `no — ${latest.output.error}` : '—'} />
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  )
}

function PayloadBreakdown({ turn }) {
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>Payload breakdown</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Component</th>
            <th style={styles.th}>Chars</th>
            <th style={styles.th}>Est. tokens</th>
            <th style={styles.th}>% of total</th>
            <th style={styles.th}>Hash</th>
            <th style={styles.th}>vs previous turn</th>
          </tr>
        </thead>
        <tbody>
          {COMPONENT_KEYS.map((key) => {
            const c = turn.components[key]
            const diff = turn.diff_vs_previous[key]
            return (
              <tr key={key}>
                <td style={styles.td}>{labelFor(key)}{key === 'schema' && c.exact === false ? ' (approx.)' : ''}</td>
                <td style={styles.td}>{fmtNum(c.chars)}</td>
                <td style={styles.td}>~{fmtNum(c.estimated_tokens)}</td>
                <td style={styles.td}>{turn.percentages[key]}%</td>
                <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 11 }}>{c.hash}</td>
                <td style={{ ...styles.td, color: DIFF_COLOR[diff] || '#fff', fontWeight: 650 }}>{diff}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {turn.components.history && (
        <p style={styles.note}>
          History: {turn.components.history.message_count} messages ({turn.components.history.turn_count} prior turns
          + the opening line), window-capped by the backend's RECENT_TURNS_WINDOW.
        </p>
      )}
    </div>
  )
}

function labelFor(key) {
  return { system: 'System', state: 'State', history: 'History', user: 'User', schema: 'Schema' }[key]
}

function TurnHistory({ turns, expanded, toggleExpanded, compareA, compareB, setCompareA, setCompareB }) {
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>Turn history</h2>
      {[...turns].reverse().map((t) => (
        <div key={t.turn} style={styles.turnRow}>
          <div style={styles.turnHeader} onClick={() => toggleExpanded(t.turn)}>
            <span style={{ fontWeight: 650 }}>Turn {t.turn}</span>
            <span style={{ color: '#8B949E' }}>{t.provider} / {t.model} / {t.prompt_version || 'current'}{t.reasoning_effort ? ` / ${t.reasoning_effort}` : ''}</span>
            <span>{fmtNum(t.totals.chars)} chars</span>
            <span>~{fmtNum(t.totals.estimated_input_tokens)} tok</span>
            <span style={{ color: CACHE_COLOR[(t.cache || {}).status] || '#8B949E' }}>cache:{(t.cache || {}).status || 'UNKNOWN'}</span>
            <span>{fmtMs(t.timing.total_llm_latency_ms)}</span>
            <span style={{ color: t.output.success ? '#3FB950' : '#F85149' }}>
              {t.output.success ? 'ok' : `fail: ${t.output.error}`}
            </span>
            <label style={{ marginLeft: 'auto', fontSize: 11 }} onClick={(e) => e.stopPropagation()}>
              <input type="radio" name="cmpA" checked={compareA === t.turn} onChange={() => setCompareA(t.turn)} /> A
            </label>
            <label style={{ fontSize: 11 }} onClick={(e) => e.stopPropagation()}>
              <input type="radio" name="cmpB" checked={compareB === t.turn} onChange={() => setCompareB(t.turn)} /> B
            </label>
            <span>{expanded.has(t.turn) ? '▾' : '▸'}</span>
          </div>
          {expanded.has(t.turn) && <TurnDetail t={t} />}
        </div>
      ))}
    </div>
  )
}

function TurnDetail({ t }) {
  return (
    <div style={styles.turnDetail}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Component</th><th style={styles.th}>Chars</th>
            <th style={styles.th}>Tokens (est.)</th><th style={styles.th}>Diff</th>
          </tr>
        </thead>
        <tbody>
          {COMPONENT_KEYS.map((key) => (
            <tr key={key}>
              <td style={styles.td}>{labelFor(key)}</td>
              <td style={styles.td}>{fmtNum(t.components[key].chars)}</td>
              <td style={styles.td}>~{fmtNum(t.components[key].estimated_tokens)}</td>
              <td style={{ ...styles.td, color: DIFF_COLOR[t.diff_vs_previous[key]] }}>{t.diff_vs_previous[key]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={styles.h3}>Output breakdown</h3>
      {t.output.success ? (
        <>
          <p style={styles.note}>
            Total output: {fmtNum(t.output.total_chars)} chars, ~{fmtNum(t.output.estimated_output_tokens)} est. tokens,
            {' '}{t.output.actual_output_tokens != null ? `${fmtNum(t.output.actual_output_tokens)} actual tokens` : 'actual tokens: null (not exposed by this provider call)'}
          </p>
          <table style={styles.table}>
            <thead><tr><th style={styles.th}>Group</th><th style={styles.th}>Chars</th></tr></thead>
            <tbody>
              {Object.entries(t.output.groups || {}).map(([g, chars]) => (
                <tr key={g}><td style={styles.td}>{g}</td><td style={styles.td}>{fmtNum(chars)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p style={{ color: '#F85149' }}>Call failed: {t.output.error}</p>
      )}

      <h3 style={styles.h3}>Conversation-state fields (what this turn was told)</h3>
      <table style={styles.table}>
        <thead><tr><th style={styles.th}>Field</th><th style={styles.th}>Chars</th><th style={styles.th}>Changed</th><th style={styles.th}>Added/Removed</th></tr></thead>
        <tbody>
          {Object.entries(t.state_fields || {}).map(([field, v]) => (
            <tr key={field}>
              <td style={styles.td}>{field}</td>
              <td style={styles.td}>{fmtNum(v.chars)}</td>
              <td style={{ ...styles.td, color: v.changed ? '#D29922' : '#3FB950' }}>{v.changed ? 'changed' : 'unchanged'}</td>
              <td style={styles.td}>
                {v.added?.length ? `+${v.added.length}` : ''} {v.removed?.length ? `-${v.removed.length}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={styles.h3}>Timing</h3>
      <p style={styles.note}>
        request_to_complete: {fmtMs(t.timing.request_to_complete_ms)} · parse_time: {fmtMs(t.timing.parse_time_ms)} ·
        {' '}total_llm_latency: {fmtMs(t.timing.total_llm_latency_ms)} · first_response_chunk: {fmtMs(t.timing.first_response_chunk_ms)} (null — no streaming today)
        {' '}· server_processing (OpenAI completed_at-created_at, 1s resolution): {t.timing.server_processing_s != null ? `${t.timing.server_processing_s}s` : 'unavailable'}
      </p>

      <h3 style={styles.h3}>Cache / reasoning</h3>
      <p style={styles.note}>
        reasoning_effort: {t.reasoning_effort || 'n/a'} · cache: <span style={{ color: CACHE_COLOR[(t.cache || {}).status] }}>{(t.cache || {}).status || 'UNKNOWN'}</span>
        {' '}· cached_tokens: {(t.cache || {}).cached_tokens ?? 'unavailable'} · reasoning_tokens: {(t.cache || {}).reasoning_tokens ?? 'unavailable'}
      </p>
    </div>
  )
}

function TurnComparison({ turns, compareA, compareB }) {
  if (!compareA || !compareB) {
    return (
      <div style={styles.card}>
        <h2 style={styles.h2}>Turn comparison</h2>
        <p style={{ color: '#8B949E' }}>Pick A and B from two rows in Turn history above to compare them.</p>
      </div>
    )
  }
  const a = turns.find((t) => t.turn === compareA)
  const b = turns.find((t) => t.turn === compareB)
  if (!a || !b) return null
  const [lo, hi] = compareA < compareB ? [a, b] : [b, a]

  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>Turn comparison — Turn {lo.turn} vs Turn {hi.turn}</h2>
      <table style={styles.table}>
        <thead><tr><th style={styles.th}>Component</th><th style={styles.th}>Turn {lo.turn}</th><th style={styles.th}>Turn {hi.turn}</th><th style={styles.th}>Delta</th></tr></thead>
        <tbody>
          {COMPONENT_KEYS.map((key) => {
            const same = lo.components[key].hash === hi.components[key].hash
            const delta = hi.components[key].chars - lo.components[key].chars
            return (
              <tr key={key}>
                <td style={styles.td}>{labelFor(key)}</td>
                <td style={styles.td}>{fmtNum(lo.components[key].chars)} chars</td>
                <td style={styles.td}>{fmtNum(hi.components[key].chars)} chars</td>
                <td style={{ ...styles.td, color: same ? '#3FB950' : '#D29922' }}>
                  {same ? 'same' : `${delta >= 0 ? '+' : ''}${delta} chars`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ProviderComparison({ providers }) {
  if (!providers.length) return null
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>Provider x Prompt-version comparison (all captured sessions this process)</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Provider</th><th style={styles.th}>Prompt</th><th style={styles.th}>Model(s)</th><th style={styles.th}>Turns</th>
            <th style={styles.th}>Fail/Timeout</th>
            <th style={styles.th}>Avg</th><th style={styles.th}>p50</th><th style={styles.th}>p95</th><th style={styles.th}>Min</th><th style={styles.th}>Max</th>
            <th style={styles.th}>Avg input chars</th><th style={styles.th}>Avg output chars</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={`${p.provider}-${p.prompt_version}`}>
              <td style={styles.td}>{p.provider}</td>
              <td style={styles.td}>{p.prompt_version}</td>
              <td style={styles.td}>{p.models.join(', ')}</td>
              <td style={styles.td}>{p.turn_count}</td>
              <td style={{ ...styles.td, color: p.failure_count ? '#F85149' : '#3FB950' }}>{p.failure_count}/{p.timeout_count}</td>
              <td style={styles.td}>{fmtMs(p.avg_latency_ms)}</td>
              <td style={styles.td}>{fmtMs(p.p50_latency_ms)}</td>
              <td style={styles.td}>{fmtMs(p.p95_latency_ms)}</td>
              <td style={styles.td}>{fmtMs(p.min_latency_ms)}</td>
              <td style={styles.td}>{fmtMs(p.max_latency_ms)}</td>
              <td style={styles.td}>{fmtNum(p.avg_input_chars)}</td>
              <td style={styles.td}>{fmtNum(p.avg_output_chars)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Findings({ findings }) {
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>Findings (observed only — no recommendations)</h2>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {findings.map((f, i) => <li key={i} style={{ marginBottom: 6 }}>{f}</li>)}
      </ul>
    </div>
  )
}

function buildFindings(turns) {
  if (!turns.length) return []
  const out = []
  const first = turns[0]

  const systemHashes = new Set(turns.map((t) => t.components.system.hash))
  out.push(
    systemHashes.size === 1
      ? `System prompt is byte-identical across all ${turns.length} captured turns (this session's trust/escalation tone lines happened not to change tier).`
      : `System prompt changed in ${systemHashes.size - 1} of ${turns.length} turns (it embeds the trust/escalation tone sentences, which move with the score — see the report's capture-point notes).`
  )

  const schemaHashes = new Set(turns.map((t) => t.components.schema.hash))
  out.push(
    schemaHashes.size === 1
      ? `JSON response schema is identical across all ${turns.length} captured turns.`
      : `JSON response schema changed ${schemaHashes.size - 1} time(s) — unexpected for a fixed schema, worth a closer look.`
  )

  const historyCounts = turns.map((t) => t.components.history.message_count)
  const maxHistory = Math.max(...historyCounts)
  const stabilizedAtTurn = historyCounts.findIndex((c) => c === maxHistory) + 1
  out.push(
    historyCounts[historyCounts.length - 1] === maxHistory && stabilizedAtTurn < turns.length
      ? `History message count grows until turn ${stabilizedAtTurn} (${maxHistory} messages) then stays flat — consistent with the backend's fixed recent-turns window.`
      : `History message count reached ${historyCounts[historyCounts.length - 1]} messages by the last captured turn (still growing within the ${turns.length}-turn sample).`
  )

  const changedFieldCounts = {}
  turns.forEach((t) => {
    Object.entries(t.state_fields || {}).forEach(([field, v]) => {
      if (v.changed) changedFieldCounts[field] = (changedFieldCounts[field] || 0) + 1
    })
  })
  Object.entries(changedFieldCounts).forEach(([field, count]) => {
    out.push(`${field} changed in ${count} of ${turns.length} turns.`)
  })

  const avgPct = { system: 0, state: 0, history: 0, user: 0, schema: 0 }
  turns.forEach((t) => COMPONENT_KEYS.forEach((k) => { avgPct[k] += t.percentages[k] }))
  COMPONENT_KEYS.forEach((k) => { avgPct[k] = Math.round((avgPct[k] / turns.length) * 10) / 10 })
  out.push(
    `Average payload share across captured turns — system ${avgPct.system}%, schema ${avgPct.schema}%, ` +
    `history ${avgPct.history}%, state ${avgPct.state}%, user ${avgPct.user}%.`
  )

  const failed = turns.filter((t) => t.output.success === false).length
  if (failed) out.push(`${failed} of ${turns.length} captured turns failed at the provider call (see Turn history for errors).`)

  return out
}

const styles = {
  page: {
    minHeight: '100vh', background: '#0B0C0F', color: '#E6EDF3',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    padding: '28px 32px 60px', fontSize: 13.5,
  },
  headerRow: { display: 'flex', alignItems: 'center', gap: 16 },
  h1: { fontSize: 20, fontWeight: 750, margin: '0 0 4px', letterSpacing: '-0.01em' },
  h2: { fontSize: 15, fontWeight: 650, margin: '0 0 12px' },
  h3: { fontSize: 12.5, fontWeight: 650, margin: '14px 0 8px', color: '#8B949E', textTransform: 'uppercase', letterSpacing: '.04em' },
  sub: { color: '#8B949E', marginTop: 0, maxWidth: 760 },
  row: { display: 'flex', alignItems: 'center', gap: 16, margin: '16px 0' },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: '#8B949E' },
  select: {
    background: '#161B22', color: '#E6EDF3', border: '1px solid #30363D',
    borderRadius: 8, padding: '6px 10px', fontFamily: 'monospace', fontSize: 12.5, minWidth: 260,
  },
  btn: {
    background: '#21262D', color: '#E6EDF3', border: '1px solid #30363D',
    borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12.5,
  },
  card: {
    background: '#12151A', border: '1px solid #21262D', borderRadius: 14,
    padding: '18px 20px', marginBottom: 18,
  },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 },
  stat: { background: '#161B22', border: '1px solid #21262D', borderRadius: 10, padding: '10px 12px' },
  statLabel: { fontSize: 10.5, color: '#8B949E', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 },
  statValue: { fontSize: 14, fontWeight: 650, wordBreak: 'break-word' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '6px 8px', color: '#8B949E', borderBottom: '1px solid #21262D', fontWeight: 600 },
  td: { padding: '6px 8px', borderBottom: '1px solid #1A1F26' },
  note: { color: '#8B949E', fontSize: 11.5, marginTop: 10 },
  turnRow: { borderBottom: '1px solid #1A1F26' },
  turnHeader: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '10px 4px',
    cursor: 'pointer', fontSize: 12.5,
  },
  turnDetail: { padding: '4px 4px 18px 24px' },
}
