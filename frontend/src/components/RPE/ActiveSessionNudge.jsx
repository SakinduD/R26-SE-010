import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Clock3 } from 'lucide-react'
import { rpeService } from '@/services/rpe/rpeService'
import { useAuth } from '@/lib/auth/context'

// Small app-wide reminder pill, next to the notification bell — "you left a
// role-play mid-conversation." Signed-in learners only (My Sessions itself
// is auth-only, so there's nothing to check for a guest). Refetches on
// every route change into/out of /roleplay (picks up a session that was
// just started, resumed, or finished elsewhere) AND on the
// 'ez:rpe-sessions-changed' event — trashing/restoring a session happens
// without any navigation (you're already sitting on My Sessions), so the
// route-change trigger alone never re-ran; callers dispatch that event
// right after a mutation succeeds so this updates immediately instead of
// only after the next page change.
export default function ActiveSessionNudge() {
  const { isAuthenticated } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!isAuthenticated) { setCount(0); return }
    let cancelled = false

    const refresh = () => {
      rpeService.getMyRpeSessions(false)
        .then((sessions) => {
          if (cancelled) return
          setCount(sessions.filter((s) => !s.ended_at).length)
        })
        .catch(() => { if (!cancelled) setCount(0) })
    }

    refresh()
    window.addEventListener('ez:rpe-sessions-changed', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('ez:rpe-sessions-changed', refresh)
    }
  }, [isAuthenticated, pathname])

  if (!isAuthenticated || count === 0) return null

  return (
    <button
      type="button"
      className="asn-pill"
      onClick={() => navigate('/roleplay/my-sessions')}
      title={`${count} unfinished role-play session${count > 1 ? 's' : ''}`}
    >
      <Clock3 size={13} strokeWidth={2} />
      <span className="asn-count">{count}</span>
      <span className="asn-label">in progress</span>

      <style>{`
        .asn-pill{
          display:inline-flex; align-items:center; gap:6px; font-family:inherit;
          font-size:11.5px; font-weight:650; padding:6px 12px; border-radius:100px; cursor:pointer;
          background:rgba(210,153,34,0.14); border:1px solid rgba(210,153,34,0.3); color:#B4790E;
          transition:filter .15s ease;
        }
        .asn-pill:hover{ filter:brightness(0.96); }
        :root:not([data-theme="light"]) .asn-pill{ background:rgba(210,153,34,0.16); border-color:rgba(210,153,34,0.35); color:#D29922; }
        .asn-count{ font-variant-numeric:tabular-nums; }
        @media (max-width:640px){ .asn-label{ display:none; } }
      `}</style>
    </button>
  )
}
