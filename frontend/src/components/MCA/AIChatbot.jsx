import React, { useState, useEffect, useRef } from 'react';
import { Mic, Bot, User, Volume2 } from 'lucide-react';
import clsx from 'clsx';

const AIChatbot = () => {
  // Mock messages for UI demonstration
  const [messages, setMessages] = useState([
    { id: 1, type: 'bot', text: "Hello! I'm your AI soft skills coach. Today we'll practice handling tough questions in a workplace setting.", timestamp: '12:00' },
    { id: 2, type: 'user', text: "That sounds great. I'm ready to start.", timestamp: '12:01' },
    { id: 3, type: 'bot', text: "Excellent. Imagine you're in a meeting and someone challenges your project timeline. How do you respond?", timestamp: '12:01' },
  ]);
  
  const [isListening, setIsListening] = useState(true);
  const chatEndRef = useRef(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-card border border-border overflow-hidden shadow-sm rounded-2xl transition-all duration-500">
      {/* Chat Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
            <Bot size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground tracking-tight">Intelligence Core</h3>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-success"></div>
              <span className="text-[10px] text-card-foreground uppercase tracking-widest font-bold">Bot_Ready</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-black text-primary bg-primary/5 px-3 py-1.5 rounded-lg border border-primary/10 uppercase tracking-widest">
          <Volume2 size={12} />
          Voice_Interface
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide min-h-[300px]">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={clsx(
              "flex gap-3 max-w-[90%] transition-all duration-300 animate-in fade-in slide-in-from-bottom-2",
              msg.type === 'user' ? "ml-auto flex-row-reverse" : ""
            )}
          >
            <div className={clsx(
              "w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center border transition-all duration-300 shadow-sm font-bold",
              msg.type === 'user' 
                ? "bg-secondary/10 border-secondary/20 text-secondary" 
                : "bg-primary/10 border-primary/20 text-primary"
            )}>
              {msg.type === 'user' ? <User size={16} /> : <Bot size={16} />}
            </div>
            <div className={clsx(
              "px-5 py-3.5 rounded-2xl text-[13px] leading-relaxed shadow-sm font-medium border",
              msg.type === 'user' 
                ? "bg-secondary text-white border-secondary/20 rounded-tr-none" 
                : "bg-primary text-white border-primary/20 rounded-tl-none"
            )}>
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Voice Capture Section */}
      <div className="p-6 bg-muted/20 border-t border-border">
        <div className="flex flex-col items-center gap-6">
          
          {/* Waveform Visualization */}
          <div className="flex items-center gap-2 h-10">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => (
              <div
                key={i}
                className={clsx(
                  "w-1 rounded-full transition-all duration-300",
                  isListening ? "animate-[bounce_1s_infinite] bg-primary/80" : "h-1 opacity-20 bg-muted-foreground"
                )}
                style={{ 
                  animationDelay: `${i * 0.05}s`,
                  height: isListening ? `${8 + Math.sin(i) * 15 + Math.random() * 10}px` : '4px'
                }}
              ></div>
            ))}
          </div>

          {/* Voice Button */}
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => setIsListening(!isListening)}
              className={clsx(
                "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500 group relative border shadow-sm",
                isListening 
                  ? "bg-destructive/10 border-destructive/30 text-destructive scale-105" 
                  : "bg-primary text-white border-primary/30 shadow-primary/20 hover:scale-105 active:scale-95"
              )}
            >
              {isListening && (
                <div className="absolute inset-0 rounded-full bg-destructive/20 animate-ping"></div>
              )}
              <Mic size={32} className={clsx("relative z-10 transition-transform duration-300", isListening && "scale-110")} />
            </button>
            <div className="flex flex-col items-center">
              <span className={clsx(
                "text-[10px] font-black uppercase tracking-widest transition-colors duration-300",
                isListening ? "text-destructive" : "text-card-foreground"
              )}>
                {isListening ? "Listening_Active" : "Click_To_Speak"}
              </span>
            </div>
          </div>

          <div className="text-[9px] text-card-foreground font-black bg-muted/50 px-5 py-2.5 rounded-lg border border-border uppercase tracking-[0.2em] opacity-80">
            Voice_Locked • No_Text_Input
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIChatbot;
