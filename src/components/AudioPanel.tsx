import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CircleDot,
  Dices,
  FileAudio,
  Mic,
  MicOff,
  Play,
  Square,
  Tag,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useConnection } from "@/hooks/use-connection";
import {
  audioPreviewUrl,
  loadTestCaseAudio,
  loadTestCaseIndex,
  loadTestCaseManifest,
} from "@/lib/test-cases";
import type { RunUpdate } from "@/lib/scribe-runner";
import type {
  TestCaseIndex,
  TestCaseIndexEntry,
  TestCaseManifest,
} from "@/types";

export type ActiveRunState = {
  caseId: string;
  update: RunUpdate;
  startedAt: number;
};

export type AudioPanelProps = {
  active: ActiveRunState | null;
  onRun: (args: {
    entry: TestCaseIndexEntry;
    manifest: TestCaseManifest;
    audio: Blob;
    modelOverrides: { chatModel?: string; audioModel?: string };
    audioSource: "test-case" | "live-record";
  }) => Promise<void>;
  onCancel: () => void;
};

type LiveRecording = {
  blob: Blob;
  mimeType: string;
  durationSec: number;
  url: string;
};

const STAGE_PERCENT: Record<RunUpdate["stage"], number> = {
  creating: 10,
  uploading: 30,
  "marking-ready": 55,
  polling: 75,
  done: 100,
};

/**
 * Panel 3 — Test case picker (with random selection + tag filter),
 * audio preview, optional model overrides, run trigger + live progress.
 */
