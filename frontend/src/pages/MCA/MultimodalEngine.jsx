import React from 'react';
import ModeSwitcher from '../../components/MCA/ModeSwitcher';
import AIChatbot from '../../components/MCA/AIChatbot';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';

const MultimodalEngine = () => {
  const [searchParams] = useSearchParams();
  const activeMode = searchParams.get('mode') || 'live';

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center pt-8 md:pt-12 pb-20 px-4 md:px-8 font-sans antialiased">
      <div className={clsx(
        "w-full space-y-8 transition-all duration-700 ease-in-out",
        activeMode === 'ai' ? "max-w-7xl" : "max-w-6xl"
      )}>
        {/* Header Section */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl md:text-5xl font-extrabold text-foreground tracking-tight">
            Multimodal Communication Engine
          </h1>
          <p className="text-card-foreground text-sm max-w-xl mx-auto font-medium opacity-90">
            Real-time behavioral analysis and emotional intelligence fusion.
          </p>
        </div>

        {/* Mode Switcher Section */}
        <div className="py-2">
          <ModeSwitcher />
        </div>

        {/* Dynamic Content Layout */}
        <div className={clsx(
          "grid gap-6 md:gap-8 transition-all duration-700 ease-in-out",
          activeMode === 'ai' ? "lg:grid-cols-3" : "grid-cols-1"
        )}>
          
          {/* Capturing Window Section */}
          <div className={clsx(
            "relative group transition-all duration-700 ease-in-out order-1",
            activeMode === 'ai' ? "lg:col-span-2" : "col-span-1"
          )}>
            <div className={clsx(
              "absolute -inset-1 rounded-2xl blur-sm opacity-5 group-hover:opacity-10 transition duration-1000",
              activeMode === 'live' ? "bg-secondary" : "bg-primary"
            )}></div>
            <div className="relative p-4 md:p-6 bg-card border border-border shadow-sm rounded-2xl flex flex-col items-center h-full overflow-hidden">
              
              {/* Capturing Window (Webcam Placeholder) */}
              <div className={clsx(
                "w-full aspect-video relative overflow-hidden bg-muted/50 rounded-xl border flex flex-col items-center justify-center group/window transition-all duration-500",
                activeMode === 'live' ? "border-secondary/20 hover:border-secondary/40" : "border-primary/20 hover:border-primary/40"
              )}>
                <div className={clsx(
                  "absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] via-transparent to-transparent opacity-30",
                  activeMode === 'live' ? "from-secondary/10" : "from-primary/10"
                )}></div>
                
                <div className="relative flex flex-col items-center gap-4">
                  <div className={clsx(
                    "p-10 border-2 border-dashed rounded-2xl font-mono text-[10px] uppercase tracking-[0.2em] animate-pulse transition-colors text-center font-bold",
                    activeMode === 'live' 
                      ? "border-secondary/20 text-secondary group-hover/window:border-secondary/40" 
                      : "border-primary/20 text-primary group-hover/window:border-primary/40"
                  )}>
                    [ {activeMode === 'live' ? 'SENSING_MODULE' : 'INTELLIGENCE_CORE'} ACTIVE ]<br/>
                    <span className="text-[8px] opacity-60 mt-2 block tracking-normal">READY_FOR_STREAM</span>
                  </div>
                  <div className="text-center px-4">
                    <h2 className="text-lg md:text-xl font-bold tracking-tight text-foreground">
                      {activeMode === 'live' ? 'Live Session Analysis' : 'Visual Behavior Tracking'}
                    </h2>
                    <p className="text-[10px] md:text-xs text-card-foreground font-medium mt-1">
                      {activeMode === 'live' 
                        ? 'Monitoring facial landmarks and vocal metrics with WCAG-compliant contrast' 
                        : 'Webcam active for behavioral cue extraction during AI role-play'}
                    </p>
                  </div>
                </div>

                {/* Status Indicators */}
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center px-5 py-2.5 bg-card/90 backdrop-blur-md border border-border rounded-xl opacity-0 group-hover/window:opacity-100 transition-opacity shadow-lg">
                  <div className="flex gap-5">
                    <div className="flex items-center gap-2.5 text-[10px] text-card-foreground font-bold">
                      <div className="w-2 h-2 rounded-full bg-border animate-pulse"></div>
                      WEB: OFF
                    </div>
                    <div className="flex items-center gap-2.5 text-[10px] text-card-foreground font-bold">
                      <div className="w-2 h-2 rounded-full bg-border animate-pulse"></div>
                      MIC: OFF
                    </div>
                  </div>
                  <div className={clsx(
                    "text-[10px] font-mono uppercase tracking-widest font-black",
                    activeMode === 'live' ? "text-secondary" : "text-primary"
                  )}>
                    CONTRAST_AA: OK
                  </div>
                </div>
              </div>

              {/* Bottom Meta Info */}
              <div className="mt-6 flex flex-wrap justify-center gap-4">
                <div className="flex items-center gap-2.5 text-[10px] font-black text-secondary bg-secondary/10 px-4 py-2 rounded-lg border border-secondary/20 uppercase tracking-widest">
                  <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></div>
                  Privacy: Edge_Only
                </div>
                <div className={clsx(
                  "flex items-center gap-2.5 text-[10px] font-black px-4 py-2 rounded-lg border uppercase tracking-widest",
                  activeMode === 'live' 
                    ? "bg-secondary/10 text-secondary border-secondary/20" 
                    : "bg-primary/10 text-primary border-primary/20"
                )}>
                  Module: {activeMode === 'live' ? 'Multimodal_Sensing' : 'Intelligence_Core'}
                </div>
              </div>
            </div>
          </div>

          {/* AI Chatbot Section (Only in AI mode) */}
          {activeMode === 'ai' && (
            <div className="lg:col-span-1 order-2 animate-in fade-in slide-in-from-right-8 duration-700 h-full">
               <AIChatbot />
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default MultimodalEngine;
