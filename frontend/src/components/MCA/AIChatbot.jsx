import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Mic, Bot, User, Volume2, Activity, X, Play, Square } from 'lucide-react';
import { mcaService } from '../../services/mca/mcaService';
import clsx from 'clsx';

const AIChatbot = ({ isListening, setIsListening, hasPermission, setHasPermission, onNudge, metrics, stopSignal, startSignal, isCameraActive, onSessionStateChange }) => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'bot',
      text: "Hello! I am EmpowerZ, your conversation partner. This isn't just for practice or roleplay—it's a space for genuine dialogue where you can build your confidence and see real-time behavioral insights. How would you like to start our conversation today?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    },
  ]);

  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');

  // Session state
  const [sessionId, setSessionId] = useState(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionStarting, setSessionStarting] = useState(false);
  const [sessionEnding, setSessionEnding] = useState(false);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [friendlyId, setFriendlyId] = useState(null);
  const sessionTimerRef = useRef(null);

  useEffect(() => {
    if (onSessionStateChange) {
      onSessionStateChange(sessionActive, sessionStarting, sessionEnding);
    }
  }, [sessionActive, sessionStarting, sessionEnding, onSessionStateChange]);

  const lastProcessedStart = useRef(startSignal);
  const lastProcessedStop = useRef(stopSignal);

  useEffect(() => {
    if (startSignal && startSignal !== lastProcessedStart.current) {
      lastProcessedStart.current = startSignal;
      if (!sessionActive && !sessionStarting) {
        handleStartSession();
      }
    }
  }, [startSignal, sessionActive, sessionStarting]);

  useEffect(() => {
    if (stopSignal && stopSignal !== lastProcessedStop.current) {
      lastProcessedStop.current = stopSignal;
      if (sessionActive) {
        handleEndSession();
      }
    }
  }, [stopSignal, sessionActive]);

  // Nudge log accumulated during the session (for persistence on end)
  const nudgeLogRef = useRef([]);
  const emotionCountsRef = useRef({}); // Track distribution for scoring
  const chatTurnsRef = useRef(0);

  const isContinuousRef = useRef(false);
  const [stableVoice, setStableVoice] = useState(null);
  const chatEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const socketRef = useRef(null);
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const transcriptRef = useRef('');
  const recordRestartTimeoutRef = useRef(null);
  const streamRef = useRef(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Load and lock in a high-quality TTS voice
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(v => v.name.includes('Google') && v.lang.startsWith('en')) ||
        voices.find(v => v.lang.startsWith('en')) ||
        voices[0];
      if (preferred) setStableVoice(preferred);
    };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    return () => {
      cleanup();
    };
  }, []);

  // React to stopSignal (e.g. when the user switches to Live mode)
  useEffect(() => {
    if (stopSignal && isListening) {
      isContinuousRef.current = false;
      stopListening(false);
    }
  }, [stopSignal]);

  // Session helpers

  const handleStartSession = async () => {
    if (sessionActive || sessionStarting) return;
    if (!isCameraActive) {
      toast.error("Please turn on your camera first to start the AI session.", {
        description: "Intelligence core needs visual metrics for behavioral insights."
      });
      return;
    }
    setSessionStarting(true);
    try {
      const session = await mcaService.startSession('ai');
      if (session.id && session.status === 'active') {
        setSessionId(session.id);
        setFriendlyId(session.friendly_id);
        setSessionActive(true);
        nudgeLogRef.current = [];
        emotionCountsRef.current = {};
        chatTurnsRef.current = 0;
        setSessionDuration(0);

        // Start duration timer
        sessionTimerRef.current = setInterval(() => {
          setSessionDuration(prev => prev + 1);
        }, 1000);

        toast.success("AI session started successfully.");
        addBotMessage("Great — I've started a new session for you. Let's begin! Tell me something you'd like to work on or talk about.");
      } else {
        toast.error("Failed to initialize AI session on server.");
        setSessionActive(false);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred while connecting to the AI core.";
      toast.error("AI Core Connection Failed", {
        description: errorMsg
      });
      setSessionId(null);
      setSessionActive(false);
    } finally {
      setSessionStarting(false);
    }
  };

  const handleEndSession = async () => {
    if (!sessionActive || sessionEnding) return;
    setSessionEnding(true);

    // Stop mic if active
    if (isListening) {
      isContinuousRef.current = false;
      stopListening(false);
    }

    // Persist session results
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }

    if (sessionId) {
      try {
        // Calculate distribution
        const total = Object.values(emotionCountsRef.current).reduce((a, b) => a + b, 0);
        const distribution = {};
        if (total > 0) {
          Object.entries(emotionCountsRef.current).forEach(([emo, count]) => {
            distribution[emo.toLowerCase()] = count / total;
          });
        }

        const resultData = {
          total_nudges: nudgeLogRef.current.length,
          chat_turns: chatTurnsRef.current,
          final_emotion: metrics.emotion
        };

        const mechanicalAverages = {
          avg_ear: metrics.ear,
          avg_mar: metrics.mar,
          avg_pitch: metrics.pose.pitch
        };

        const res = await mcaService.endSession(
          sessionId,
          nudgeLogRef.current,
          resultData,
          chatTurnsRef.current,
          distribution,
          mechanicalAverages
        );

        if (res.id && res.status === 'completed') {
          toast.success("AI session ended and scores calculated.");
          // Redirect to self-rating feedback form (same as live session)
          const redirectUrl = `/analytics/sessions/${sessionId}/feedback?friendlyId=${encodeURIComponent(friendlyId)}`;
          setTimeout(() => navigate(redirectUrl), 1500);
        } else {
          toast.error("Session ended but data persistence may be incomplete.");
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Network synchronization failed.";
        toast.error("Session Finalization Failed", {
          description: errorMsg
        });
      } finally {
        setSessionEnding(false);
      }
    } else {
      setSessionEnding(false);
    }

    setSessionActive(false);
    setSessionId(null);
    addBotMessage("Session ended! Great work. Your session data has been saved. Feel free to start a new session whenever you're ready.");
  };

  const addBotMessage = (text) => {
    const msg = {
      id: Date.now(),
      type: 'bot',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, msg]);
  };

  // Audio / WebSocket

  const cleanup = () => {
    if (socketRef.current) socketRef.current.close();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (recognitionRef.current) recognitionRef.current.stop();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (recordRestartTimeoutRef.current) {
      clearTimeout(recordRestartTimeoutRef.current);
      recordRestartTimeoutRef.current = null;
    }
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    window.speechSynthesis.cancel();

    // Formal end for backend if unmounting during active session
    if (sessionActive && sessionId) {
      const resultData = {
        total_nudges: nudgeLogRef.current.length,
        chat_turns: chatTurnsRef.current,
        unmounted: true
      };
      mcaService.endSession(sessionId, nudgeLogRef.current, resultData, chatTurnsRef.current)
        .catch(err => console.error('[AIChatbot] Unmount end failed:', err));
    }
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setHasPermission(true);
      setTranscript('');
      isContinuousRef.current = true;

      // Build WS URL with real JWT token
      const wsUrl = mcaService.getAudioStreamUrl();
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        const startRecordingChunk = () => {
          if (socket.readyState !== WebSocket.OPEN) return;

          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
              // Send visual metrics first to enable Affect Fusion
              if (metrics) {
                socket.send(JSON.stringify({
                  type: 'visual_metrics',
                  metrics: { ear: metrics.ear, mar: metrics.mar, pose: metrics.pose },
                }));
              }
              socket.send(event.data);
            }
          };

          mediaRecorder.start();

          if (recordRestartTimeoutRef.current) clearTimeout(recordRestartTimeoutRef.current);
          recordRestartTimeoutRef.current = setTimeout(() => {
            if (mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
              startRecordingChunk();
            }
          }, 1000);
        };

        startRecordingChunk();
        setIsListening(true);
      };

      socket.onerror = (err) => {
        console.error('[AIChatbot] WebSocket error:', err);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Propagate fusion nudges to parent (MultimodalEngine nudge stack)
          if (data.metrics.emotion) {
            const emo = data.metrics.emotion.toLowerCase();
            emotionCountsRef.current[emo] = (emotionCountsRef.current[emo] || 0) + 1;
          }

          if (data.metrics?.nudge) {
            const nudgeEntry = {
              message: data.metrics.nudge,
              category: data.metrics.nudge_category || 'fusion',
              severity: data.metrics.nudge_severity || 'info',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
            // Accumulate in log for session persistence
            nudgeLogRef.current = [...nudgeLogRef.current, nudgeEntry];
            // Fire the visual nudge toast in the parent
            onNudge(nudgeEntry.message, nudgeEntry.category, nudgeEntry.severity);
          }
        } catch (err) {
          console.error('Error parsing socket message:', err);
        }
      };

      // Speech recognition for transcription
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            stopListening(true); // Auto-submit after 2s silence
          }, 2000);

          let interimTranscript = '';
          let finalTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
            else interimTranscript += event.results[i][0].transcript;
          }
          const current = finalTranscript + interimTranscript;
          transcriptRef.current = current;
          setTranscript(current);
        };

        recognition.onerror = (e) => {
          console.error(e);
          stopListening(false);
        };

        recognition.start();
        recognitionRef.current = recognition;
      }
    } catch (err) {
      console.error(err);
    }
  };

  const stopListening = (shouldSubmit = true) => {
    setIsListening(false);
    if (!shouldSubmit) isContinuousRef.current = false;

    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (recordRestartTimeoutRef.current) { clearTimeout(recordRestartTimeoutRef.current); recordRestartTimeoutRef.current = null; }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (mediaRecorderRef.current) { mediaRecorderRef.current.stop(); mediaRecorderRef.current = null; }
    if (socketRef.current) { socketRef.current.close(); socketRef.current = null; }
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }

    if (shouldSubmit) {
      const finalVal = transcriptRef.current;
      if (finalVal.trim()) handleBotResponse(finalVal);
      setTranscript('');
      transcriptRef.current = '';
    }
  };

  const toggleListening = () => {
    if (!sessionActive) {
      // Prompt user to start a session first
      return;
    }
    if (isListening) {
      isContinuousRef.current = false;
      stopListening(false);
    } else {
      startListening();
    }
  };

  // Chat response

  const handleBotResponse = async (userMessage) => {
    const newUserMsg = {
      id: Date.now(),
      type: 'user',
      text: userMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedHistory = [...messages, newUserMsg];
    setMessages(updatedHistory);
    setIsLoading(true);
    chatTurnsRef.current += 1;

    try {
      const data = await mcaService.chat(
        userMessage,
        updatedHistory,
        { metrics },
        sessionId, // pass active session ID
      );
      if (!data.isSuccessful) throw new Error(data.message);

      const botMsg = {
        id: Date.now() + 1,
        type: 'bot',
        text: data.data,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages(prev => [...prev, botMsg]);

      speak(data.data, () => {
        if (isContinuousRef.current) {
          setTimeout(() => startListening(), 300);
        }
      });
    } catch (error) {
      console.error('[AIChatbot] Response Error:', error);

      let friendlyMsg = "I'm having a little trouble connecting to my intelligence engine right now. Please try again in a moment.";
      const errText = error.message.toLowerCase();

      if (errText.includes('rate limit') || errText.includes('quota') || errText.includes('429')) {
        friendlyMsg = "I've been doing a lot of thinking lately! My processing quota is temporarily full. Please wait a minute and try again.";
      } else if (errText.includes('timeout') || errText.includes('network') || errText.includes('offline')) {
        friendlyMsg = "It looks like our connection was interrupted. Check your internet and try speaking to me again.";
      } else if (errText.includes('token') || errText.includes('auth') || errText.includes('401') || errText.includes('403')) {
        friendlyMsg = "Your secure session has expired. Please refresh the page to keep our conversation going.";
      } else if (errText.includes('busy') || errText.includes('overloaded') || errText.includes('503')) {
        friendlyMsg = "My circuits are a bit overloaded with other conversations right now. Give me a few seconds to catch my breath!";
      }

      const errorMsg = {
        id: Date.now() + 1,
        type: 'bot',
        text: friendlyMsg,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const speak = (text, onEnd) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (stableVoice) utterance.voice = stableVoice;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => { setIsSpeaking(false); if (onEnd) onEnd(); };
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  // Render

  return (
    <div className="flex flex-col h-full w-full bg-card border border-border overflow-hidden shadow-2xl rounded-3xl transition-all duration-500 relative">

      {/* Chat Header */}
      <div className="px-8 py-4 border-b border-border flex items-center justify-between bg-muted/30 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <div className={clsx(
            'w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-inner relative transition-all duration-500',
            isSpeaking && 'ring-4 ring-primary/20 scale-110'
          )}>
            <Bot size={22} className={clsx('text-primary transition-all', isSpeaking && 'animate-bounce')} />
            {isSpeaking && (
              <span className="absolute -inset-1 rounded-xl bg-primary/20 animate-ping opacity-30"></span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] font-black text-foreground tracking-tight uppercase">Intelligence Core</h3>
              {isSpeaking && (
                <div className="flex gap-0.5 h-3 items-end mb-0.5">
                  <div className="w-0.5 h-full bg-primary animate-[pulse_1s_infinite]"></div>
                  <div className="w-0.5 h-2/3 bg-primary animate-[pulse_1.2s_infinite]"></div>
                  <div className="w-0.5 h-full bg-primary animate-[pulse_0.8s_infinite]"></div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className={clsx(
                'w-1.5 h-1.5 rounded-full',
                isSpeaking ? 'bg-primary animate-pulse' : (isLoading ? 'bg-amber-500 animate-pulse' : (sessionActive ? 'bg-success' : 'bg-muted-foreground'))
              )}></div>
              <span className="text-[9px] text-card-foreground uppercase tracking-widest font-black opacity-60">
                {isSpeaking ? 'Speaking_Response' : (isLoading ? 'Analyzing_Voice' : (sessionActive ? 'Session_Active' : 'No_Session'))}
              </span>
            </div>
          </div>
          {sessionActive && (
            <div className="flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full animate-in fade-in zoom-in duration-500">
              <div className="w-1 h-1 rounded-full bg-primary animate-pulse" />
              <span className="text-[9px] font-black text-primary tracking-widest">
                {friendlyId || 'SESSION'} • {Math.floor(sessionDuration / 60)}:{(sessionDuration % 60).toString().padStart(2, '0')}
              </span>
            </div>
          )}
        </div>

        {/* Session Status & Voice Link */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2.5 text-[9px] font-black text-primary bg-primary/5 px-3 py-1.5 rounded-lg border border-primary/10 uppercase tracking-[0.2em]">
            <Volume2 size={12} />
            Voice_Link
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-6 bg-gradient-to-b from-transparent to-muted/5 custom-scrollbar w-full">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={clsx(
              'flex gap-3 max-w-[90%] transition-all duration-500 animate-in fade-in slide-in-from-bottom-4',
              msg.type === 'user' ? 'ml-auto flex-row-reverse' : ''
            )}
          >
            <div className={clsx(
              'w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center border transition-all duration-500 shadow-sm font-bold',
              msg.type === 'user'
                ? 'bg-secondary/10 border-secondary/20 text-secondary'
                : 'bg-primary/10 border-primary/20 text-primary'
            )}>
              {msg.type === 'user' ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className={clsx(
              'px-5 py-3 rounded-2xl text-[13px] leading-relaxed shadow-sm font-medium border break-words overflow-hidden min-w-0',
              msg.type === 'user'
                ? 'bg-secondary text-white border-secondary/20 rounded-tr-none'
                : 'bg-primary text-white border-primary/20 rounded-tl-none'
            )}>
              {msg.text}
              <div className="mt-1 text-[8px] opacity-40 font-black uppercase tracking-widest">
                {msg.timestamp}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Bot size={14} className="text-primary/40" />
            </div>
            <div className="bg-muted/50 px-5 py-3 rounded-2xl rounded-tl-none border border-border/50 text-[13px]">
              <div className="flex gap-1.5 py-1">
                <span className="w-1 h-1 bg-primary/40 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1 h-1 bg-primary/40 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1 h-1 bg-primary/40 rounded-full animate-bounce"></span>
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Voice Capture Section */}
      <div className="px-6 py-5 bg-muted/40 border-t border-border backdrop-blur-md relative overflow-hidden">
        {isListening && (
          <div className="absolute inset-0 bg-primary/5 animate-pulse pointer-events-none"></div>
        )}

        {/* No overlay - session managed globally */}

        {sessionActive ? (
          <div className="flex items-center gap-6 relative z-10">
            {/* Main Mic Control */}
            <div className="flex flex-col items-center gap-2 flex-shrink-0">
              <button
                id="mca-chatbot-mic-btn"
                onClick={toggleListening}
                disabled={isLoading}
                className={clsx(
                  'w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-500 relative group border shadow-xl',
                  isListening
                    ? 'bg-destructive/10 border-destructive/30 text-destructive'
                    : 'bg-primary text-white border-primary/30 shadow-primary/30 hover:scale-105 active:scale-95 disabled:opacity-50'
                )}
              >
                {isListening ? (
                  <div className="w-5 h-5 bg-destructive rounded-md animate-pulse shadow-sm"></div>
                ) : (
                  <Mic size={24} className="relative z-10 drop-shadow-md" />
                )}
              </button>
              <span className="text-[8px] font-black text-card-foreground/60 uppercase tracking-[0.2em]">
                {isListening ? 'STOP' : 'TALK'}
              </span>
            </div>

            {/* Transcript & Waveform */}
            <div className="flex-1 flex flex-col gap-3 min-w-0">
              <div className="flex items-center justify-between">
                <div className={clsx(
                  'flex items-center gap-2 px-2.5 py-1 rounded-md border transition-all duration-300',
                  isListening ? 'bg-destructive/10 border-destructive/20 text-destructive' : 'bg-muted/80 border-border text-muted-foreground'
                )}>
                  <div className={clsx('w-1.5 h-1.5 rounded-full', isListening ? 'bg-destructive animate-ping' : 'bg-muted-foreground/30')}></div>
                  <span className="text-[8px] font-black uppercase tracking-widest">
                    {isListening ? 'Listening' : 'Idle'}
                  </span>
                </div>

                <div className="flex items-center gap-1 h-5 overflow-hidden">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((i) => (
                    <div
                      key={i}
                      className={clsx(
                        'w-0.5 rounded-full transition-all duration-500',
                        isListening ? 'bg-primary/50' : 'bg-muted-foreground/10 h-0.5'
                      )}
                      style={{
                        height: isListening ? `${Math.random() * 100}%` : '2px',
                        transitionDelay: `${i * 20}ms`,
                      }}
                    ></div>
                  ))}
                </div>
              </div>

              <div className="bg-background/40 p-3 rounded-xl border border-border/50 min-h-[50px] flex items-center">
                <p className={clsx(
                  'text-[13px] font-medium leading-relaxed italic transition-all duration-300 line-clamp-2',
                  isListening ? 'text-foreground opacity-100' : 'text-muted-foreground opacity-50'
                )}>
                  {isListening ? (transcript || "I'm listening...") : 'Awaiting input...'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center p-6 bg-muted/20 rounded-xl border border-border/50">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-[0.2em]">
              Start Session to Begin Interaction
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIChatbot;
