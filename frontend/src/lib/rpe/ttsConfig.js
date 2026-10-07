// Whether RolePlaySessionV2's speak() routes NPC dialogue through the
// backend TTS manager (Chirp 3 HD — see Backend/app/services/tts/
// tts_manager.py) or skips straight to the existing Google TTS
// (/api/gtts via speakText) / browser SpeechSynthesis path. The frontend
// has no say in which voice serves a request beyond the NPC's gender —
// that's resolved server-side — only whether to try the managed endpoint
// at all. Defaults to 'google' so this stays strictly opt-in per
// environment; set to 'managed' to use Chirp 3 HD.
const raw = (import.meta.env.VITE_RPE_TTS_PROVIDER || 'google').toLowerCase()
export const USE_MANAGED_TTS = raw !== 'google'
