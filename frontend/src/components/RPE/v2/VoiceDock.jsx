import { Mic, MicOff, Send, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

// The "your turn" control — same underlying voice pipeline as V1
// (useVoiceRecorder: isListening/isTranscribing/liveTranscript/etc, wired
// through identical handlers from the orchestrator), redesigned to read as
// a voice conversation control rather than a chat input box. Typing still
// always works — the textarea is never removed, just visually secondary to
// the mic while nothing's been said yet.
//
// No longer renders its own static "Your turn" label — that's
// ConversationStateIndicatorV2's job now (one shared state cue instead of
// a label here that never actually changed between ready/listening/review).
//
// `disabled` is the parent's own voiceState !== 'manual' check, not a
// combination of isLoading/sessionComplete computed in here — the old
// isLoading-only check meant the dock had no way to know the NPC was still
// speaking (isLoading was never true during the opening line's own speech,
// since that path doesn't go through handleSendWithText), so the mic/send
// controls briefly looked active while the avatar was still talking.
// `isLoading` is still passed separately, only for the send button's own
// spinner icon.
export default function VoiceDock({
  userInput, onInputChange, inputRef,
  isListening, isTranscribing, micAvailable, usesLiveCaptions,
  onToggleMic, onSend, onKeyDown,
  isLoading, disabled, lowConfidence,
}) {
  const showWave = isListening && !userInput.trim()

  return (
    <div className="rps2-panel-inner">
      <div className={cn('rps2-dock', isListening && 'listening')}>
        <button
          type="button"
          className={cn('rps2-mic-btn', isListening && 'active')}
          onClick={onToggleMic}
          disabled={!micAvailable || isTranscribing || disabled}
          title={isListening ? 'Stop and review before sending' : 'Tap to talk'}
          aria-label={isListening ? 'Stop listening' : 'Start talking'}
        >
          {isListening && <span className="rps2-mic-ring" aria-hidden />}
          {isListening ? <MicOff size={16} strokeWidth={1.8} /> : <Mic size={16} strokeWidth={1.8} />}
        </button>

        {showWave ? (
          <>
            <div className="rps2-wave" aria-hidden>
              <span /><span /><span /><span /><span /><span /><span />
            </div>
            <span className="rps2-listening-label">Listening…</span>
          </>
        ) : (
          <textarea
            ref={inputRef}
            rows={1}
            value={userInput}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={isListening || isTranscribing || disabled}
            placeholder={
              isTranscribing
                ? 'Transcribing…'
                : micAvailable
                  ? 'Speak naturally, or type your response…'
                  : 'Type your response…'
            }
            className="rps2-dock-input"
            aria-label="Your response"
          />
        )}

        <button
          type="button"
          onClick={onSend}
          disabled={!userInput.trim() || isTranscribing || disabled}
          className="rps2-send-btn"
          aria-label="Send response"
        >
          {isLoading ? <Loader2 size={16} strokeWidth={1.8} className="rps2-spin" /> : <Send size={15} strokeWidth={1.8} />}
        </button>
      </div>

      {!micAvailable && (
        <p className="rps2-dock-hint">Voice input isn't available on this browser — type your response instead.</p>
      )}
      {isListening && userInput.trim() && !usesLiveCaptions && (
        <p className="rps2-dock-hint">Listening… I'll fill this in once you stop.</p>
      )}
      {!isListening && !isTranscribing && lowConfidence && userInput.trim() && (
        <p className="rps2-low-confidence">
          <AlertTriangle size={12} strokeWidth={2} />
          Wasn't fully sure I heard that right — worth a quick read before sending.
        </p>
      )}
    </div>
  )
}
