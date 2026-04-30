import React, { useState } from 'react';
import ModeSwitcher from '../../components/MCA/ModeSwitcher';

/**
 * MultimodalEngine Page
 * 
 * The main container for the Multimodal Communication Analysis (MCA) feature.
 * Manages the current mode state and renders corresponding components.
 */
const MultimodalEngine = () => {
  const [activeMode, setActiveMode] = useState('live');

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col items-center pt-8 md:pt-12 pb-20 px-4 md:px-8 font-sans">
      <div className="max-w-6xl w-full space-y-8">
        {/* Header Section */}
        <div className="text-center space-y-3">
          <div className="inline-block px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-bold uppercase tracking-widest">
            Beta - MCA Engine
          </div>
          <h1 className="text-2xl md:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400">
            Multimodal Communication Engine
          </h1>
          <p className="text-slate-400 text-sm max-w-xl mx-auto">
            Analyze non-verbal cues in real-time to enhance your soft skills and communication effectiveness.
          </p>
        </div>

        {/* Mode Switcher Section */}
        <div className="py-2">
          <ModeSwitcher activeMode={activeMode} onModeChange={setActiveMode} />
        </div>

        {/* Mode-Specific Content Area */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-violet-600 rounded-2xl blur opacity-10 group-hover:opacity-20 transition duration-1000"></div>
          <div className="relative p-4 md:p-8 bg-slate-900/50 backdrop-blur-sm ring-1 ring-slate-800/50 rounded-2xl flex flex-col items-center border border-slate-700/30 shadow-3xl">
            
            {/* Capturing Window (Webcam Placeholder) */}
            <div className="w-full max-w-5xl aspect-video relative overflow-hidden bg-slate-950 rounded-xl border border-slate-800 flex flex-col items-center justify-center group/window transition-all duration-500 hover:border-slate-700/50">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-500/5 via-transparent to-transparent"></div>
              
              <div className="relative flex flex-col items-center gap-4">
                <div className="p-10 border-2 border-dashed border-slate-800 rounded-2xl text-slate-700 font-mono text-[10px] uppercase tracking-[0.2em] animate-pulse group-hover/window:border-slate-700 group-hover/window:text-slate-600 transition-colors">
                  [ Component Placeholder: MCA-{activeMode === 'live' ? '03/04' : 'BOT-INT'} ]
                </div>
                <div className="text-center">
                  <h2 className="text-lg font-semibold text-slate-200">
                    {activeMode === 'live' ? 'Live Session Stream' : 'AI Assistant Interface'}
                  </h2>
                  <p className="text-xs text-slate-500 italic mt-1">
                    {activeMode === 'live' 
                      ? 'Ready to analyze facial landmarks and vocal metrics' 
                      : 'Voice-enabled AI interaction ready for behavioral tracking'}
                  </p>
                </div>
              </div>

              {/* Status Indicators */}
              <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center px-4 py-2 bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-lg opacity-0 group-hover/window:opacity-100 transition-opacity">
                <div className="flex gap-4">
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-600"></div>
                    Webcam: Off
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-600"></div>
                    Mic: Off
                  </div>
                </div>
                <div className="text-[10px] text-indigo-400 font-mono">
                  LATENCY: --- MS
                </div>
              </div>
            </div>

            {/* Bottom Meta Info */}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <div className="flex items-center gap-2 text-[10px] text-slate-500 bg-slate-800/30 px-3 py-1.5 rounded-full border border-slate-700/30">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></div>
                Privacy: Edge Computing Only
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-500 bg-slate-800/30 px-3 py-1.5 rounded-full border border-slate-700/30">
                Mode: {activeMode.toUpperCase()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultimodalEngine;
