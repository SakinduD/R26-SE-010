import React, { useState, useRef, useCallback, useEffect } from 'react';
import ModeSwitcher from '../../components/MCA/ModeSwitcher';
import AIChatbot from '../../components/MCA/AIChatbot';
import { useSearchParams } from 'react-router-dom';
import Webcam from 'react-webcam';
import * as faceMesh from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import * as draw from '@mediapipe/drawing_utils';
import { Video, Activity } from 'lucide-react';
import { calculateEAR, calculateMAR, estimateHeadPose } from '../../utils/mca/heuristics';
import clsx from 'clsx';

const MultimodalEngine = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeMode = searchParams.get('mode') || 'live';
  const showMesh = searchParams.get('mesh') !== 'false';
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [hasMicPermission, setHasMicPermission] = useState(false);
  const [metrics, setMetrics] = useState({ ear: 0, mar: 0, pose: { yaw: 0, pitch: 0, roll: 0 } });
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraRef = useRef(null);

  const onResults = useCallback((results) => {
    if (!webcamRef.current || !webcamRef.current.video) return;

    const videoWidth = webcamRef.current.video.videoWidth;
    const videoHeight = webcamRef.current.video.videoHeight;

    canvasRef.current.width = videoWidth;
    canvasRef.current.height = videoHeight;

    const canvasElement = canvasRef.current;
    const canvasCtx = canvasElement.getContext("2d");

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiFaceLandmarks) {
      const landmarks = results.multiFaceLandmarks[0];
      
      // Calculate heuristics
      const ear = calculateEAR(landmarks);
      const mar = calculateMAR(landmarks);
      const pose = estimateHeadPose(landmarks);
      
      setMetrics({ ear, mar, pose });

      if (showMesh) {
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_TESSELATION, {
          color: "#06B6D4",
          lineWidth: 0.5,
        });
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_RIGHT_EYE, {
          color: "#7C3AED",
        });
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_LEFT_EYE, {
          color: "#7C3AED",
        });
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_LIPS, {
          color: "#EC4899",
        });
      }
    }
    canvasCtx.restore();
  }, [showMesh]);

  const toggleMesh = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('mesh', (!showMesh).toString());
    setSearchParams(newParams);
  };

  useEffect(() => {
    const faceMeshModel = new faceMesh.FaceMesh({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
      },
    });

    faceMeshModel.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMeshModel.onResults(onResults);

    if (isCameraActive && webcamRef.current && webcamRef.current.video) {
      cameraRef.current = new cam.Camera(webcamRef.current.video, {
        onFrame: async () => {
          await faceMeshModel.send({ image: webcamRef.current.video });
        },
        width: 1280,
        height: 720,
      });
      cameraRef.current.start();
    }

    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      faceMeshModel.close();
    };
  }, [isCameraActive, onResults]);

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
                  <>
                    <Webcam
                      audio={false}
                      ref={webcamRef}
                      screenshotFormat="image/jpeg"
                      className="hidden"
                      videoConstraints={{
                        facingMode: "user",
                        aspectRatio: 1.777777778
                      }}
                    />
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 w-full h-full object-cover rounded-xl"
                    />
                  </>
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
                        Enable Sensing Module
                      </button>
                   )}
                </div>

                {/* Status Indicators */}
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center px-5 py-2.5 bg-card/90 backdrop-blur-md border border-border rounded-xl opacity-0 group-hover/window:opacity-100 transition-opacity shadow-lg z-10">
                  <div className="flex gap-5">
                    <div className="flex items-center gap-2.5 text-[10px] text-card-foreground font-bold">
                      <div className={clsx("w-2 h-2 rounded-full animate-pulse", isCameraActive ? "bg-success" : "bg-border")}></div>
                      SENSING: {isCameraActive ? "ACTIVE" : "IDLE"}
                    </div>
                    <div className="flex items-center gap-2.5 text-[10px] text-card-foreground font-bold">
                      <div className={clsx("w-2 h-2 rounded-full animate-pulse", isMicActive ? "bg-primary" : "bg-border")}></div>
                      AUDIO: {isMicActive ? "CAPTURE" : "OFF"}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {isCameraActive && (
                      <button 
                        onClick={toggleMesh}
                        className={clsx(
                          "flex items-center gap-2 text-[9px] font-black px-3 py-1.5 rounded-lg border transition-all pointer-events-auto",
                          showMesh ? "bg-primary/20 text-primary border-primary/30" : "bg-muted text-muted-foreground border-border"
                        )}
                      >
                        <Activity size={12} className={clsx(showMesh && "animate-pulse")} />
                        {showMesh ? "MESH_VISIBLE" : "MESH_HIDDEN"}
                      </button>
                    )}
                    <button 
                      onClick={toggleCamera}
                      className="pointer-events-auto text-[10px] font-black text-primary hover:underline"
                    >
                      {isCameraActive ? "STOP_SENSING" : "START_SENSING"}
                    </button>
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
                {isCameraActive && (
                   <div className="flex items-center gap-2.5 text-[10px] font-black text-muted-foreground bg-muted/50 px-4 py-2 rounded-lg border border-border uppercase tracking-widest">
                      Tracking: {showMesh ? "Visual" : "Background"}
                   </div>
                )}
              </div>

              {/* Behavioral Metrics Dashboard */}
              {isCameraActive && (
                <div className="w-full mt-8 pt-8 border-t border-border/50 grid grid-cols-1 sm:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                  {/* Eye Contact (EAR) */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-card-foreground">Attention (EAR)</span>
                      <span className={clsx("text-[10px] font-black", metrics.ear < 0.2 ? "text-destructive" : "text-success")}>
                        {metrics.ear < 0.2 ? "BLINKING/CLOSED" : "FOCUSED"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all duration-300" 
                        style={{ width: `${Math.min(100, metrics.ear * 300)}%` }}
                      ></div>
                    </div>
                    <p className="text-[9px] text-card-foreground/60 font-medium">Eye Aspect Ratio: {metrics.ear.toFixed(3)}</p>
                  </div>

                  {/* Smile/Speech (MAR) */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-card-foreground">Engagement (MAR)</span>
                      <span className={clsx("text-[10px] font-black", metrics.mar > 0.5 ? "text-primary" : "text-card-foreground")}>
                        {metrics.mar > 0.5 ? "SMILING/OPEN" : "NEUTRAL"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-secondary transition-all duration-300" 
                        style={{ width: `${Math.min(100, metrics.mar * 150)}%` }}
                      ></div>
                    </div>
                    <p className="text-[9px] text-card-foreground/60 font-medium">Mouth Aspect Ratio: {metrics.mar.toFixed(3)}</p>
                  </div>

                  {/* Head Pose */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-card-foreground">Posturing (POSE)</span>
                      <span className="text-[10px] font-black text-card-foreground">
                        Y:{metrics.pose.yaw.toFixed(1)} P:{metrics.pose.pitch.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex gap-1 h-1.5 w-full">
                       <div className="flex-1 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-warning transition-all duration-300" style={{ width: `${50 + metrics.pose.yaw * 50}%` }}></div>
                       </div>
                       <div className="flex-1 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-warning transition-all duration-300" style={{ width: `${50 + metrics.pose.pitch * 50}%` }}></div>
                       </div>
                    </div>
                    <p className="text-[9px] text-card-foreground/60 font-medium">Yaw / Pitch Relative Delta</p>
                  </div>
                </div>
              )}
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
