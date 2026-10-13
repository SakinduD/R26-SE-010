import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, X, User } from 'lucide-react'
import { useActiveSession } from '@/context/ActiveSessionContext'
import { rpeService } from '@/services/rpe/rpeService'

export default function FloatingSessionWidget() {
  const { activeSession, dismissSession } = useActiveSession()
  const navigate = useNavigate()

  useEffect(() => {
    if (!activeSession?.sessionId) return
    let cancelled = false
    rpeService.getSessionSummary(activeSession.sessionId)
      .then((s) => {
        if (!cancelled && s?.ended_at) {
          dismissSession()
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeSession?.sessionId, dismissSession])

  if (!activeSession) return null

  const handleResume = () => {
    navigate(`/roleplay/session-v2/${activeSession.sessionId}`)
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/80 shadow-2xl rounded-2xl p-3 text-white max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="relative flex-shrink-0 w-11 h-11 rounded-xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center overflow-hidden">
        {activeSession.npcPhoto ? (
          <img src={activeSession.npcPhoto} alt="" className="w-full h-full object-cover" />
        ) : (
          <User size={20} className="text-violet-400" />
        )}
        <span className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-zinc-900 animate-pulse" />
      </div>

      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
            Session Ongoing
          </span>
          {activeSession.duration && (
            <span className="text-[11px] text-zinc-400 tabular-nums">
              {activeSession.duration}
            </span>
          )}
        </div>
        <p className="text-xs font-semibold text-zinc-100 truncate mt-0.5">
          {activeSession.scenarioTitle || activeSession.npcName || 'Role-Play Session'}
        </p>
        <p className="text-[11px] text-zinc-400 truncate">
          Turn {activeSession.currentTurn || 1} • In progress
        </p>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={handleResume}
          className="flex items-center gap-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm"
          title="Resume Session"
        >
          <Play size={12} className="fill-current" />
          <span>Resume</span>
        </button>
        <button
          type="button"
          onClick={dismissSession}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
          title="Dismiss widget"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
