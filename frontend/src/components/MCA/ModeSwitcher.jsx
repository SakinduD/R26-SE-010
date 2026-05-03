import React from 'react';
import { Users, Bot } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';

const ModeSwitcher = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeMode = searchParams.get('mode') || 'live';

  const onModeChange = (mode) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('mode', mode);
    setSearchParams(newParams);
  };

  return (
    <div className="relative flex p-1.5 bg-muted border border-border rounded-xl w-full sm:w-fit mx-auto shadow-sm overflow-hidden">
      {/* Sliding Highlight Background */}
      <div 
        className={clsx(
          "absolute inset-y-1.5 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] rounded-lg shadow-sm",
          activeMode === 'live' 
            ? "left-1.5 w-[calc(50%-6px)] bg-secondary" 
            : "left-[calc(50%+3px)] w-[calc(50%-6px)] bg-primary"
        )}
      />
      
      <button
        onClick={() => onModeChange('live')}
        className={clsx(
          "relative z-10 flex-1 sm:flex-none flex items-center justify-center gap-2.5 px-6 md:px-8 py-2.5 rounded-lg transition-colors duration-300 focus:outline-none",
          activeMode === 'live' ? "text-white font-black" : "text-card-foreground hover:text-foreground font-bold"
        )}
        aria-pressed={activeMode === 'live'}
      >
        <Users size={16} className={clsx("transition-transform duration-300", activeMode === 'live' && "scale-110")} />
        <span className="text-xs uppercase tracking-widest whitespace-nowrap">Live Session</span>
      </button>

      <button
        onClick={() => onModeChange('ai')}
        className={clsx(
          "relative z-10 flex-1 sm:flex-none flex items-center justify-center gap-2.5 px-6 md:px-8 py-2.5 rounded-lg transition-colors duration-300 focus:outline-none",
          activeMode === 'ai' ? "text-white font-black" : "text-card-foreground hover:text-foreground font-bold"
        )}
        aria-pressed={activeMode === 'ai'}
      >
        <Bot size={16} className={clsx("transition-transform duration-300", activeMode === 'ai' && "scale-110")} />
        <span className="text-xs uppercase tracking-widest whitespace-nowrap">AI Chatbot</span>
      </button>
    </div>
  );
};

export default ModeSwitcher;
