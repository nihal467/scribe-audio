import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dices, FileAudio, Play, Square, Tag } from "lucide-react";
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
  }) => Promise<void>;
  onCancel: () => void;
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
      const [manifest, audio] = await Promise.all([
        loadTestCaseManifest(selected.id),
        loadTestCaseAudio(selected.id, selected),
      ]);
      await onRun({
        entry: selected,
        manifest,
        audio,
        modelOverrides: {
          chatModel: chatModel.trim() || undefined,
          audioModel: audioModel.trim() || undefined,
        },
      });
    } catch (err) {
      toast.error("Run could not start", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunPreparing(false);
    }
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
              {runPreparing ? "Preparing…" : "Run"}
            </Button>
          ) : (
            <Button variant="destructive" onClick={onCancel}>
              <Square className="h-4 w-4" /> Cancel
            </Button>
          )}
          {!session && <span className="text-xs text-slate-500">Connect to a backend first.</span>}
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
