import React, { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Webcam from 'react-webcam';
import { Video, Activity, Mic, X, Play, Square, PictureInPicture2, MonitorUp } from 'lucide-react';
import { useNudgeSensing } from '../../hooks/useNudgeSensing';
import { mcaService } from '../../services/mca/mcaService';
import { API_URL } from '../../lib/config';
import { analyticsService } from '../../services/analytics/analyticsService';
import { integrateCompletedSession } from '../Analytics/analyticsIntegrationUtils';
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

// word-wrap for canvas text — canvas has no native text-wrapping
function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (currentLine && ctx.measureText(testLine).width > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

const MultimodalEngine = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const showMesh = searchParams.get('mesh') !== 'false';

  const [liveSessionId, setLiveSessionId] = useState(null);
  const [isLiveStarting, setIsLiveStarting] = useState(false);

  // Extra per-frame canvas drawing (the PiP timer/nudge overlay below) — a
  // ref so useNudgeSensing's onResults callback stays stable across renders.
  const frameOverlayRef = useRef(null);
  const {
    webcamRef, canvasRef, metrics,
    isCameraActive, isMicActive: liveMicActive,
    toggleCamera, toggleMic: rawToggleMic, dismissNudge,
    nudges: sensedNudges,
  } = useNudgeSensing({ frameOverlayRef, showMesh });

  // Sensing (camera/mic) can start before the live session record exists —
  // the toggles are available immediately. Nudges only surface once a
  // session is actually running, matching the original gated behaviour.
  const nudges = liveSessionId ? sensedNudges : [];

  // Meeting audio (other participant, shared tab/system audio) — optional,
  // used only to feed the live-mode LLM scorer alongside the user's own voice.
  const [liveMeetingAudioActive, setLiveMeetingAudioActive] = useState(false);
  const meetingAudioStreamRef = useRef(null);

  // Continuous transcription (both streams -> /api/stt) for live-mode LLM scoring.
  const userTranscribeRecorderRef = useRef(null);
  const meetingTranscribeRecorderRef = useRef(null);
  const liveUserTranscriptRef = useRef([]);
  const liveMeetingTranscriptRef = useRef([]);

  const liveSessionIdRef = useRef(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const sessionTimerRef = useRef(null);
  const liveNudgeLogRef = useRef([]);
  const liveEmotionCountsRef = useRef({}); 
  const [isStopAlertOpen, setIsStopAlertOpen] = useState(false);
  const [navAlertTarget, setNavAlertTarget] = useState(null);
  const [isLiveEnding, setIsLiveEnding] = useState(false);
  const [friendlyId, setFriendlyId] = useState(null);

  // Picture-in-Picture (Meet-style floating mini view when the tab is minimized or
  // switched away from). Uses the native <video> Picture-in-Picture API.
  const pipVideoRef = useRef(null);
  const pipCaptureStreamRef = useRef(null);
  const [isPipActive, setIsPipActive] = useState(false);
  const isPipActiveRef = useRef(false);
  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled;

  // Mirrors of state that onResults (a stable useCallback) needs to read fresh
  // values from without being recreated every render — same pattern as showMeshRef.
  const nudgesRef = useRef([]);
  const sessionDurationRef = useRef(0);

  // Continuously transcribes a media/shared windows media stream in short
  // self-contained, back-to-back segments
  const startTranscriptionLoop = useCallback((stream, targetRef, recorderRef, segmentMs = 8000) => {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recordSegment = () => {
      if (!stream.active) return;

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      const segmentElapsedSeconds = sessionDurationRef.current;

      recorder.onstop = async () => {
        // Torn down (externally stopped/superseded) or stream ended mid-segment.
        if (recorderRef.current !== recorder || !stream.active) return;

        // Restart immediately (not after another segmentMs) so recording is
        // back-to-back with no silent gap between segments.
        recordSegment();

        if (chunks.length === 0) return;
        const blob = new Blob(chunks, { type: mimeType });
        try {
          const res = await fetch(`${API_URL}/api/stt`, {
            method: 'POST',
            headers: { 'Content-Type': mimeType },
            body: blob,
          });
          if (!res.ok) return;
          const data = await res.json();
          const transcript = (data.transcript || '').trim();
          if (transcript) {
            targetRef.current = [...targetRef.current, { text: transcript, elapsed_seconds: segmentElapsedSeconds }];
          }
        } catch (err) {
          console.error('[Live transcription] STT request failed:', err);
        }
      };

      recorder.start();
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, segmentMs);
    };

    recordSegment();
  }, []);

  // Mirror new nudges into the session log (was handleNudge's job before nudge
  // firing moved into useNudgeSensing) and keep nudgesRef fresh for the PiP
  // overlay. lastLoggedNudgeIdRef guards against re-logging the same nudge on
  // every re-render of this effect.
  const lastLoggedNudgeIdRef = useRef(null);
  useEffect(() => {
    nudgesRef.current = nudges;
    const latest = nudges[0];
    if (latest && lastLoggedNudgeIdRef.current !== latest.id) {
      lastLoggedNudgeIdRef.current = latest.id;
      liveNudgeLogRef.current = [
        ...liveNudgeLogRef.current,
        {
          message: latest.text,
          category: latest.category,
          severity: latest.severity,
          timestamp: latest.timestamp,
          elapsed_seconds: sessionDurationRef.current,
        },
      ];
    }
  }, [nudges]);

  // liveEmotionCountsRef used to be updated inline in the WS onmessage handler
  // (now inside useNudgeSensing); approximate the same distribution stat by
  // watching the hook's own emotion readout instead.
  useEffect(() => {
    if (!metrics.emotion || metrics.emotion === 'Sensing...') return;
    const emo = metrics.emotion.toLowerCase();
    liveEmotionCountsRef.current[emo] = (liveEmotionCountsRef.current[emo] || 0) + 1;
  }, [metrics.emotion]);

  useEffect(() => {
    sessionDurationRef.current = sessionDuration;
  }, [sessionDuration]);

  // Reflect the browser's own enter/exit PiP events into state (drives the "Popped
  // Out" button label and the main-tab overlay)
  useEffect(() => {
    const video = pipVideoRef.current;
    if (!video) return undefined;
    const onEnter = () => { setIsPipActive(true); isPipActiveRef.current = true; };
    const onLeave = () => { setIsPipActive(false); isPipActiveRef.current = false; };
    video.addEventListener('enterpictureinpicture', onEnter);
    video.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter);
      video.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [isCameraActive]);

  // Opens the floating PiP window.
  const openPip = useCallback(async (silent = false) => {
    if (!pipSupported || !pipVideoRef.current || document.pictureInPictureElement) return;
    const video = pipVideoRef.current;
    try {
      // Self-heal: re-sync from the mirrored canvas capture stream here too
      if (!pipCaptureStreamRef.current && canvasRef.current?.captureStream) {
        pipCaptureStreamRef.current = canvasRef.current.captureStream(25);
      }
      if (pipCaptureStreamRef.current && video.srcObject !== pipCaptureStreamRef.current) {
        video.srcObject = pipCaptureStreamRef.current;
      }
      if (!video.srcObject) {
        if (!silent) toast.error("Camera isn't ready yet — try again in a moment.");
        return;
      }
      if (video.paused) {
        await video.play().catch(() => {});
      }
      // requestPictureInPicture needs actual frame data — wait for it if the video just got its source
      if (video.readyState < 2) {
        await new Promise((resolve) => {
          video.addEventListener('loadeddata', resolve, { once: true });
          setTimeout(resolve, 2000); // safety timeout — don't hang forever
        });
      }
      await video.requestPictureInPicture();
    } catch (err) {
      console.warn('[MCA] Could not enter Picture-in-Picture:', err);
      if (!silent) {
        toast.error("Couldn't open the floating window.", { description: err?.message || String(err) });
      }
    }
  }, [pipSupported]);

  const closePip = useCallback(() => {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
  }, []);

  // Pop out automatically on minimize/tab-switch, and close automatically on return.
  useEffect(() => {
    if (!pipSupported) return undefined;
    const handleVisibility = () => {
      if (document.hidden) {
        if (liveSessionIdRef.current && isCameraActive && !document.pictureInPictureElement) {
          openPip(/* silent */ true);
        }
      } else {
        closePip();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Supplementary signal: on some platforms, minimizing the browser window fires
    // window "blur" without (or slightly before) document.visibilitychange.
    const handleBlur = () => {
      if (document.hidden && liveSessionIdRef.current && isCameraActive && !document.pictureInPictureElement) {
        openPip(/* silent */ true);
      }
    };
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
    };
  }, [pipSupported, isCameraActive, openPip, closePip]);

  // Exit PiP if the component unmounts (session ended, navigated away).
  useEffect(() => {
    return () => {
      if (document.pictureInPictureElement === pipVideoRef.current) {
        document.exitPictureInPicture().catch(() => {});
      }
    };
  }, []);

  // Warn on navigation if session is active
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (liveSessionId) {
        e.preventDefault();
        e.returnValue = 'You have an active Live session. Are you sure you want to leave?';
      }
    };

    const handleGlobalClick = (e) => {
      if (!liveSessionId) return;
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
  }, [liveSessionId]);

  // MCA's mic toggle used to do two things at once: open the nudge-sensing
  // WS/stream (now owned by useNudgeSensing) AND record a separate continuous
  // stream for the live-mode LLM transcript scorer. The hook owns its
  // getUserMedia call internally, so transcription needs its own independent
  // getUserMedia call — the same "two mic consumers, no conflict" pattern the
  // hook is designed to support.
  const userTranscribeStreamRef = useRef(null);

  const startUserTranscription = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      userTranscribeStreamRef.current = stream;
      startTranscriptionLoop(stream, liveUserTranscriptRef, userTranscribeRecorderRef);
    } catch (err) {
      console.error('User transcription capture error:', err);
    }
  }, [startTranscriptionLoop]);

  const stopUserTranscription = useCallback(() => {
    if (userTranscribeRecorderRef.current) {
      const recorder = userTranscribeRecorderRef.current;
      userTranscribeRecorderRef.current = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    if (userTranscribeStreamRef.current) {
      userTranscribeStreamRef.current.getTracks().forEach(track => track.stop());
      userTranscribeStreamRef.current = null;
    }
  }, []);

  const toggleLiveMic = useCallback(() => {
    if (liveMicActive) {
      stopUserTranscription();
    } else {
      startUserTranscription();
    }
    rawToggleMic();
  }, [liveMicActive, rawToggleMic, startUserTranscription, stopUserTranscription]);

  // Ref mirrors so the unmount-cleanup effect below (fixed [] deps — its
  // closure is only ever this component's very first render) can still act
  // on current state and call the current toggle behaviour instead of a
  // stale one. toggleCamera/toggleLiveMic are relative toggles, not absolute
  // stops, so calling a stale version could flip something back on.
  const liveMicActiveRef = useRef(false);
  const isCameraActiveRef = useRef(false);
  const toggleLiveMicRef = useRef(() => {});
  const toggleCameraRef = useRef(() => {});
  liveMicActiveRef.current = liveMicActive;
  isCameraActiveRef.current = isCameraActive;
  toggleLiveMicRef.current = toggleLiveMic;
  toggleCameraRef.current = toggleCamera;

  // Session timer + latest-nudge overlay, burned directly onto the same
  // mirrored/mesh canvas useNudgeSensing draws every frame — only while
  // actually popped out into Picture-in-Picture. Injected via frameOverlayRef
  // so useNudgeSensing's own onResults callback stays stable across renders.
  const drawPipOverlay = useCallback((canvasCtx, canvasElement) => {
    if (isPipActiveRef.current) {
      const w = canvasElement.width;
      const h = canvasElement.height;
      const scale = w / 320; // keep sizes legible and consistent across camera resolutions
      const PANEL_BG = 'rgba(15, 15, 20, 0.78)';
      const BORDER = 'rgba(255, 255, 255, 0.14)';

      canvasCtx.save();
      canvasCtx.textBaseline = 'middle';

      // Session timer — rounded pill, top-left
      const mins = Math.floor(sessionDurationRef.current / 60);
      const secs = (sessionDurationRef.current % 60).toString().padStart(2, '0');
      const timerText = `${mins}:${secs}`;
      const pillH = 30 * scale;
      const pillPadX = 12 * scale;
      const dotR = 4 * scale;

      canvasCtx.font = `700 ${15 * scale}px -apple-system, system-ui, sans-serif`;
      const timerW = canvasCtx.measureText(timerText).width;
      const pillW = dotR * 2 + 8 * scale + timerW + pillPadX * 2;
      const pillX = 10 * scale;
      const pillY = 10 * scale;

      canvasCtx.fillStyle = PANEL_BG;
      canvasCtx.strokeStyle = BORDER;
      canvasCtx.lineWidth = 1;
      canvasCtx.beginPath();
      canvasCtx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
      canvasCtx.fill();
      canvasCtx.stroke();

      canvasCtx.fillStyle = '#00bb87';
      canvasCtx.beginPath();
      canvasCtx.arc(pillX + pillPadX + dotR, pillY + pillH / 2, dotR, 0, Math.PI * 2);
      canvasCtx.fill();

      canvasCtx.fillStyle = '#ffffff';
      canvasCtx.fillText(timerText, pillX + pillPadX + dotR * 2 + 8 * scale, pillY + pillH / 2 + 1);

      const latestNudge = nudgesRef.current[0];
      if (latestNudge) {
        const SEVERITY_STYLE = {
          critical: { color: '#ec5a63', label: 'Critical' }, // --destructive / --danger
          warning:  { color: '#e4a339', label: 'Warning' },  // --warning
        };
        const sev = SEVERITY_STYLE[latestNudge.severity] || { color: '#926dff', label: 'Info' }; // --primary / --accent

        const fontSize = 12.5 * scale;
        const lineHeight = fontSize * 1.4;
        const labelHeight = 11 * scale;
        const panelPad = 14 * scale;
        const iconSize = 26 * scale;
        const gapIconText = 10 * scale;
        const marginX = 10 * scale;
        const radius = 16 * scale;
        const textX0 = panelPad + iconSize + gapIconText;
        const maxTextWidth = w - marginX * 2 - panelPad * 2 - iconSize - gapIconText;

        canvasCtx.font = `500 ${fontSize}px -apple-system, system-ui, sans-serif`;
        const lines = wrapCanvasText(canvasCtx, latestNudge.text, maxTextWidth).slice(0, 2);

        const panelH = panelPad * 2 + labelHeight + 4 * scale + lines.length * lineHeight;
        const panelW = w - marginX * 2;
        const panelX = marginX;
        const panelY = h - panelH - 12 * scale;

        // Elevation shadow, cast by the card only
        canvasCtx.save();
        canvasCtx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        canvasCtx.shadowBlur = 18 * scale;
        canvasCtx.shadowOffsetY = 6 * scale;
        const bgGrad = canvasCtx.createLinearGradient(0, panelY, 0, panelY + panelH);
        bgGrad.addColorStop(0, 'rgba(30, 30, 38, 0.90)');
        bgGrad.addColorStop(1, 'rgba(14, 14, 19, 0.94)');
        canvasCtx.beginPath();
        canvasCtx.roundRect(panelX, panelY, panelW, panelH, radius);
        canvasCtx.fillStyle = bgGrad;
        canvasCtx.fill();
        canvasCtx.restore();

        // Faint severity-tinted border for a subtle glow edge
        canvasCtx.beginPath();
        canvasCtx.roundRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1, radius);
        canvasCtx.strokeStyle = `${sev.color}55`;
        canvasCtx.lineWidth = 1.25 * scale;
        canvasCtx.stroke();

        // Icon badge — glowing ring with a solid centre dot
        const iconCx = panelX + panelPad + iconSize / 2;
        const iconCy = panelY + panelH / 2;
        canvasCtx.save();
        canvasCtx.shadowColor = sev.color;
        canvasCtx.shadowBlur = 10 * scale;
        canvasCtx.beginPath();
        canvasCtx.arc(iconCx, iconCy, iconSize / 2, 0, Math.PI * 2);
        canvasCtx.fillStyle = `${sev.color}2A`;
        canvasCtx.fill();
        canvasCtx.restore();
        canvasCtx.beginPath();
        canvasCtx.arc(iconCx, iconCy, iconSize / 2, 0, Math.PI * 2);
        canvasCtx.strokeStyle = sev.color;
        canvasCtx.lineWidth = 1.5 * scale;
        canvasCtx.stroke();
        canvasCtx.beginPath();
        canvasCtx.arc(iconCx, iconCy, 4 * scale, 0, Math.PI * 2);
        canvasCtx.fillStyle = sev.color;
        canvasCtx.fill();

        // Text block — uppercase category label, then the wrapped message
        const textX = panelX + textX0;
        let textY = panelY + panelPad;
        canvasCtx.textBaseline = 'top';

        canvasCtx.font = `700 ${10 * scale}px -apple-system, system-ui, sans-serif`;
        canvasCtx.fillStyle = sev.color;
        canvasCtx.fillText(sev.label.toUpperCase(), textX, textY);
        textY += labelHeight + 4 * scale;

        canvasCtx.font = `500 ${fontSize}px -apple-system, system-ui, sans-serif`;
        canvasCtx.fillStyle = '#f4f4f6';
        lines.forEach((line, i) => {
          canvasCtx.fillText(line, textX, textY + lineHeight * i);
        });

        canvasCtx.textBaseline = 'middle';
      }

      canvasCtx.textBaseline = 'alphabetic';
      canvasCtx.restore();
    }

    // Keep the PiP video fed from this same mirrored/mesh-overlaid canvas
    if (!pipCaptureStreamRef.current && canvasElement.captureStream) {
      pipCaptureStreamRef.current = canvasElement.captureStream(25);
    }
    if (pipVideoRef.current && pipCaptureStreamRef.current && pipVideoRef.current.srcObject !== pipCaptureStreamRef.current) {
      pipVideoRef.current.srcObject = pipCaptureStreamRef.current;
      pipVideoRef.current.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    frameOverlayRef.current = drawPipOverlay;
  }, [drawPipOverlay]);

  // Optional: capture the "meeting" voice (other participant) via a shared
  // tab/system audio track, so the live-mode LLM scorer can weigh both
  // sides of the conversation.
  const stopMeetingAudioCapture = () => {
    setLiveMeetingAudioActive(false);
    if (meetingTranscribeRecorderRef.current) {
      const recorder = meetingTranscribeRecorderRef.current;
      meetingTranscribeRecorderRef.current = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    if (meetingAudioStreamRef.current) {
      meetingAudioStreamRef.current.getTracks().forEach(track => track.stop());
      meetingAudioStreamRef.current = null;
    }
  };

  const startMeetingAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach(track => track.stop());
        toast.warning("No shared audio detected.", {
          description: "Re-share and tick 'Share audio' to include meeting voice in scoring."
        });
        return;
      }

      // Video is only required by the browser to grant the share; drop it.
      stream.getVideoTracks().forEach(track => track.stop());

      meetingAudioStreamRef.current = stream;
      setLiveMeetingAudioActive(true);
      startTranscriptionLoop(stream, liveMeetingTranscriptRef, meetingTranscribeRecorderRef);

      // Sharing can be stopped from the browser's own "Stop sharing" bar.
      stream.getAudioTracks()[0].addEventListener('ended', stopMeetingAudioCapture);
    } catch (err) {
      // User cancelled the share prompt — not an error, just stay opted-out.
      if (err?.name !== 'NotAllowedError') {
        console.error('Meeting audio capture error:', err);
      }
    }
  };

  const toggleMeetingAudio = () => {
    if (liveMeetingAudioActive) {
      stopMeetingAudioCapture();
      return;
    }
    startMeetingAudioCapture();
  };

  // Unconditional, idempotent-safe teardown for both mic paths + camera.
  // toggleCamera/toggleLiveMic are relative toggles, not absolute stops, so
  // this only flips them when the ref-mirrored "current" value says they're
  // still on. Stable identity (empty deps) + ref reads keep this correct even
  // when invoked from the unmount-cleanup effect's fixed first-render closure.
  const stopAllSensing = useCallback(() => {
    if (liveMicActiveRef.current) toggleLiveMicRef.current();
    stopMeetingAudioCapture();
    if (isCameraActiveRef.current) toggleCameraRef.current();
  }, []);

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
    liveUserTranscriptRef.current = [];
    liveMeetingTranscriptRef.current = [];
    setSessionDuration(0);
    try {
      const session = await mcaService.startSession('live');
      if (session.id && session.status === 'active') {
        setLiveSessionId(session.id);
        liveSessionIdRef.current = session.id;
        setFriendlyId(session.friendly_id);
        sessionTimerRef.current = setInterval(() => {
          setSessionDuration(prev => prev + 1);
        }, 1000);
        toast.success("Live session started.");
      } else {
        toast.error("Failed to initialize session on server.");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
      toast.error("Couldn't start the session", {
        description: errorMsg
      });
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
    stopAllSensing();
    if (sid) {
      setLiveSessionId(null);
      liveSessionIdRef.current = null;
      try {
        const total = Object.values(liveEmotionCountsRef.current).reduce((a, b) => a + b, 0);
        const distribution = {};
        if (total > 0) {
          Object.entries(liveEmotionCountsRef.current).forEach(([emo, count]) => {
            distribution[emo.toLowerCase()] = count / total;
          });
        }

        const res = await mcaService.endSession(
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
          },
          liveUserTranscriptRef.current,
          liveMeetingTranscriptRef.current
        );
        if (res.id && res.status === 'completed') {
          toast.success("Live session ended and data saved.");

          // Hand the finished session to the analytics module immediately, so
          // scores, XP and the adapted training plan are ready by the time the
          // learner lands on the feedback page. Fire-and-forget: never throws.
          integrateCompletedSession(analyticsService, sid);

          const redirectUrl = `/analytics/sessions/${sid}/feedback?friendlyId=${encodeURIComponent(friendlyId)}`;
          setTimeout(() => navigate(redirectUrl), 1500);
        } else {
          toast.error("Session closed but data persistence may be incomplete.");
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Connection interrupted.";
        toast.error("Connection interrupted", {
          description: errorMsg
        });
      } finally {
        setIsLiveEnding(false);
      }
    } else {
      setIsLiveEnding(false);
    }
  };

  useEffect(() => {
    return () => {
      realEndLiveSession();
    };
  }, []);

  // The <canvas> unmounts/remounts with the camera (new DOM node each time,
  // owned by useNudgeSensing's own camera lifecycle) — clear the stale
  // captureStream so drawPipOverlay recreates it against the new node.
  useEffect(() => {
    if (!isCameraActive) {
      pipCaptureStreamRef.current = null;
    }
  }, [isCameraActive]);

  const toggleMesh = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('mesh', (!showMesh).toString());
    setSearchParams(newParams);
  };

  return (
    <div className="w-full flex flex-col items-center p-4 md:p-8 font-sans antialiased relative h-[calc(100vh-48px)] overflow-hidden">
      <div className="absolute top-8 right-8 z-[100] flex flex-col gap-3 pointer-events-none items-end">
        {nudges.map((nudge, index) => (
          <div
            key={nudge.id}
            className={clsx(
              "backdrop-blur-2xl border px-6 py-3.5 rounded-2xl shadow-2xl flex items-center gap-4 transition-all duration-500 animate-in fade-in slide-in-from-right-8 pointer-events-auto group/nudge hover:scale-105",
              nudge.severity === 'critical' ? "bg-[var(--nudge-critical-bg)] border-white/30 text-white" :
                nudge.severity === 'warning' ? "bg-[var(--nudge-warning-bg)] border-white/30 text-white" :
                  "bg-[var(--nudge-info-bg)] border-white/20 text-white",
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
              onClick={() => dismissNudge(nudge.id)}
              className="ml-2 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center opacity-0 group-hover/nudge:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="w-full flex-1 min-h-0 flex flex-col gap-6 transition-all duration-700 ease-in-out max-w-[1600px] h-full">
        <div className="text-center space-y-1">
          <h1 className="t-h1" style={{ fontSize: 28 }}>
            EmpowerZ <span style={{ color: 'var(--accent)', fontWeight: 600 }}>MCA</span>
          </h1>
          <p className="t-over" style={{ marginTop: 4 }}>
            Live analyzing, powered by your voice and camera
          </p>
          {liveSessionId && (
            <div className="pt-2 flex items-center justify-center gap-3 animate-in fade-in zoom-in duration-500">
              <div className="px-3 py-1 bg-success/10 border border-success/20 rounded-full flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                <span className="text-[10px] font-medium text-success tracking-widest uppercase">
                  Session Active: {Math.floor(sessionDuration / 60)}:{(sessionDuration % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>
          )}
        </div>

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
                  realEndLiveSession();
                  setIsStopAlertOpen(false);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                End Session
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
                You have an active Live session running. If you leave this page, your session will be ended. Are you sure you want to leave?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setNavAlertTarget(null)}>Stay in Session</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  realEndLiveSession();
                  const target = navAlertTarget;
                  setNavAlertTarget(null);
                  navigate(target);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                End & Leave
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex-1 grid gap-6 transition-all duration-700 ease-in-out min-h-0 grid-cols-1">
          <div className="relative group transition-all duration-700 ease-in-out order-1 flex flex-col min-h-0 col-span-1">
            <div className="relative p-4 md:p-6 bg-surface border border-border-subtle rounded-2xl flex flex-col items-center h-full min-h-0 overflow-y-auto custom-scrollbar">

              <div className="w-full aspect-video relative overflow-hidden bg-muted/50 rounded-xl border flex flex-col items-center justify-center group/window transition-all duration-500 border-secondary/20 hover:border-secondary/40">

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
                    {/* Feeds the native Picture-in-Picture window (see openPip). */}
                    <video
                      ref={pipVideoRef}
                      autoPictureInPicture
                      autoPlay
                      muted
                      playsInline
                      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                    />
                  </>
                ) : (
                  <>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] via-transparent to-transparent opacity-30 from-secondary/10"></div>

                    <div className="relative flex flex-col items-center gap-4">
                      <div className="p-10 border-2 border-dashed rounded-2xl font-mono text-[10px] uppercase tracking-[0.2em] animate-pulse transition-colors text-center font-bold border-secondary/20 text-secondary group-hover/window:border-secondary/40">
                        Camera's off<br />
                        <span className="text-[8px] opacity-60 mt-2 block tracking-normal">Turn on your camera to begin</span>
                      </div>
                    </div>
                  </>
                )}

                {isPipActive && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm rounded-xl">
                    <PictureInPicture2 size={28} className="text-primary animate-pulse" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Live view popped out</p>
                    <button
                      onClick={closePip}
                      className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline"
                    >
                      Bring it back
                    </button>
                  </div>
                )}

                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-0">
                  <div className="flex flex-col gap-4 pointer-events-auto">
                    {!isCameraActive && (
                      <button
                        onClick={toggleCamera}
                        className="bg-primary text-white px-6 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-lg hover:bg-primary/90 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 pointer-events-auto"
                      >
                        <Video size={14} />
                        Turn on camera
                      </button>
                    )}
                    {!liveMicActive && (
                      <button
                        onClick={toggleLiveMic}
                        className="bg-secondary text-secondary-foreground px-6 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-lg hover:bg-secondary/90 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 pointer-events-auto"
                      >
                        <Mic size={14} />
                        Turn on microphone
                      </button>
                    )}
                  </div>
                </div>

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
                        <div className={clsx("w-2 h-2 rounded-full transition-all duration-500", liveMicActive ? "bg-info shadow-[0_0_8px_rgba(59,130,246,0.6)]" : "bg-muted-foreground/30")} />
                        <span className={clsx("text-[10px] font-black uppercase tracking-widest", liveMicActive ? "text-info" : "text-muted-foreground/40")}>
                          {liveMicActive ? "Active" : "Disabled"}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-muted-foreground font-black tracking-[0.2em] uppercase opacity-60">Meeting Audio</span>
                      <div className="flex items-center gap-2.5">
                        <div className={clsx("w-2 h-2 rounded-full transition-all duration-500", liveMeetingAudioActive ? "bg-info shadow-[0_0_8px_rgba(59,130,246,0.6)]" : "bg-muted-foreground/30")} />
                        <span className={clsx("text-[10px] font-black uppercase tracking-widest", liveMeetingAudioActive ? "text-info" : "text-muted-foreground/40")}>
                          {liveMeetingAudioActive ? "Active" : "Optional"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center flex-1 shrink-0">
                    {!liveSessionId ? (
                      <button
                        onClick={startLiveSession}
                        disabled={isLiveStarting}
                        className="bg-primary text-white px-6 py-2 rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(var(--accent-rgb),0.3)] hover:scale-105 active:scale-95 transition-all flex items-center gap-2.5 disabled:opacity-50 whitespace-nowrap"
                      >
                        {isLiveStarting ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play size={14} fill="currentColor" />}
                        Start Session
                      </button>
                    ) : (
                      <button
                        onClick={() => setIsStopAlertOpen(true)}
                        disabled={isLiveEnding}
                        className="bg-destructive text-white px-6 py-2 rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(239,68,68,0.3)] hover:scale-105 active:scale-95 transition-all flex items-center gap-2.5 disabled:opacity-50 whitespace-nowrap"
                      >
                        {isLiveEnding ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Square size={14} fill="currentColor" />}
                        Stop Session
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
                      onClick={toggleLiveMic}
                      className={clsx(
                        "flex items-center gap-2 px-4 py-2 rounded-2xl border transition-all uppercase text-[9px] font-black tracking-[0.1em]",
                        liveMicActive ? "bg-info/10 border-info/40 text-info shadow-inner" : "bg-muted/20 border-border text-muted-foreground hover:bg-muted/40"
                      )}
                    >
                      <Mic size={14} className={clsx(liveMicActive && "animate-pulse")} />
                      {liveMicActive ? "Stop Mic" : "Mic"}
                    </button>
                    <button
                      onClick={toggleMeetingAudio}
                      title="Optional: share your meeting tab/window with audio so both voices feed the session score"
                      className={clsx(
                        "flex items-center gap-2 px-4 py-2 rounded-2xl border transition-all uppercase text-[9px] font-black tracking-[0.1em]",
                        liveMeetingAudioActive ? "bg-info/10 border-info/40 text-info shadow-inner" : "bg-muted/20 border-border text-muted-foreground hover:bg-muted/40"
                      )}
                    >
                      <MonitorUp size={14} className={clsx(liveMeetingAudioActive && "animate-pulse")} />
                      {liveMeetingAudioActive ? "Stop Meeting Audio" : "Meeting Audio"}
                    </button>
                    {isCameraActive && (
                      <button
                        onClick={toggleMesh}
                        className={clsx(
                          "flex items-center gap-2 px-4 py-2 rounded-2xl border transition-all uppercase text-[9px] font-black tracking-[0.1em]",
                          showMesh ? "bg-primary/10 border-primary/40 text-primary shadow-inner" : "bg-muted/20 border-border text-muted-foreground hover:bg-muted/40"
                        )}
                      >
                        <Activity size={14} className={clsx(showMesh && "animate-pulse")} />
                        Mesh
                      </button>
                    )}
                    {pipSupported && isCameraActive && (
                      <button
                        onClick={() => (isPipActive ? closePip() : openPip())}
                        title="Pop out a floating mini window — auto-appears on minimize/tab-switch after first use, and closes automatically when you come back"
                        className={clsx(
                          "flex items-center gap-2 px-4 py-2 rounded-2xl border transition-all uppercase text-[9px] font-black tracking-[0.1em]",
                          isPipActive ? "bg-primary/10 border-primary/40 text-primary shadow-inner" : "bg-muted/20 border-border text-muted-foreground hover:bg-muted/40"
                        )}
                      >
                        <PictureInPicture2 size={14} className={clsx(isPipActive && "animate-pulse")} />
                        {isPipActive ? "Popped Out" : "Pop Out"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap justify-center gap-4">
                <div className="flex items-center gap-2.5 text-[10px] font-medium text-success bg-success/10 px-4 py-2 rounded-lg border border-success/20 uppercase tracking-widest">
                  <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></div>
                  Processed on your device
                </div>
                <div className="flex items-center gap-2.5 text-[10px] font-medium px-4 py-2 rounded-lg border uppercase tracking-widest bg-info/10 text-info border-info/20">
                  Multimodal Analysis
                </div>
                {isCameraActive && (
                  <div className="flex items-center gap-2.5 text-[10px] font-medium text-muted-foreground bg-muted/50 px-4 py-2 rounded-lg border border-border uppercase tracking-widest">
                    Tracking: {showMesh ? "Visual" : "Background"}
                  </div>
                )}
                {metrics.isSyncing && (
                  <div className="flex items-center gap-2.5 text-[10px] font-medium text-primary bg-primary/10 px-4 py-2 rounded-lg border border-primary/30 uppercase tracking-widest animate-pulse">
                    <Activity size={12} />
                    Analyzing your voice and face
                  </div>
                )}
              </div>

              {isCameraActive && (
                <div className="w-full mt-4 pt-4 border-t border-border/50 grid grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-medium uppercase tracking-widest text-card-foreground">Eye Contact</span>
                      <span className={clsx("text-[9px] font-bold", metrics.ear < 0.2 ? "text-destructive" : "text-success")}>
                        {metrics.ear < 0.2 ? "Looking away" : "Focused"}
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
                        {(Math.abs(metrics.pose.yaw) > 0.15 || Math.abs(metrics.pose.pitch) > 0.15) ? "Off-center" : "Centered"}
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
                      <span className="text-[9px] font-medium uppercase tracking-widest text-primary">Voice tone</span>
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
        </div>
      </div>
    </div>
  );
};

export default MultimodalEngine;
