import React, { useState, useRef, useCallback, useEffect } from 'react';
import ModeSwitcher from '../../components/MCA/ModeSwitcher';
import AIChatbot from '../../components/MCA/AIChatbot';
import { useSearchParams } from 'react-router-dom';
import Webcam from 'react-webcam';
import * as faceMesh from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import * as draw from '@mediapipe/drawing_utils';
import { Video, Activity, Mic, X } from 'lucide-react';
import { calculateEAR, calculateMAR, estimateHeadPose } from '../../utils/mca/heuristics';
import { mcaService } from '../../services/mca/mcaService';
import clsx from 'clsx';

const MultimodalEngine = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeMode = searchParams.get('mode') || 'live';
  const showMesh = searchParams.get('mesh') !== 'false';
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [hasMicPermission, setHasMicPermission] = useState(false);
  const [nudges, setNudges] = useState([]); // State for coaching nudges stack
  const [metrics, setMetrics] = useState({ 
    ear: 0, 
    mar: 0, 
    pose: { yaw: 0, pitch: 0, roll: 0 },
    emotion: 'Sensing...',
    confidence: 0,
    isSyncing: false
  });
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraRef = useRef(null);
  const showMeshRef = useRef(showMesh);
  
  // Keep a mutable ref of latest metrics for the WebSocket closure
  const metricsRef = useRef({ ear: 0, mar: 0, pose: { yaw: 0, pitch: 0, roll: 0 } });

  // Audio Streaming Refs
  const mediaRecorderRef = useRef(null);
  const socketRef = useRef(null);
  const audioStreamRef = useRef(null);

  const handleNudge = useCallback((text, category = 'fusion', severity = 'info') => {
    const id = Date.now();
    const newNudge = {
      id,
      text,
      category,
      severity,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setNudges(prev => [newNudge, ...prev].slice(0, 5));
    
    // Auto-disappear after 8 seconds
    setTimeout(() => {
      setNudges(prev => prev.filter(n => n.id !== id));
    }, 8000);
  }, []);

  // Update ref when showMesh changes
  useEffect(() => {
    showMeshRef.current = showMesh;
  }, [showMesh]);

  const onResults = useCallback((results) => {
    if (!webcamRef.current || !webcamRef.current.video || !canvasRef.current) return;

    const videoWidth = webcamRef.current.video.videoWidth;
    const videoHeight = webcamRef.current.video.videoHeight;

    // Only update canvas dimensions if they changed to prevent flickering
    if (canvasRef.current.width !== videoWidth) canvasRef.current.width = videoWidth;
    if (canvasRef.current.height !== videoHeight) canvasRef.current.height = videoHeight;

    const canvasElement = canvasRef.current;
    const canvasCtx = canvasElement.getContext("2d");

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Always draw the raw camera feed first
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];

      // Calculate heuristics in background
      const ear = calculateEAR(landmarks);
      const mar = calculateMAR(landmarks);
      const pose = estimateHeadPose(landmarks);
      
      const newMetrics = { ear, mar, pose };
      setMetrics(prev => ({ ...prev, ...newMetrics }));
      metricsRef.current = { ...metricsRef.current, ...newMetrics }; // ref for WebSocket

      // Only draw the mesh overlay if enabled
      if (showMeshRef.current) {
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_TESSELATION, {
          color: "#06B6D4",
          lineWidth: 0.5,
        });
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_RIGHT_EYE, { color: "#7C3AED" });
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_LEFT_EYE, { color: "#7C3AED" });
        draw.drawConnectors(canvasCtx, landmarks, faceMesh.FACEMESH_LIPS, { color: "#EC4899" });
      }
    }
    canvasCtx.restore();
  }, []);

  useEffect(() => {
    return () => {
      stopAudioCapture();
    };
  }, []);

  const startAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      setHasMicPermission(true);

      const socket = new WebSocket(mcaService.getAudioStreamUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        const startRecordingChunk = () => {
          if (socket.readyState !== WebSocket.OPEN) return;

          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
              // Send Visual Data First 
              socket.send(JSON.stringify({
                type: 'visual_metrics',
                metrics: metricsRef.current
              }));
              
              // Send Audio Data
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
        setIsMicActive(true);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.metrics) {
            // Update metrics with SVM data from backend
            setMetrics(prev => ({
              ...prev,
              emotion: data.metrics.emotion || 'Neutral',
              confidence: data.metrics.confidence || 0,
              isSyncing: true
            }));

            if (data.metrics.nudge) {
              handleNudge(
                data.metrics.nudge, 
                data.metrics.nudge_category, 
                data.metrics.nudge_severity
              );
            }
          }
        } catch (err) {
          console.error("Error parsing socket message:", err);
        }
      };
    } catch (err) {
      console.error("Audio capture error:", err);
    }
  };

  const stopAudioCapture = () => {
    setIsMicActive(false);
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
  };

  const toggleMic = () => {
    if (isMicActive) stopAudioCapture();
    else startAudioCapture();
  };

  useEffect(() => {
    let faceMeshModel = null;

    if (isCameraActive) {
      faceMeshModel = new faceMesh.FaceMesh({
        locateFile: (file) => {
          const baseUrl = import.meta.env.VITE_MEDIAPIPE_FACE_MESH_URL || 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh';
          return `${baseUrl}/${file}`;
        },
      });

      faceMeshModel.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMeshModel.onResults(onResults);

      if (webcamRef.current && webcamRef.current.video) {
        cameraRef.current = new cam.Camera(webcamRef.current.video, {
          onFrame: async () => {
            if (faceMeshModel) {
              await faceMeshModel.send({ image: webcamRef.current.video });
            }
          },
          width: 1280,
          height: 720,
        });
        cameraRef.current.start();
      }
    }

    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      if (faceMeshModel) {
        faceMeshModel.close();
      }
    };
  }, [isCameraActive, onResults]);

  const toggleMesh = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('mesh', (!showMesh).toString());
    setSearchParams(newParams);
  };

  const toggleCamera = () => {
    setIsCameraActive(prev => !prev);
  };

  return (
    <div className="h-screen w-full bg-background text-foreground flex flex-col items-center px-4 md:px-8 font-sans antialiased overflow-hidden relative">
      {/* Global Nudge Stack (Floating - Page Top Right) */}
      <div className="fixed top-8 right-8 z-[100] flex flex-col gap-3 pointer-events-none items-end">
        {nudges.map((nudge, index) => (
          <div
            key={nudge.id}
            className={clsx(
              "backdrop-blur-2xl border px-6 py-3.5 rounded-2xl shadow-2xl flex items-center gap-4 transition-all duration-500 animate-in fade-in slide-in-from-right-8 pointer-events-auto group/nudge hover:scale-105",
              nudge.severity === 'critical' ? "bg-destructive border-white/30 text-white" :
              nudge.severity === 'warning' ? "bg-warning border-white/30 text-white" :
              "bg-primary/95 border-white/20 text-white",
              index > 0 && "scale-90 opacity-40 hover:opacity-100"
            )}
          >
            <div className={clsx(
              "w-9 h-9 rounded-full flex items-center justify-center animate-pulse",
              nudge.severity === 'critical' ? "bg-white/30" : "bg-white/20"
            )}>
              <Activity size={20} />
            </div>
            <div className="flex flex-col min-w-[120px]">
              <p className="text-[11px] font-black tracking-widest uppercase leading-none">{nudge.text}</p>
              <span className="text-[9px] opacity-50 mt-1.5 font-bold">{nudge.timestamp}</span>
            </div>
            <button
              onClick={() => setNudges(prev => prev.filter(n => n.id !== nudge.id))}
              className="ml-2 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center opacity-0 group-hover/nudge:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className={clsx(
        "w-full h-full flex flex-col gap-6 py-6 transition-all duration-700 ease-in-out",
        activeMode === 'ai' ? "max-w-[1600px]" : "max-w-6xl"
      )}>
        {/* Header Section - Compact */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl md:text-4xl font-extrabold text-foreground tracking-tight">
            EmpowerZ <span className="text-primary font-black">MCA</span>
          </h1>
          <p className="text-card-foreground text-[10px] md:text-xs font-bold opacity-60 uppercase tracking-[0.3em]">
            Behavioral Intelligence • Real-time Fusion
          </p>
        </div>

        {/* Mode Switcher Section */}
        <div className="flex justify-center">
          <ModeSwitcher />
        </div>

        {/* Dynamic Content Layout - Stretches to fill screen */}
        <div className={clsx(
          "flex-1 grid gap-6 transition-all duration-700 ease-in-out min-h-0",
          activeMode === 'ai' ? "lg:grid-cols-3" : "grid-cols-1"
        )}>

          {/* Capturing Window Section */}
          <div className={clsx(
            "relative group transition-all duration-700 ease-in-out order-1 flex flex-col min-h-0",
            activeMode === 'ai' ? "lg:col-span-2" : "col-span-1"
          )}>
            <div className="relative p-4 md:p-6 bg-card border border-border shadow-sm rounded-3xl flex flex-col items-center h-full overflow-y-auto custom-scrollbar">

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
                        [ {activeMode === 'live' ? 'SENSING_MODULE' : 'INTELLIGENCE_CORE'} READY ]<br />
                        <span className="text-[8px] opacity-60 mt-2 block tracking-normal">WAITING_FOR_ACCESS</span>
                      </div>
                    </div>
                  </>
                )}

                {/* Overlay UI */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">


                  <div className="flex flex-col gap-4 pointer-events-auto">
                    {!isCameraActive && (
                      <button
                        onClick={toggleCamera}
                        className="bg-primary text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                      >
                        <Video size={18} />
                        Enable Video Sensing
                      </button>
                    )}
                    {!isMicActive && activeMode === 'live' && (
                      <button
                        onClick={toggleMic}
                        className="bg-secondary text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                      >
                        <Mic size={18} />
                        Enable Audio Sensing
                      </button>
                    )}
                  </div>
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
                      onClick={toggleMic}
                      className={clsx(
                        "flex items-center gap-2 text-[9px] font-black px-3 py-1.5 rounded-lg border transition-all pointer-events-auto",
                        isMicActive ? "bg-secondary/20 text-secondary border-secondary/30" : "bg-muted text-muted-foreground border-border"
                      )}
                    >
                      <Mic size={12} className={clsx(isMicActive && "animate-pulse")} />
                      {isMicActive ? "MIC_ACTIVE" : "MIC_OFF"}
                    </button>
                    <button
                      onClick={toggleCamera}
                      className="pointer-events-auto text-[10px] font-black text-primary hover:underline"
                    >
                      {isCameraActive ? "STOP_VIDEO" : "START_VIDEO"}
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
                {metrics.isSyncing && (
                  <div className="flex items-center gap-2.5 text-[10px] font-black text-primary bg-primary/10 px-4 py-2 rounded-lg border border-primary/30 uppercase tracking-widest animate-pulse">
                    <Activity size={12} />
                    Fusion: Active
                  </div>
                )}
              </div>

              {/* Behavioral Metrics Dashboard */}
              {isCameraActive && (
                <div className="w-full mt-8 pt-8 border-t border-border/50 grid grid-cols-1 sm:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                  {/* Eye Contact (EAR) */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-card-foreground">Eye Contact</span>
                      <span className={clsx("text-[10px] font-black", metrics.ear < 0.2 ? "text-destructive" : "text-success")}>
                        {metrics.ear < 0.2 ? "LOOKING AWAY" : "FOCUSED"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={clsx("h-full transition-all duration-300", metrics.ear < 0.2 ? "bg-destructive" : "bg-primary")}
                        style={{ width: `${Math.min(100, (metrics.ear / 0.3) * 100)}%` }}
                      ></div>
                    </div>
                    <p className="text-[9px] text-card-foreground/60 font-medium">Maintaining steady gaze with the camera.</p>
                  </div>

                  {/* Smile/Speech (MAR) */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-card-foreground">Facial Expression</span>
                      <span className={clsx("text-[10px] font-black", metrics.mar > 0.3 ? "text-primary" : "text-card-foreground")}>
                        {metrics.mar > 0.3 ? "ACTIVE / SPEAKING" : "NEUTRAL"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-secondary transition-all duration-300"
                        style={{ width: `${Math.min(100, (metrics.mar / 0.6) * 100)}%` }}
                      ></div>
                    </div>
                    <p className="text-[9px] text-card-foreground/60 font-medium">Detecting speaking, smiling, or facial energy.</p>
                  </div>

                  {/* Head Pose */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-card-foreground">Head Alignment</span>
                      <span className={clsx(
                        "text-[10px] font-black",
                        (Math.abs(metrics.pose.yaw) > 0.15 || Math.abs(metrics.pose.pitch) > 0.15) ? "text-warning" : "text-success"
                      )}>
                        {(Math.abs(metrics.pose.yaw) > 0.15 || Math.abs(metrics.pose.pitch) > 0.15) ? "DISTRACTED" : "CENTERED"}
                      </span>
                    </div>
                    <div className="flex gap-1 h-1.5 w-full relative">
                      <div className="absolute left-1/2 -translate-x-1/2 w-4 h-full bg-foreground/10 z-10 rounded"></div>
                      <div className="flex-1 bg-muted rounded-full overflow-hidden">
                        <div className={clsx(
                          "h-full transition-all duration-300",
                          Math.abs(metrics.pose.yaw) > 0.15 ? "bg-warning" : "bg-success"
                        )} style={{ width: `${50 + metrics.pose.yaw * 100}%` }}></div>
                      </div>
                    </div>
                    <p className="text-[9px] text-card-foreground/60 font-medium">Keeping your head level and facing forward.</p>
                  </div>

                  {/* Vocal Emotion */}
                  <div className="space-y-3 col-span-1 sm:col-span-3 pt-6 mt-6 border-t border-border/30">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-primary">Vocal Affect (SVM)</span>
                      <span className="text-[10px] font-black text-primary uppercase">
                        {metrics.emotion} • {Math.round(metrics.confidence * 100)}% Confidence
                      </span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden flex">
                       <div 
                         className="h-full bg-primary transition-all duration-700" 
                         style={{ width: `${metrics.confidence * 100}%` }}
                       ></div>
                    </div>
                    <p className="text-[9px] text-card-foreground/60 font-medium">
                      The Affect Fusion engine is currently cross-checking your {(metrics.emotion || 'sensing').toLowerCase()} vocal tone with your facial geometry.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* AI Chatbot Section (Only in AI mode) */}
          {activeMode === 'ai' && (
            <div className="lg:col-span-1 order-2 animate-in fade-in slide-in-from-right-8 duration-700 h-full max-h-[calc(100vh-160px)]">
              <AIChatbot
                isListening={isMicActive}
                setIsListening={setIsMicActive}
                hasPermission={hasMicPermission}
                setHasPermission={setHasMicPermission}
                onNudge={handleNudge}
              />
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default MultimodalEngine;
