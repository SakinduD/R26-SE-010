import React, { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import ModeSwitcher from '../../components/MCA/ModeSwitcher';
import AIChatbot from '../../components/MCA/AIChatbot';
import { useSearchParams } from 'react-router-dom';
import Webcam from 'react-webcam';
import * as faceMesh from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import * as draw from '@mediapipe/drawing_utils';
import { Video, Activity, Mic, X, Play, Square } from 'lucide-react';
import { calculateEAR, calculateMAR, estimateHeadPose } from '../../utils/mca/heuristics';
import { mcaService } from '../../services/mca/mcaService';
import clsx from 'clsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";

const MultimodalEngine = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeMode = searchParams.get('mode') || 'live';
  const showMesh = searchParams.get('mesh') !== 'false';
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [liveMicActive, setLiveMicActive] = useState(false);
  const [liveHasMicPermission, setLiveHasMicPermission] = useState(false);
  const [aiMicActive, setAiMicActive] = useState(false);
  const [aiHasMicPermission, setAiHasMicPermission] = useState(false);
  const [aiStopSignal, setAiStopSignal] = useState(0);
  const [aiStartSignal, setAiStartSignal] = useState(0);
  const [aiSessionActive, setAiSessionActive] = useState(false);
  const aiSessionActiveRef = useRef(false);
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
  const recordRestartTimeoutRef = useRef(null);

  // Live session tracking
  const [liveSessionId, setLiveSessionId] = useState(null);
  const liveSessionIdRef = useRef(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const sessionTimerRef = useRef(null);
  const liveNudgeLogRef = useRef([]);
  const liveEmotionCountsRef = useRef({}); // Track distribution for scoring
  const activeModeRef = useRef(activeMode);
  const [aiSessionStarting, setAiSessionStarting] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isStopAlertOpen, setIsStopAlertOpen] = useState(false);
  const [pendingModeSwitch, setPendingModeSwitch] = useState(null);
  const [isLiveStarting, setIsLiveStarting] = useState(false);
  const [isLiveEnding, setIsLiveEnding] = useState(false);
  const [aiSessionEnding, setAiSessionEnding] = useState(false);

  const handleModeChangeRequest = (mode, executeSwitch) => {
    if (liveSessionIdRef.current || (activeModeRef.current === 'ai' && aiSessionActiveRef.current)) {
      setPendingModeSwitch(() => executeSwitch);
      setIsAlertOpen(true);
    } else {
      executeSwitch();
    }
  };

  const handleConfirmModeSwitch = () => {
    // Force-end live session without second confirmation
    if (liveSessionIdRef.current) realEndLiveSession();
    
    // For AI mode, the cleanup function in AIChatbot now handles formal end on unmount
    if (pendingModeSwitch) pendingModeSwitch();
    
    setIsAlertOpen(false);
    setPendingModeSwitch(null);
  };

  const handleCancelModeSwitch = () => {
    setIsAlertOpen(false);
    setPendingModeSwitch(null);
  };
  
  useEffect(() => { activeModeRef.current = activeMode; }, [activeMode]);

  const handleNudge = useCallback((text, category = 'fusion', severity = 'info') => {
    // Only fire nudges if a Live Session is active (AI session is managed locally in AIChatbot)
    if (activeModeRef.current === 'live' && !liveSessionIdRef.current) return;

    const id = Date.now();
    const newNudge = {
      id,
      text,
      category,
      severity,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setNudges(prev => [newNudge, ...prev].slice(0, 5));
    // Accumulate for session persistence
    liveNudgeLogRef.current = [
      ...liveNudgeLogRef.current,
      { message: text, category, severity, timestamp: newNudge.timestamp }
    ];

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

    // Stop Affect Fusion (FaceMesh heuristics) if the session isn't actively running
    if (activeModeRef.current === 'live' && !liveSessionIdRef.current) {
      canvasCtx.restore();
      return;
    }

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



  const startAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      setLiveHasMicPermission(true);

      // Mic capture only — session is now manual
      setLiveMicActive(true);

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
                metrics: metricsRef.current,
                session_id: liveSessionIdRef.current
              }));
              // Send Audio Data
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
        setLiveMicActive(true);
      };

      socket.onerror = (err) => console.error('[Live WS] error:', err);

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.metrics) {
            setMetrics(prev => ({
              ...prev,
              emotion: data.metrics.emotion
                ? data.metrics.emotion.charAt(0).toUpperCase() + data.metrics.emotion.slice(1)
                : 'Neutral',
              confidence: data.metrics.confidence || 0,
              isSyncing: true
            }));

            if (data.metrics.emotion) {
              const emo = data.metrics.emotion.toLowerCase();
              liveEmotionCountsRef.current[emo] = (liveEmotionCountsRef.current[emo] || 0) + 1;
            }

            if (data.metrics.nudge) {
              handleNudge(
                data.metrics.nudge,
                data.metrics.nudge_category,
                data.metrics.nudge_severity
              );
            }
          }
        } catch (err) {
          console.error('Error parsing socket message:', err);
        }
      };
    } catch (err) {
      console.error('Audio capture error:', err);
    }
  };

  const stopAudioCapture = async () => {
    setLiveMicActive(false);
    if (recordRestartTimeoutRef.current) {
      clearTimeout(recordRestartTimeoutRef.current);
      recordRestartTimeoutRef.current = null;
    }
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
    setMetrics(prev => ({ ...prev, isSyncing: false, emotion: 'Sensing...' }));

    setMetrics(prev => ({ ...prev, isSyncing: false, emotion: 'Sensing...' }));
  };

  const toggleLiveMic = () => {
    if (liveMicActive) {
      stopAudioCapture();
      return;
    }
    if (aiMicActive) {
      setAiStopSignal(Date.now());
    }
    startAudioCapture();
  };

  const startLiveSession = async () => {
    if (liveSessionId || sessionTimerRef.current || isLiveStarting) return;
    
    if (!isCameraActive || !liveMicActive) {
      toast.error("Please turn on your camera and microphone first to start the live session.", {
        description: "Behavioral sensing requires both inputs for real-time analysis."
      });
      return;
    }

    setIsLiveStarting(true);
    liveNudgeLogRef.current = [];
    liveEmotionCountsRef.current = {};
    setSessionDuration(0);
    try {
      const session = await mcaService.startSession('live');
      if (session.id && session.status === 'active') {
        setLiveSessionId(session.id);
        liveSessionIdRef.current = session.id;
        sessionTimerRef.current = setInterval(() => {
          setSessionDuration(prev => prev + 1);
        }, 1000);
        toast.success("Live session started.");
      } else {
        toast.error("Failed to initialize session on server.");
      }
    } catch (err) {
      console.warn('[Live] Session start failed:', err);
      toast.error("Failed to start session. Please try again.");
    } finally {
      setIsLiveStarting(false);
    }
  };

  const realEndLiveSession = async () => {
    const sid = liveSessionIdRef.current;
    if (isLiveEnding) return;
    setIsLiveEnding(true);
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    if (sid) {
      // Hard stop sensing
      stopAudioCapture();
      setIsCameraActive(false);

      setLiveSessionId(null);
      liveSessionIdRef.current = null;
      try {
        // Calculate distribution
        const total = Object.values(liveEmotionCountsRef.current).reduce((a, b) => a + b, 0);
        const distribution = {};
        if (total > 0) {
          Object.entries(liveEmotionCountsRef.current).forEach(([emo, count]) => {
            distribution[emo.toLowerCase()] = count / total;
          });
        }

        await mcaService.endSession(
          sid,
          liveNudgeLogRef.current,
          { 
            total_nudges: liveNudgeLogRef.current.length,
            final_emotion: metrics.emotion
          },
          null,
          distribution,
          { 
            avg_ear: metrics.ear,
            avg_mar: metrics.mar,
            avg_pitch: metrics.pose.pitch
          }
        );
        if (res.id && res.status === 'completed') {
          toast.success("Live session ended and data saved.");
        } else {
          toast.error("Session closed but data persistence may be incomplete.");
        }
      } catch (err) {
        console.warn('[Live] Session end failed:', err);
        toast.error("Failed to formally end session. Please check your connection.");
      } finally {
        setIsLiveEnding(false);
      }
    } else {
      setIsLiveEnding(false);
    }
  };

  const endLiveSession = () => {
    setIsStopAlertOpen(true);
  };

  useEffect(() => {
    return () => {
      stopAudioCapture();
      realEndLiveSession();
    };
  }, []);

  useEffect(() => {
    if (aiMicActive && liveMicActive) {
      stopAudioCapture();
    }
  }, [aiMicActive, liveMicActive]);

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
          {liveSessionId && activeMode === 'live' && (
            <div className="pt-2 flex items-center justify-center gap-3 animate-in fade-in zoom-in duration-500">
              <div className="px-3 py-1 bg-secondary/10 border border-secondary/20 rounded-full flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                <span className="text-[10px] font-black text-secondary tracking-widest uppercase">
                  Session Active: {Math.floor(sessionDuration / 60)}:{(sessionDuration % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Mode Switcher Section */}
        <div className="flex justify-center">
          <ModeSwitcher onModeChangeRequest={handleModeChangeRequest} />
        </div>

        <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End Active Session?</AlertDialogTitle>
              <AlertDialogDescription>
                You are currently in an active session. Switching modes will automatically end your session and save your data. Do you want to continue?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleCancelModeSwitch}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmModeSwitch} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                End Session & Switch
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Session End Confirmation */}
        <AlertDialog open={isStopAlertOpen} onOpenChange={setIsStopAlertOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End Session?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to end this session? All behavioral metrics and emotion data will be saved to your dashboard.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIsStopAlertOpen(false)}>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => {
                  if (activeMode === 'live') {
                    // We need a force-end bypass for the confirmation
                    realEndLiveSession();
                  } else {
                    setAiStopSignal(Date.now());
                  }
                  setIsStopAlertOpen(false);
                }} 
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                End Session
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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

                {/* Overlay UI (Only for enabling camera when off) */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-0">
                  <div className="flex flex-col gap-4 pointer-events-auto">
                    {!isCameraActive && (
                      <button
                        onClick={toggleCamera}
                        className="bg-primary text-white px-6 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-lg hover:bg-primary/90 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 pointer-events-auto"
                      >
                        <Video size={14} />
                        Enable Video Sensing
                      </button>
                    )}
                    {!liveMicActive && (
                      <button
                        onClick={toggleLiveMic}
                        className="bg-secondary text-white px-6 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-lg hover:bg-secondary/90 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 pointer-events-auto"
                      >
                        <Mic size={14} />
                        Enable Audio Sensing
                      </button>
                    )}
                  </div>
                </div>

                {/* Persistent Control Bar */}
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center px-6 py-3 bg-card/95 backdrop-blur-xl border border-border/60 rounded-2xl shadow-2xl z-20 transition-all duration-500">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3 text-[11px] text-foreground font-black tracking-widest uppercase">
                      <div className={clsx("w-2.5 h-2.5 rounded-full transition-colors duration-500", isCameraActive ? "bg-success animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-muted-foreground/30")}></div>
                      <span className="opacity-80">Video</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-foreground font-black tracking-widest uppercase">
                      <div className={clsx("w-2.5 h-2.5 rounded-full transition-colors duration-500", liveMicActive ? "bg-secondary animate-pulse shadow-[0_0_8px_rgba(14,165,233,0.6)]" : "bg-muted-foreground/30")}></div>
                      <span className="opacity-80">Audio</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Primary Session Controls */}
                    {activeMode === 'live' ? (
                      <>
                        {!liveSessionId ? (
                          <button
                            onClick={startLiveSession}
                            disabled={isLiveStarting}
                            className={clsx(
                              "bg-primary text-primary-foreground px-5 py-2 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg shadow-primary/20 hover:bg-primary/90 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2",
                              isLiveStarting && "opacity-70 cursor-wait"
                            )}
                          >
                            {isLiveStarting ? (
                              <div className="w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                            ) : (
                              <Play size={14} fill="currentColor" />
                            )}
                            {isLiveStarting ? "Starting..." : "Start Session"}
                          </button>
                        ) : (
                          <button
                            onClick={() => setIsStopAlertOpen(true)}
                            disabled={isLiveEnding}
                            className={clsx(
                              "bg-destructive text-destructive-foreground px-5 py-2 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg shadow-destructive/20 hover:bg-destructive/90 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2",
                              isLiveEnding && "opacity-70 cursor-wait"
                            )}
                          >
                            {isLiveEnding ? (
                              <div className="w-3 h-3 border-2 border-destructive-foreground/30 border-t-destructive-foreground rounded-full animate-spin" />
                            ) : (
                              <Square size={14} fill="currentColor" />
                            )}
                            {isLiveEnding ? "Ending..." : "Stop Session"}
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {!aiSessionActive ? (
                          <button
                            onClick={() => setAiStartSignal(Date.now())}
                            disabled={aiSessionStarting}
                            className={clsx(
                              "bg-primary text-primary-foreground px-5 py-2 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg shadow-primary/20 hover:bg-primary/90 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2",
                              aiSessionStarting && "opacity-70 cursor-wait"
                            )}
                          >
                            {aiSessionStarting ? (
                              <div className="w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                            ) : (
                              <Play size={14} fill="currentColor" />
                            )}
                            {aiSessionStarting ? "Starting AI..." : "Start AI Session"}
                          </button>
                        ) : (
                          <button
                            onClick={() => setIsStopAlertOpen(true)}
                            disabled={aiSessionEnding}
                            className={clsx(
                              "bg-destructive text-destructive-foreground px-5 py-2 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg shadow-destructive/20 hover:bg-destructive/90 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2",
                              aiSessionEnding && "opacity-70 cursor-wait"
                            )}
                          >
                            {aiSessionEnding ? (
                              <div className="w-3 h-3 border-2 border-destructive-foreground/30 border-t-destructive-foreground rounded-full animate-spin" />
                            ) : (
                              <Square size={14} fill="currentColor" />
                            )}
                            {aiSessionEnding ? "Ending AI..." : "Stop AI Session"}
                          </button>
                        )}
                      </>
                    )}

                    {/* Secondary Controls (Tools) - ALWAYS SHOW SO USER CAN ENABLE THEM BEFORE SESSION */}
                    <div className="h-6 w-px bg-border/50 mx-2 hidden sm:block"></div>
                    
                    {/* Camera Toggle */}
                    <button
                      onClick={toggleCamera}
                      className={clsx(
                        "flex items-center gap-2 text-[10px] font-black px-4 py-2 rounded-xl border transition-all pointer-events-auto uppercase tracking-widest",
                        isCameraActive ? "bg-success/10 text-success border-success/30 hover:bg-success/20" : "bg-background text-muted-foreground border-border hover:bg-muted"
                      )}
                    >
                      <Video size={14} className={clsx(isCameraActive && "animate-pulse")} />
                      {isCameraActive ? "Stop Cam" : "Start Cam"}
                    </button>

                    {/* Mesh Overlay Toggle */}
                    {isCameraActive && (
                      <button
                        onClick={toggleMesh}
                        className={clsx(
                          "flex items-center gap-2 text-[10px] font-black px-4 py-2 rounded-xl border transition-all pointer-events-auto uppercase tracking-widest",
                          showMesh ? "bg-primary/10 text-primary border-primary/30" : "bg-background text-muted-foreground border-border hover:bg-muted"
                        )}
                      >
                        <Activity size={14} className={clsx(showMesh && "animate-pulse")} />
                        Mesh
                      </button>
                    )}
                    
                    {/* Audio Toggle */}
                    <button
                      onClick={toggleLiveMic}
                      className={clsx(
                        "flex items-center gap-2 text-[10px] font-black px-4 py-2 rounded-xl border transition-all pointer-events-auto uppercase tracking-widest",
                        liveMicActive ? "bg-secondary/10 text-secondary border-secondary/30 hover:bg-secondary/20" : "bg-background text-muted-foreground border-border hover:bg-muted"
                      )}
                    >
                      <Mic size={14} className={clsx(liveMicActive && "animate-pulse")} />
                      {liveMicActive ? "Stop Mic" : "Enable Mic"}
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
                isListening={aiMicActive}
                setIsListening={setAiMicActive}
                hasPermission={aiHasMicPermission}
                setHasPermission={setAiHasMicPermission}
                onNudge={handleNudge}
                metrics={metrics}
                stopSignal={aiStopSignal}
                startSignal={aiStartSignal}
                isCameraActive={isCameraActive}
                onSessionStateChange={(isActive, isStarting, isEnding) => {
                  setAiSessionActive(isActive);
                  aiSessionActiveRef.current = isActive;
                  setAiSessionStarting(isStarting);
                  setAiSessionEnding(isEnding);
                }}
              />
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default MultimodalEngine;
