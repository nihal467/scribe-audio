import { useCallback, useEffect, useRef, useState } from "react";

export type LiveRecording = {
  blob: Blob;
  mimeType: string;
  durationSec: number;
  url: string;
};

export type RecorderState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; elapsedSec: number }
  | { kind: "error"; message: string };

/**
 * Pick a MediaRecorder mime type that both the browser AND CARE's
 * `settings.ALLOWED_MIME_TYPES` accept. Ordering matters: opus-in-webm
 * is what Chromium ships by default; mp4/aac is Safari's fallback.
 */
function pickSupportedMime(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) {
      return m;
    }
  }
  return undefined;
}

/**
 * Live microphone recorder. Isolated from any specific panel so both the
 * test-case runner and the ad-hoc questionnaire runner can share it.
 */
export function useAudioRecorder() {
  const [recorderState, setRecorderState] = useState<RecorderState>({ kind: "idle" });
  const [recording, setRecording] = useState<LiveRecording | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);

  const startRecording = useCallback(async () => {
    if (recorderState.kind === "recording" || recorderState.kind === "requesting") return;
    setRecorderState({ kind: "requesting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const finalMime = rec.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: finalMime });
        const durationSec = Math.max(0.1, (Date.now() - startedAtRef.current) / 1000);
        const url = URL.createObjectURL(blob);
        setRecording({ blob, mimeType: finalMime, durationSec, url });
        if (tickRef.current !== null) {
          window.clearInterval(tickRef.current);
          tickRef.current = null;
        }
        setRecorderState({ kind: "idle" });
      };
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      rec.start(1000);
      tickRef.current = window.setInterval(() => {
        setRecorderState({
          kind: "recording",
          elapsedSec: (Date.now() - startedAtRef.current) / 1000,
        });
      }, 250);
      setRecorderState({ kind: "recording", elapsedSec: 0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRecorderState({ kind: "error", message: msg });
      throw new Error(msg);
    }
  }, [recorderState.kind]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const clearRecording = useCallback(() => {
    setRecording((r) => {
      if (r?.url) URL.revokeObjectURL(r.url);
      return null;
    });
  }, []);

  // Ensure any in-flight interval is cleaned up on unmount.
  useEffect(() => {
    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
      }
    };
  }, []);

  return { recorderState, recording, setRecording, startRecording, stopRecording, clearRecording };
}
