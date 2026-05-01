import React, { useState, useEffect, useRef } from 'react';
import { Mic, Bot, User, Volume2, Activity, X } from 'lucide-react';
import { mcaService } from '../../services/mca/mcaService';
import clsx from 'clsx';

const AIChatbot = ({ isListening, setIsListening, hasPermission, setHasPermission, onNudge }) => {
  // Mock messages for UI demonstration
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'bot',
      text: "Hello! I am EmpowerZ, your conversation partner. This isn't just for practice or roleplay—it's a space for genuine dialogue where you can build your confidence and see real-time behavioral insights. How would you like to start our conversation today?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    },
  ]);

  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false); // New state for talking animation
  const [transcript, setTranscript] = useState("");
  const isContinuousRef = useRef(false); // Use Ref to avoid closure staleness
  const [stableVoice, setStableVoice] = useState(null); // Keep voice consistent
  const chatEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const socketRef = useRef(null);
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const transcriptRef = useRef("");

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    // Load and lock in a high-quality voice
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => v.name.includes('Google') && v.lang.startsWith('en')) ||
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

  const cleanup = () => {
    if (socketRef.current) socketRef.current.close();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    window.speechSynthesis.cancel();
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setHasPermission(true);
      setTranscript("");
      isContinuousRef.current = true; // User started a loop

      const socket = new WebSocket(mcaService.getAudioStreamUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        const startRecordingChunk = () => {
          if (socket.readyState !== WebSocket.OPEN) return;

          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
              socket.send(event.data);
            }
          };

          mediaRecorder.start();

          // Stop and restart every 1 second to create standalone chunks with headers
          setTimeout(() => {
            if (mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
              startRecordingChunk();
            }
          }, 1000);
        };

        startRecordingChunk();
        setIsListening(true);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.metrics?.nudge) {
            onNudge(data.metrics.nudge);
          }
        } catch (err) {
          console.error("Error parsing socket message:", err);
        }
      };

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            stopListening(true); // Auto-submit
          }, 2000);

          let interimTranscript = "";
          let finalTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
            else interimTranscript += event.results[i][0].transcript;
          }
          const currentTranscript = finalTranscript + interimTranscript;
          transcriptRef.current = currentTranscript;
          setTranscript(currentTranscript);
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

  const streamRef = useRef(null);

  const stopListening = (shouldSubmit = true) => {
    setIsListening(false);
    if (!shouldSubmit) isContinuousRef.current = false; // Manual stop or error

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    if (shouldSubmit) {
      const finalVal = transcriptRef.current;
      if (finalVal.trim()) {
        handleBotResponse(finalVal);
      }
      setTranscript("");
      transcriptRef.current = "";
    }
  };

  const toggleListening = () => {
    if (isListening) {
      isContinuousRef.current = false; // Manual break of the loop
      stopListening(false);
    } else {
      startListening();
    }
  };

  const handleBotResponse = async (userMessage) => {
    const newUserMsg = {
      id: Date.now(),
      type: 'user',
      text: userMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const updatedHistory = [...messages, newUserMsg];
    setMessages(updatedHistory);
    setIsLoading(true);

    try {
      const data = await mcaService.chat(userMessage, updatedHistory);
      if (!data.isSuccessful) throw new Error(data.message);

      const botMsg = {
        id: Date.now() + 1,
        type: 'bot',
        text: data.data,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, botMsg]);

      // Speak the response and restart listening if in continuous mode
      speak(data.data, () => {
        if (isContinuousRef.current) {
          console.log("Auto-restarting listening loop...");
          setTimeout(() => {
            startListening();
          }, 300); // Small natural delay
        }
      });
    } catch (error) {
      const errorMsg = {
        id: Date.now() + 1,
        type: 'bot',
        text: `Error: ${error.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

    if (stableVoice) {
      utterance.voice = stableVoice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      if (onEnd) onEnd();
    };
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="flex flex-col h-full w-full bg-card border border-border overflow-hidden shadow-2xl rounded-3xl transition-all duration-500 relative">


      {/* Chat Header */}
      <div className="px-8 py-4 border-b border-border flex items-center justify-between bg-muted/30 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <div className={clsx(
            "w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-inner relative transition-all duration-500",
            isSpeaking && "ring-4 ring-primary/20 scale-110"
          )}>
            <Bot size={22} className={clsx("text-primary transition-all", isSpeaking && "animate-bounce")} />
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
                "w-1.5 h-1.5 rounded-full",
                isSpeaking ? "bg-primary animate-pulse" : (isLoading ? "bg-amber-500 animate-pulse" : "bg-success")
              )}></div>
              <span className="text-[9px] text-card-foreground uppercase tracking-widest font-black opacity-60">
                {isSpeaking ? "Speaking_Response" : (isLoading ? "Analyzing_Voice" : "Core_Ready")}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5 text-[9px] font-black text-primary bg-primary/5 px-3 py-1.5 rounded-lg border border-primary/10 uppercase tracking-[0.2em]">
          <Volume2 size={12} />
          Voice_Link
        </div>
      </div>

      {/* Messages Area - Now with much more space */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-6 bg-gradient-to-b from-transparent to-muted/5 custom-scrollbar w-full">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={clsx(
              "flex gap-3 max-w-[90%] transition-all duration-500 animate-in fade-in slide-in-from-bottom-4",
              msg.type === 'user' ? "ml-auto flex-row-reverse" : ""
            )}
          >
            <div className={clsx(
              "w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center border transition-all duration-500 shadow-sm font-bold",
              msg.type === 'user'
                ? "bg-secondary/10 border-secondary/20 text-secondary"
                : "bg-primary/10 border-primary/20 text-primary"
            )}>
              {msg.type === 'user' ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className={clsx(
              "px-5 py-3 rounded-2xl text-[13px] leading-relaxed shadow-sm font-medium border break-words overflow-hidden min-w-0",
              msg.type === 'user'
                ? "bg-secondary text-white border-secondary/20 rounded-tr-none"
                : "bg-primary text-white border-primary/20 rounded-tl-none"
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

      {/* COMPACT Voice Capture Section */}
      <div className="px-6 py-5 bg-muted/40 border-t border-border backdrop-blur-md relative overflow-hidden">
        {/* Subtle Background Glow when listening */}
        {isListening && (
          <div className="absolute inset-0 bg-primary/5 animate-pulse pointer-events-none"></div>
        )}

        <div className="flex items-center gap-6 relative z-10">
          {/* Main Control */}
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <button
              onClick={toggleListening}
              disabled={isLoading}
              className={clsx(
                "w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-500 relative group border shadow-xl",
                isListening
                  ? "bg-destructive/10 border-destructive/30 text-destructive"
                  : "bg-primary text-white border-primary/30 shadow-primary/30 hover:scale-105 active:scale-95 disabled:opacity-50"
              )}
            >
              {isListening ? (
                <div className="w-5 h-5 bg-destructive rounded-md animate-pulse shadow-sm"></div>
              ) : (
                <Mic size={24} className="relative z-10 drop-shadow-md" />
              )}
            </button>
            <span className="text-[8px] font-black text-card-foreground/60 uppercase tracking-[0.2em]">
              {isListening ? "STOP" : "TALK"}
            </span>
          </div>

          {/* Transcript & Visualization Area */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            {/* Status & Waveform Row */}
            <div className="flex items-center justify-between">
              <div className={clsx(
                "flex items-center gap-2 px-2.5 py-1 rounded-md border transition-all duration-300",
                isListening ? "bg-destructive/10 border-destructive/20 text-destructive" : "bg-muted/80 border-border text-muted-foreground"
              )}>
                <div className={clsx("w-1.5 h-1.5 rounded-full", isListening ? "bg-destructive animate-ping" : "bg-muted-foreground/30")}></div>
                <span className="text-[8px] font-black uppercase tracking-widest">
                  {isListening ? "Listening" : "Idle"}
                </span>
              </div>

              <div className="flex items-center gap-1 h-5 overflow-hidden">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((i) => (
                  <div
                    key={i}
                    className={clsx(
                      "w-0.5 rounded-full transition-all duration-500",
                      isListening ? "bg-primary/50" : "bg-muted-foreground/10 h-0.5"
                    )}
                    style={{
                      height: isListening ? `${Math.random() * 100}%` : '2px',
                      transitionDelay: `${i * 20}ms`
                    }}
                  ></div>
                ))}
              </div>
            </div>

            {/* Compact Transcript Preview */}
            <div className="bg-background/40 p-3 rounded-xl border border-border/50 min-h-[50px] flex items-center">
              <p className={clsx(
                "text-[13px] font-medium leading-relaxed italic transition-all duration-300 line-clamp-2",
                isListening ? "text-foreground opacity-100" : "text-muted-foreground opacity-50"
              )}>
                {isListening ? (transcript || "I'm listening...") : "Awaiting input..."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

  );
};

export default AIChatbot;