export function AudioPanel({ active, onRun, onCancel }: AudioPanelProps) {
  const { api, session } = useConnection();
  const [index, setIndex] = useState<TestCaseIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [chatModel, setChatModel] = useState("");
  const [audioModel, setAudioModel] = useState("");
  const [runPreparing, setRunPreparing] = useState(false);

  // Live recording state
  const [recording, setRecording] = useState<LiveRecording | null>(null);
  const [recorderState, setRecorderState] = useState<
    { kind: "idle" } | { kind: "requesting" } | { kind: "recording"; elapsedSec: number } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  // Free the object URL when the recording is replaced or unmounted.
  useEffect(() => {
    return () => {
      if (recording?.url) URL.revokeObjectURL(recording.url);
    };
  }, [recording]);

  useEffect(() => {
    let alive = true;
    loadTestCaseIndex()
      .then((idx) => {
        if (!alive) return;
        setIndex(idx);
        if (idx.cases.length > 0 && !selectedId) setSelectedId(idx.cases[0].id);
      })
      .catch((err) => alive && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredCases = useMemo(() => {
    if (!index) return [] as TestCaseIndexEntry[];
    if (!tagFilter.trim()) return index.cases;
    const needle = tagFilter.trim().toLowerCase();
    return index.cases.filter((c) => c.tags.some((t) => t.toLowerCase().includes(needle)));
  }, [index, tagFilter]);

  const selected = filteredCases.find((c) => c.id === selectedId) ?? index?.cases.find((c) => c.id === selectedId);

  const pickRandom = useCallback(() => {
    if (filteredCases.length === 0) return;
    const idx = Math.floor(Math.random() * filteredCases.length);
    setSelectedId(filteredCases[idx].id);
  }, [filteredCases]);

  async function handleRun() {
    if (!selected || !api) return;
    setRunPreparing(true);
    try {
      const manifest = await loadTestCaseManifest(selected.id);
      // Prefer the live recording if the user made one; else load the case audio.
      let audio: Blob;
      let audioSource: "test-case" | "live-record";
      let effectiveManifest = manifest;
      if (recording) {
        audio = recording.blob;
        audioSource = "live-record";
        // Override the mime type + duration so the /scribe_file/ POST is accurate.
        effectiveManifest = {
          ...manifest,
          mimeType: recording.mimeType,
          durationSec: recording.durationSec,
          audio: `live-recording.${extFromMime(recording.mimeType)}`,
        };
      } else {
        audio = await loadTestCaseAudio(selected.id, selected);
        audioSource = "test-case";
      }
      await onRun({
        entry: selected,
        manifest: effectiveManifest,
        audio,
        modelOverrides: {
          chatModel: chatModel.trim() || undefined,
          audioModel: audioModel.trim() || undefined,
        },
        audioSource,
      });
    } catch (err) {
      toast.error("Run could not start", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunPreparing(false);
    }
  }

  // ─── Live recording ────────────────────────────────────────────────────

  async function startRecording() {
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
      toast.error("Could not access microphone", { description: msg });
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  function clearRecording() {
    if (recording?.url) URL.revokeObjectURL(recording.url);
    setRecording(null);
  }

  const running = !!active;
  const canRun = !!session && !!selected && !running && !runPreparing;
  const stageLabel = active ? describeStage(active.update) : null;
  const progress = active ? STAGE_PERCENT[active.update.stage] ?? 0 : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileAudio className="h-4 w-4 text-emerald-600" /> Manual Audio + Play Test
            </CardTitle>
            <CardDescription>
              Prerecorded case selected randomly (or manually) from{" "}
              <code>public/test-cases/</code>.
            </CardDescription>
          </div>
          {index && (
            <Badge variant="outline">
              {index.cases.length} case{index.cases.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && (
          <Alert variant="warning">
            <AlertTitle>No test cases found</AlertTitle>
            <AlertDescription>
              {loadError} Run <code>npm run test-cases:index</code> after placing cases under{" "}
              <code>public/test-cases/&lt;id&gt;/</code>.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="case-tag">Filter by tag</Label>
            <div className="relative">
              <Tag className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                id="case-tag"
                className="pl-8"
                placeholder="e.g. vitals, discharge…"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                disabled={running}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>&nbsp;</Label>
            <Button variant="outline" onClick={pickRandom} disabled={running || filteredCases.length === 0}>
              <Dices className="h-4 w-4" /> Pick random
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="case-select">Case</Label>
          <select
            id="case-select"
            className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={running || filteredCases.length === 0}
          >
            {filteredCases.length === 0 && <option value="">— no cases matching filter —</option>}
            {filteredCases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.tags.join(", ") || "(no tags)"} · {c.fieldCount} field
                {c.fieldCount === 1 ? "" : "s"}
              </option>
            ))}
          </select>
          {selected?.notes && <p className="text-xs text-slate-500">{selected.notes}</p>}
        </div>

        {selected && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <audio controls className="w-full" src={audioPreviewUrl(selected.id, selected)} />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{selected.mimeType}</span>
              {selected.durationSec != null && <span>· {selected.durationSec.toFixed(1)}s</span>}
              {selected.tags.map((t) => (
                <Badge key={t} variant="outline">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Live-record — mirrors CARE FE's "Voice Autofill" button.
            When a recording exists it overrides the test-case audio on the next Run
            (scoring is skipped since we have no ground truth for what was said). */}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Mic className="h-4 w-4 text-rose-500" />
              <span>Or record live</span>
              {recording && (
                <Badge variant="info">will override test-case audio</Badge>
              )}
            </div>
            {recording && (
              <button
                type="button"
                onClick={clearRecording}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600"
                disabled={running}
              >
                <Trash2 className="h-3 w-3" /> Clear
              </button>
            )}
          </div>

          {recorderState.kind === "recording" ? (
            <div className="flex items-center gap-3">
              <Button variant="destructive" size="sm" onClick={stopRecording}>
                <Square className="h-4 w-4" /> Stop
              </Button>
              <span className="flex items-center gap-1.5 text-sm">
                <CircleDot className="h-3 w-3 animate-pulse text-red-500" />
                <span className="font-mono">{formatSec(recorderState.elapsedSec)}</span>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={startRecording}
                disabled={running || recorderState.kind === "requesting"}
              >
                {recorderState.kind === "requesting" ? (
                  <>
                    <MicOff className="h-4 w-4" /> Requesting mic…
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" /> Record
                  </>
                )}
              </Button>
              {recorderState.kind === "error" && (
                <span className="text-xs text-red-600">{recorderState.message}</span>
              )}
            </div>
          )}

          {recording && (
            <div className="mt-2 space-y-1">
              <audio controls className="w-full" src={recording.url} />
              <div className="text-xs text-slate-500">
                {recording.mimeType} · {recording.durationSec.toFixed(1)}s ·{" "}
                {(recording.blob.size / 1024).toFixed(1)} KB
              </div>
            </div>
          )}
        </div>

        <details className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer select-none font-medium">Model overrides (optional)</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="chat-model">Chat model</Label>
              <Input
                id="chat-model"
                placeholder="e.g. gpt-4o-mini"
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
                disabled={running}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audio-model">Audio model</Label>
              <Input
                id="audio-model"
                placeholder="e.g. whisper-1"
                value={audioModel}
                onChange={(e) => setAudioModel(e.target.value)}
                disabled={running}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Leave blank to use the backend&apos;s configured defaults.
          </p>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          {!running ? (
            <Button
              variant="primary"
              onClick={handleRun}
              disabled={!canRun}
              className="min-w-[8rem]"
            >
              <Play className="h-4 w-4" />
              {runPreparing
                ? "Preparing…"
                : recording
                  ? "Run with recording"
                  : "Run"}
            </Button>
          ) : (
            <Button variant="destructive" onClick={onCancel}>
              <Square className="h-4 w-4" /> Cancel
            </Button>
          )}
          {!session && <span className="text-xs text-slate-500">Connect to a backend first.</span>}
          {recording && !running && (
            <span className="text-xs text-slate-500">
              Uses <strong>{selected?.name}</strong>&apos;s form schema; scoring skipped.
            </span>
          )}
        </div>

        {active && (
          <div className="space-y-1.5 rounded-lg border border-sky-200 bg-sky-50 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-sky-900">{stageLabel}</span>
              {active.update.status && <Badge variant="info">{active.update.status}</Badge>}
            </div>
            <Progress value={progress} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function describeStage(u: RunUpdate): string {
  switch (u.stage) {
    case "creating":
      return "Creating scribe (benchmark mode)…";
    case "uploading":
      return "Uploading audio…";
    case "marking-ready":
      return "Marking READY (queues transcription)…";
    case "polling":
      return `Waiting for backend (${u.status ?? "…"})…`;
    case "done":
      return "Done";
  }
}

function formatSec(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

/** Pick a mime type the browser can actually record — prefers webm/opus, falls back to mp4 (Safari). */
function pickSupportedMime(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

function extFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "bin";
}
