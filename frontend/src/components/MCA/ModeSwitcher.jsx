import React from 'react';
import { Users, Bot } from 'lucide-react';
import clsx from 'clsx';

/**
 * ModeSwitcher Component
 * 
 * A decoupled UI toggle for switching between Live Conversation and AI Chatbot modes.
 * Features a premium glassmorphic design with sliding animations.
 * 
 * @param {Object} props
 * @param {'live' | 'ai'} props.activeMode - The currently selected mode.
 * @param {Function} props.onModeChange - Callback function when mode changes.
 */
const ModeSwitcher = ({ activeMode, onModeChange }) => {
  return (
    <div className="relative flex p-1 bg-slate-900/80 backdrop-blur-xl rounded-xl border border-slate-700/50 w-full sm:w-fit mx-auto shadow-2xl overflow-hidden">
      {/* Sliding Highlight Background */}
      <div 
        className={clsx(
          "absolute inset-y-1 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] bg-gradient-to-r from-indigo-600 to-violet-600 rounded-lg shadow-lg shadow-indigo-500/30",
          activeMode === 'live' ? "left-1 w-[calc(50%-4px)]" : "left-[calc(50%+2px)] w-[calc(50%-4px)]"
        )}
      />
      
      <button
        onClick={() => onModeChange('live')}
        className={clsx(
          "relative z-10 flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 md:px-6 py-2 rounded-lg transition-colors duration-300 focus:outline-none",
          activeMode === 'live' ? "text-white" : "text-slate-400 hover:text-slate-200"
        )}
        aria-pressed={activeMode === 'live'}
      >
        <Users size={16} className={clsx("transition-transform duration-300", activeMode === 'live' && "scale-110")} />
        <span className="text-sm font-semibold tracking-wide whitespace-nowrap">Live Session</span>
      </button>

      <button
        onClick={() => onModeChange('ai')}
        className={clsx(
          "relative z-10 flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 md:px-6 py-2 rounded-lg transition-colors duration-300 focus:outline-none",
          activeMode === 'ai' ? "text-white" : "text-slate-400 hover:text-slate-200"
        )}
        aria-pressed={activeMode === 'ai'}
      >
        <Bot size={16} className={clsx("transition-transform duration-300", activeMode === 'ai' && "scale-110")} />
        <span className="text-sm font-semibold tracking-wide whitespace-nowrap">AI Chatbot</span>
      </button>
    </div>
  );
};

export default ModeSwitcher;
