import React, { useState, useRef, useCallback } from 'react';
import ModeSwitcher from '../../components/MCA/ModeSwitcher';
import AIChatbot from '../../components/MCA/AIChatbot';
import { useSearchParams } from 'react-router-dom';
import Webcam from 'react-webcam';
import { Camera, CameraOff, Video } from 'lucide-react';
import clsx from 'clsx';

const MultimodalEngine = () => {
  const [searchParams] = useSearchParams();
  const activeMode = searchParams.get('mode') || 'live';
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [hasMicPermission, setHasMicPermission] = useState(false);
  const webcamRef = useRef(null);

  const toggleCamera = () => {
    setIsCameraActive(prev => !prev);
  };

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
              
              {/* Capturing Window (Webcam Area) */}
              <div className={clsx(
                "w-full aspect-video relative overflow-hidden bg-muted/50 rounded-xl border flex flex-col items-center justify-center group/window transition-all duration-500",
                activeMode === 'live' ? "border-secondary/20 hover:border-secondary/40" : "border-primary/20 hover:border-primary/40"
              )}>
                
                {isCameraActive ? (
                  <Webcam
                    audio={false}
                    ref={webcamRef}
                    screenshotFormat="image/jpeg"
                    className="absolute inset-0 w-full h-full object-cover rounded-xl"
                    videoConstraints={{
                      facingMode: "user",
                      aspectRatio: 1.777777778
                    }}
                  />
                ) : (
                  <>
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
                        [ {activeMode === 'live' ? 'SENSING_MODULE' : 'INTELLIGENCE_CORE'} READY ]<br/>
                        <span className="text-[8px] opacity-60 mt-2 block tracking-normal">WAITING_FOR_ACCESS</span>
                      </div>
                    </div>
                  </>
                )}

                {/* Overlay UI */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                   {!isCameraActive && (
                      <button 
                        onClick={toggleCamera}
                        className="pointer-events-auto bg-primary text-white px-6 py-3 rounded-full font-bold text-sm shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                      >
                        <Video size={18} />
                        Enable Camera
                      </button>
                   )}
                </div>

                {/* Status Indicators */}
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center px-5 py-2.5 bg-card/90 backdrop-blur-md border border-border rounded-xl opacity-0 group-hover/window:opacity-100 transition-opacity shadow-lg">
                  <div className="flex gap-5">
                    <div className="flex items-center gap-2.5 text-[10px] text-card-foreground font-bold">
                      <div className={clsx("w-2 h-2 rounded-full animate-pulse", isCameraActive ? "bg-success" : "bg-border")}></div>
                      WEB: {isCameraActive ? "ON" : "OFF"}
                    </div>
                    <div className="flex items-center gap-2.5 text-[10px] text-card-foreground font-bold">
                      <div className={clsx("w-2 h-2 rounded-full animate-pulse", isMicActive ? "bg-primary" : "bg-border")}></div>
                      MIC: {isMicActive ? "ON" : "OFF"}
                    </div>
                  </div>
                  <button 
                    onClick={toggleCamera}
                    className="pointer-events-auto text-[10px] font-black text-primary hover:underline"
                  >
                    {isCameraActive ? "STOP_CAPTURE" : "START_CAPTURE"}
                  </button>
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
               <AIChatbot 
                 isListening={isMicActive} 
                 setIsListening={setIsMicActive}
                 hasPermission={hasMicPermission}
                 setHasPermission={setHasMicPermission}
               />
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default MultimodalEngine;
