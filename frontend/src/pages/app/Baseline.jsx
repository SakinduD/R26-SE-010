import React, { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import Webcam from 'react-webcam';
import * as faceMesh from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import * as draw from '@mediapipe/drawing_utils';
import { Video, Activity, Mic, X, Play, Square } from 'lucide-react';
import { calculateEAR, calculateMAR, estimateHeadPose } from '@/utils/mca/heuristics';
import { mcaService } from '@/services/mca/mcaService';
import AIChatbot from '@/components/MCA/AIChatbot';
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
} from "@/components/ui/alert-dialog";
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute';

export default function Baseline() {
  const { isLoading: authLoading } = useProtectedRoute();
  const navigate = useNavigate();
  const [showMesh, setShowMesh] = useState(true);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [aiMicActive, setAiMicActive] = useState(false);
  const [aiHasMicPermission, setAiHasMicPermission] = useState(false);
  const [aiDiscardSignal, setAiDiscardSignal] = useState(0);
  const [aiStartSignal, setAiStartSignal] = useState(0);

  const [aiSessionActive, setAiSessionActive] = useState(false);
  const aiSessionActiveRef = useRef(false);
  const [nudges, setNudges] = useState([]);
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

  const [aiSessionStarting, setAiSessionStarting] = useState(false);
  const [isStopAlertOpen, setIsStopAlertOpen] = useState(false);
  const [navAlertTarget, setNavAlertTarget] = useState(null);
  const [aiSessionEnding, setAiSessionEnding] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);

  const handleNudge = useCallback((text, category = 'fusion', severity = 'info') => {
    if (!aiSessionActiveRef.current) return;
    const id = Date.now();
    const newNudge = {
      id,
      text,
      category,
      severity,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setNudges(prev => [newNudge, ...prev].slice(0, 5));
    setTimeout(() => {
      setNudges(prev => prev.filter(n => n.id !== id));
    }, 10000);
  }, []);

  // Warn on navigation if session is active
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (aiSessionActive) {
        e.preventDefault();
        e.returnValue = 'You have an active AI session. Are you sure you want to leave?';
      }
    };

    const handleGlobalClick = (e) => {
      if (!aiSessionActive) return;
      const link = e.target.closest('a');
      if (link && link.href && link.href.startsWith(window.location.origin) && link.pathname !== window.location.pathname) {
        e.preventDefault();
        e.stopPropagation();
        setNavAlertTarget(link.pathname + link.search + link.hash);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleGlobalClick, { capture: true });

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleGlobalClick, { capture: true });
    };
  }, [aiSessionActive]);

  const onResults = useCallback((results) => {
    if (!webcamRef.current || !webcamRef.current.video || !canvasRef.current) return;

    const videoWidth = webcamRef.current.video.videoWidth;
    const videoHeight = webcamRef.current.video.videoHeight;

    if (canvasRef.current.width !== videoWidth) canvasRef.current.width = videoWidth;
    if (canvasRef.current.height !== videoHeight) canvasRef.current.height = videoHeight;

    const canvasElement = canvasRef.current;
    const canvasCtx = canvasElement.getContext("2d");

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Mirror horizontally so the feed behaves like a normal selfie/mirror view
    canvasCtx.translate(canvasElement.width, 0);
    canvasCtx.scale(-1, 1);

    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];

      const ear = calculateEAR(landmarks);
      const mar = calculateMAR(landmarks);
      const pose = estimateHeadPose(landmarks);

      const newMetrics = { ear, mar, pose };
      setMetrics(prev => ({ ...prev, ...newMetrics }));

      if (showMesh) {
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
  }, [showMesh]);

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

  const toggleCamera = () => {
    setIsCameraActive(prev => !prev);
  };

  if (authLoading) return null;

  return (
    <div className="w-full flex flex-col items-center p-4 md:p-8 font-sans antialiased relative h-[calc(100vh-48px)] overflow-hidden">
      {/* Global Nudge Stack (Floating - Page Top Right) */}
      <div className="absolute top-8 right-8 z-[100] flex flex-col gap-3 pointer-events-none items-end">
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
              <p className="text-[11px] font-medium tracking-wide uppercase leading-none">{nudge.text}</p>
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

      <div className="w-full flex-1 min-h-0 flex flex-col gap-6 transition-all duration-700 ease-in-out max-w-[1600px] h-full">
        {/* Header Section */}
        <div className="text-center space-y-1">
          <h1 className="t-h1" style={{ fontSize: 28 }}>
            EmpowerZ <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Baseline</span>
          </h1>
          <p className="t-over" style={{ marginTop: 4 }}>
            AI Chatbot · Calibration Session
          </p>
        </div>

        {/* Early-Exit Confirmation — ending before the 8-minute mark discards the session */}
        <AlertDialog open={isStopAlertOpen} onOpenChange={setIsStopAlertOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Dismiss Session?</AlertDialogTitle>
              <AlertDialogDescription>
                Your baseline session isn't complete yet. Ending now discards all behavioral and emotion data.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIsStopAlertOpen(false)}>Continue Session</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setAiDiscardSignal(Date.now());
                  setIsStopAlertOpen(false);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Dismiss Session
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Navigation Warning Alert */}
        <AlertDialog open={!!navAlertTarget} onOpenChange={(open) => !open && setNavAlertTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave Active Session?</AlertDialogTitle>
              <AlertDialogDescription>
                You have an active AI session running. Leaving now will dismiss it before completion — no data will be saved. Are you sure you want to leave?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setNavAlertTarget(null)}>Stay in Session</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setAiDiscardSignal(Date.now());
                  const target = navAlertTarget;
                  setNavAlertTarget(null);
                  navigate(target);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Dismiss & Leave
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Dynamic Content Layout */}
        <div className="flex-1 grid gap-6 transition-all duration-700 ease-in-out min-h-0 lg:grid-cols-3">
          {/* Capturing Window Section */}
          <div className="relative group transition-all duration-700 ease-in-out order-1 flex flex-col min-h-0 lg:col-span-2">
            <div className="relative p-4 md:p-6 bg-surface border border-border-subtle rounded-2xl flex flex-col items-center h-full min-h-0 overflow-y-auto custom-scrollbar">
              {/* Capturing Window */}
              <div className="w-full aspect-video relative overflow-hidden bg-muted/50 rounded-xl border flex flex-col items-center justify-center group/window transition-all duration-500 border-primary/20 hover:border-primary/40">
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
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] via-transparent to-transparent opacity-30 from-primary/10"></div>
                    <div className="relative flex flex-col items-center gap-4">
                      <div className="p-10 border-2 border-dashed rounded-2xl font-mono text-[10px] uppercase tracking-[0.2em] animate-pulse transition-colors text-center font-bold border-primary/20 text-primary group-hover/window:border-primary/40">
                        [ INTELLIGENCE_CORE READY ]<br />
                        <span className="text-[8px] opacity-60 mt-2 block tracking-normal">WAITING_FOR_ACCESS</span>
                      </div>
                    </div>
                  </>
                )}

                {/* Overlay UI */}
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
                    {(!aiMicActive && !aiSessionActive && !isAiSpeaking) && (
                      <button
                        onClick={() => setAiMicActive(true)}
                        className="bg-secondary text-white px-6 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-lg hover:bg-secondary/90 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 pointer-events-auto"
                      >
                        <Mic size={14} />
                        Enable Audio Sensing
                      </button>
                    )}
                  </div>
                </div>

                {/* Persistent Control Bar */}
                <div className="absolute bottom-6 left-6 right-6 flex justify-between items-center px-6 py-3 bg-surface/80 border border-border-subtle rounded-3xl z-20 transition-all duration-500 shadow-xl" style={{ backdropFilter: 'blur(12px)' }}>
                  <div className="flex items-center gap-6 flex-1 justify-start">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-muted-foreground font-black tracking-[0.2em] uppercase opacity-60">Video</span>
                      <div className="flex items-center gap-2.5">
                        <div className={clsx("w-2 h-2 rounded-full transition-all duration-500", isCameraActive ? "bg-success shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-muted-foreground/30")} />
                        <span className={clsx("text-[10px] font-black uppercase tracking-widest", isCameraActive ? "text-success" : "text-muted-foreground/40")}>
                          {isCameraActive ? "Active" : "Disabled"}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-muted-foreground font-black tracking-[0.2em] uppercase opacity-60">Audio</span>
                      <div className="flex items-center gap-2.5">
                        <div className={clsx("w-2 h-2 rounded-full transition-all duration-500", aiMicActive ? "bg-info shadow-[0_0_8px_rgba(59,130,246,0.6)]" : "bg-muted-foreground/30")} />
                        <span className={clsx("text-[10px] font-black uppercase tracking-widest", aiMicActive ? "text-info" : "text-muted-foreground/40")}>
                          {aiMicActive ? "Active" : "Disabled"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center flex-1 shrink-0">
                    {!aiSessionActive ? (
                      <button
                        onClick={() => {
                          if (!isCameraActive || !aiMicActive) {
                            toast.error("Please turn on your camera and microphone first to start the baseline session.", {
                              description: "Behavioral sensing requires both inputs for real-time analysis."
                            });
                            return;
                          }
                          setAiStartSignal(Date.now());
                        }}
                        disabled={aiSessionStarting}
                        className="bg-primary text-white px-6 py-2 rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(var(--accent-rgb),0.3)] hover:scale-105 active:scale-95 transition-all flex items-center gap-2.5 disabled:opacity-50 whitespace-nowrap"
                      >
                        {aiSessionStarting ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play size={14} fill="currentColor" />}
                        Start AI Session
                      </button>
                    ) : (
                      <button
                        onClick={() => setIsStopAlertOpen(true)}
                        disabled={aiSessionEnding}
                        className="bg-destructive text-white px-6 py-2 rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(239,68,68,0.3)] hover:scale-105 active:scale-95 transition-all flex items-center gap-2.5 disabled:opacity-50 whitespace-nowrap"
                      >
                        {aiSessionEnding ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Square size={14} fill="currentColor" />}
                        Stop AI Session
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-1 justify-end">
                    <button
                      onClick={toggleCamera}
                      className={clsx(
                        "flex items-center gap-2 px-4 py-2 rounded-2xl border transition-all uppercase text-[9px] font-black tracking-[0.1em]",
                        isCameraActive ? "bg-primary/10 border-primary/40 text-primary shadow-inner" : "bg-muted/20 border-border text-muted-foreground hover:bg-muted/40"
                      )}
                    >
                      <Video size={14} className={clsx(isCameraActive && "animate-pulse")} />
                      {isCameraActive ? "Stop Cam" : "Cam"}
                    </button>
                    <button
                      onClick={() => setAiMicActive(!aiMicActive)}
                      className={clsx(
                        "flex items-center gap-2 px-4 py-2 rounded-2xl border transition-all uppercase text-[9px] font-black tracking-[0.1em]",
                        aiMicActive ? "bg-info/10 border-info/40 text-info shadow-inner" : "bg-muted/20 border-border text-muted-foreground hover:bg-muted/40"
                      )}
                    >
                      <Mic size={14} className={clsx(aiMicActive && "animate-pulse")} />
                      {aiMicActive ? "Stop Mic" : "Mic"}
                    </button>
                    {isCameraActive && (
                      <button
                        onClick={() => setShowMesh(!showMesh)}
                        className={clsx(
                          "flex items-center gap-2 px-4 py-2 rounded-2xl border transition-all uppercase text-[9px] font-black tracking-[0.1em]",
                          showMesh ? "bg-primary/10 border-primary/40 text-primary shadow-inner" : "bg-muted/20 border-border text-muted-foreground hover:bg-muted/40"
                        )}
                      >
                        <Activity size={14} className={clsx(showMesh && "animate-pulse")} />
                        Mesh
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Meta Info */}
              <div className="mt-6 flex flex-wrap justify-center gap-4">
                <div className="flex items-center gap-2.5 text-[10px] font-medium text-success bg-success/10 px-4 py-2 rounded-lg border border-success/20 uppercase tracking-widest">
                  <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></div>
                  Privacy: Edge_Only
                </div>
                <div className="flex items-center gap-2.5 text-[10px] font-medium px-4 py-2 rounded-lg border uppercase tracking-widest bg-primary/10 text-primary border-primary/20">
                  Module: Intelligence_Core
                </div>
                {isCameraActive && (
                  <div className="flex items-center gap-2.5 text-[10px] font-medium text-muted-foreground bg-muted/50 px-4 py-2 rounded-lg border border-border uppercase tracking-widest">
                    Tracking: {showMesh ? "Visual" : "Background"}
                  </div>
                )}
                {metrics.isSyncing && (
                  <div className="flex items-center gap-2.5 text-[10px] font-medium text-primary bg-primary/10 px-4 py-2 rounded-lg border border-primary/30 uppercase tracking-widest animate-pulse">
                    <Activity size={12} />
                    Fusion: Active
                  </div>
                )}
              </div>

              {/* Behavioral Metrics Dashboard */}
              {isCameraActive && (
                <div className="w-full mt-4 pt-4 border-t border-border/50 grid grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-medium uppercase tracking-widest text-card-foreground">Eye Contact</span>
                      <span className={clsx("text-[9px] font-bold", metrics.ear < 0.2 ? "text-destructive" : "text-success")}>
                        {metrics.ear < 0.2 ? "LOOKING AWAY" : "FOCUSED"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={clsx("h-full transition-all duration-300", metrics.ear < 0.2 ? "bg-destructive" : "bg-primary")}
                        style={{ width: `${Math.min(100, (metrics.ear / 0.3) * 100)}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-medium uppercase tracking-widest text-card-foreground">Expression</span>
                      <span className={clsx("text-[9px] font-bold", metrics.mar > 0.3 ? "text-primary" : "text-card-foreground")}>
                        {metrics.mar > 0.3 ? "SPEAKING" : "NEUTRAL"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-secondary transition-all duration-300"
                        style={{ width: `${Math.min(100, (metrics.mar / 0.6) * 100)}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-medium uppercase tracking-widest text-card-foreground">Head Alignment</span>
                      <span className={clsx(
                        "text-[9px] font-bold",
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
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-medium uppercase tracking-widest text-primary">Vocal Affect</span>
                      <span className="text-[9px] font-bold text-primary uppercase">
                        {metrics.emotion} • {Math.round(metrics.confidence * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-primary transition-all duration-700"
                        style={{ width: `${metrics.confidence * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* AI Chatbot Section */}
          <div className="lg:col-span-1 order-2 animate-in fade-in slide-in-from-right-8 duration-700 h-full min-h-0 flex flex-col">
            <AIChatbot
              isListening={aiMicActive}
              setIsListening={setAiMicActive}
              hasPermission={aiHasMicPermission}
              setHasPermission={setAiHasMicPermission}
              onNudge={handleNudge}
              metrics={metrics}
              setMetrics={setMetrics}
              discardSignal={aiDiscardSignal}
              startSignal={aiStartSignal}
              isCameraActive={isCameraActive}
              onSessionStateChange={(isActive, isStarting, isEnding, isSpeaking) => {
                setAiSessionActive(isActive);
                aiSessionActiveRef.current = isActive;
                setAiSessionStarting(isStarting);
                setAiSessionEnding(isEnding);
                setIsAiSpeaking(isSpeaking);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
