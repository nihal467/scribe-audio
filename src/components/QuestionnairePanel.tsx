import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileQuestion, Loader2, Mic, MicOff, Play, RefreshCw, Search, Square, Trash2 } from "lucide-react";
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
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { useConnection } from "@/hooks/use-connection";
import type { RunUpdate } from "@/lib/scribe-runner";
import {
  coerceExpectedValue,
  flattenFillableQuestions,
  questionnaireToManifest,
} from "@/lib/questionnaire";
import type {
  QuestionnaireDetail,
  QuestionnaireQuestion,
  QuestionnaireSummary,
  TestCaseIndexEntry,
  TestCaseManifest,
} from "@/types";
import type { ActiveRunState } from "@/components/AudioPanel";

const STAGE_PERCENT: Record<RunUpdate["stage"], number> = {
  creating: 10,
  uploading: 30,
  "marking-ready": 55,
  polling: 75,
  done: 100,
};

const RECENT_KEY = "scribe-audio.recentQuestionnaireSlug";

type Props = {
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

/**
 * Panel — CARE Questionnaire runner. Fetches questionnaires from the
 * connected CARE backend, lets the user fill "expected" values per question,
 * record audio, and run the scribe pipeline against a manifest synthesised
 * from the questionnaire's schema.
 */
export function QuestionnairePanel({ active, onRun, onCancel }: Props) {
  const { api, session } = useConnection();
  const {
    recorderState,
    recording,
    startRecording,
    stopRecording,
    clearRecording,
  } = useAudioRecorder();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "draft" | "retired">("");
  const [list, setList] = useState<QuestionnaireSummary[] | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [detail, setDetail] = useState<QuestionnaireDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expected, setExpected] = useState<Record<string, string>>({});
  const [runPreparing, setRunPreparing] = useState(false);

  // Debounce search input (300ms) — the /questionnaire/ list is paginated so
  // we don't want to refetch on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  // Fetch list whenever session/search changes.
  useEffect(() => {
    if (!api) {
      setList(null);
      return;
    }
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    api
      .listQuestionnaires({
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
        limit: 50,
      })
      .then((res: unknown) => {
        if (cancelled) return;
        // The endpoint is normally paginated ({count, results}); but some
        // deployments/routes may return a bare array — tolerate both.
        if (Array.isArray(res)) {
          setList(res as QuestionnaireSummary[]);
          setTotalCount((res as QuestionnaireSummary[]).length);
        } else {
          const paged = res as { count?: number; results?: QuestionnaireSummary[] };
          setList(paged.results ?? []);
          setTotalCount(typeof paged.count === "number" ? paged.count : (paged.results?.length ?? 0));
        }
        // Debug hint — helps diagnose why the list is empty in prod.
        // eslint-disable-next-line no-console
        console.debug("[questionnaire] list response", res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setList([]);
        setTotalCount(null);
        setListError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, debouncedSearch, statusFilter]);

  // Restore the last-used slug from localStorage.
  useEffect(() => {
    const saved = localStorage.getItem(RECENT_KEY);
    if (saved) setSelectedSlug(saved);
  }, []);

  // Fetch detail whenever the selected slug changes.
  useEffect(() => {
    if (!api || !selectedSlug) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    api
      .getQuestionnaire(selectedSlug)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setExpected({});
        localStorage.setItem(RECENT_KEY, selectedSlug);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedSlug]);

  const fillableQuestions = useMemo<QuestionnaireQuestion[]>(
    () => (detail ? flattenFillableQuestions(detail.questions ?? []) : []),
    [detail],
  );

  const runActive = !!active && active.caseId === `questionnaire:${selectedSlug}`;
  const runStage = runActive ? active!.update.stage : null;
  const runPercent = runStage ? STAGE_PERCENT[runStage] : 0;
  const runBusy = runPreparing || runActive;
  const canRun = !!api && !!detail && !!recording && !runBusy;

  const handleRunClick = useCallback(async () => {
    if (!api || !detail || !recording) return;
    setRunPreparing(true);
    try {
      const expectedCoerced: Record<string, unknown> = {};
      for (const q of fillableQuestions) {
        const raw = expected[q.id];
        if (raw == null) continue;
        const coerced = coerceExpectedValue(raw, q.type);
        if (coerced != null && coerced !== "") expectedCoerced[q.id] = coerced;
      }

      const manifest = questionnaireToManifest(detail, expectedCoerced, {
        audio: `live-recording.${extFromMime(recording.mimeType)}`,
        mimeType: recording.mimeType,
        durationSec: recording.durationSec,
      });

      const entry: TestCaseIndexEntry = {
        id: `questionnaire:${detail.slug}`,
        name: detail.title,
        audio: manifest.audio,
        mimeType: manifest.mimeType,
        durationSec: manifest.durationSec,
        tags: manifest.tags ?? [],
        notes: manifest.notes ?? null,
        fieldCount: fillableQuestions.length,
      };

      await onRun({
        entry,
        manifest,
        audio: recording.blob,
        modelOverrides: {},
        // The scoring layer keys off `hasExpected`, not on the source; the
        // "test-case" tag simply keeps the history row from showing the "live"
        // badge since the ground truth comes from the questionnaire form,
        // not the audio provenance.
        audioSource: "test-case",
      });
    } catch (err) {
      toast.error("Run could not start", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunPreparing(false);
    }
  }, [api, detail, expected, fillableQuestions, onRun, recording]);

  if (!session) {
    return (
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileQuestion className="h-4 w-4" /> CARE Questionnaire
          </CardTitle>
          <CardDescription>
            Log in to your CARE backend to browse questionnaires.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const shownCount = list?.length ?? 0;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileQuestion className="h-4 w-4" /> CARE Questionnaire
            </CardTitle>
            <CardDescription>
              Pull an existing questionnaire from CARE, set expected answers, record audio,
              and compare against the scribe AI response.
            </CardDescription>
          </div>
          {list != null && (
            <Badge variant={shownCount === 0 ? "warning" : "info"}>
              {totalCount != null && totalCount !== shownCount
                ? `${shownCount} shown / ${totalCount} total`
                : `${shownCount} loaded`}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {/* ─── Left column: list ────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-7"
                  placeholder="Search questionnaires…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  // Bump debouncedSearch to itself to force the effect to refetch.
                  setDebouncedSearch((s) => s);
                  setList(null);
                }}
                title="Refresh list"
                disabled={listLoading}
              >
                <RefreshCw className={`h-4 w-4 ${listLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Label className="text-xs">Status</Label>
              <select
                className="h-7 flex-1 rounded border border-slate-200 bg-white px-2 text-xs"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as "" | "active" | "draft" | "retired")
                }
              >
                <option value="">any</option>
                <option value="active">active</option>
                <option value="draft">draft</option>
                <option value="retired">retired</option>
              </select>
            </div>

            {listError && (
              <Alert variant="danger">
                <AlertTitle>Could not load questionnaires</AlertTitle>
                <AlertDescription className="whitespace-pre-wrap text-xs">
                  {listError}
                </AlertDescription>
              </Alert>
            )}

            <div className="max-h-80 divide-y divide-slate-100 overflow-auto rounded border border-slate-200">
              {listLoading && !list ? (
                <div className="flex items-center gap-2 p-3 text-xs text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              ) : list && list.length === 0 ? (
                <div className="p-3 text-xs text-slate-500">
                  No questionnaires match this filter.
                  {debouncedSearch ? " Try clearing the search." : ""}
                  {statusFilter ? " Try setting status to \u201cany\u201d." : ""}
                  {" "}
                  Your account also needs the{" "}
                  <code className="rounded bg-slate-100 px-1">can_read_questionnaire</code>{" "}
                  permission in at least one organization (superusers bypass).
                </div>
              ) : (
                (list ?? []).map((q) => {
                  const active = q.slug === selectedSlug;
                  return (
                    <button
                      key={q.slug}
                      type="button"
                      onClick={() => setSelectedSlug(q.slug)}
                      className={`block w-full px-3 py-2 text-left text-xs hover:bg-slate-50 ${
                        active ? "bg-slate-100" : ""
                      }`}
                    >
                      <div className="font-medium text-slate-800">{q.title}</div>
                      <div className="text-[10px] text-slate-500">
                        {q.slug}
                        {q.subject_type ? ` · ${q.subject_type}` : ""}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ─── Right column: detail + expected + record + run ─────── */}
          <div className="space-y-3">
            {detailLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading questionnaire…
              </div>
            )}
            {detailError && (
              <Alert variant="danger">
                <AlertTitle>Could not load questionnaire</AlertTitle>
                <AlertDescription className="whitespace-pre-wrap text-xs">
                  {detailError}
                </AlertDescription>
              </Alert>
            )}

            {detail && !detailLoading && (
              <>
                <div className="rounded border border-slate-200 p-3">
                  <div className="text-sm font-semibold">{detail.title}</div>
                  {detail.description && (
                    <div className="mt-1 text-xs text-slate-500">{detail.description}</div>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                    <Badge variant="info">{fillableQuestions.length} fillable</Badge>
                    {detail.subject_type && (
                      <span className="uppercase tracking-wide">{detail.subject_type}</span>
                    )}
                  </div>
                </div>

                {fillableQuestions.length === 0 ? (
                  <Alert>
                    <AlertTitle>No fillable questions</AlertTitle>
                    <AlertDescription className="text-xs">
                      This questionnaire only contains display / structured questions,
                      which the scribe pipeline can't score directly yet.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="max-h-64 space-y-2 overflow-auto rounded border border-slate-200 p-3">
                    {fillableQuestions.map((q) => (
                      <div key={q.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-2">
                        <div className="min-w-0">
                          <Label className="text-xs font-medium text-slate-700">
                            {q.text}
                          </Label>
                          <div className="text-[10px] uppercase tracking-wide text-slate-400">
                            {q.type}
                            {q.required ? " · required" : ""}
                          </div>
                        </div>
                        <ExpectedInput
                          question={q}
                          value={expected[q.id] ?? ""}
                          onChange={(v) =>
                            setExpected((prev) => ({ ...prev, [q.id]: v }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded border border-slate-200 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-700">
                    <Mic className="h-3 w-3" /> Record audio
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {recorderState.kind === "recording" ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={stopRecording}
                      >
                        <Square className="mr-1 h-3 w-3" />
                        Stop · {recorderState.elapsedSec.toFixed(1)}s
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startRecording().catch(() => {})}
                        disabled={recorderState.kind === "requesting"}
                      >
                        <Mic className="mr-1 h-3 w-3" />
                        {recording ? "Re-record" : "Start recording"}
                      </Button>
                    )}
                    {recording && (
                      <>
                        <audio controls src={recording.url} className="h-8 max-w-xs" />
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={clearRecording}
                          title="Discard recording"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                        <span className="text-[10px] text-slate-500">
                          {recording.mimeType} · {recording.durationSec.toFixed(1)}s
                        </span>
                      </>
                    )}
                    {recorderState.kind === "error" && (
                      <Alert variant="danger" className="w-full">
                        <AlertTitle className="flex items-center gap-1">
                          <MicOff className="h-3 w-3" /> Mic error
                        </AlertTitle>
                        <AlertDescription className="text-xs">
                          {recorderState.message}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={handleRunClick}
                    disabled={!canRun}
                    size="sm"
                  >
                    <Play className="mr-1 h-3 w-3" />
                    {runBusy ? "Running…" : "Run scribe against recording"}
                  </Button>
                  {runActive && (
                    <Button size="sm" variant="ghost" onClick={onCancel}>
                      Cancel
                    </Button>
                  )}
                  {!recording && (
                    <span className="text-[10px] text-slate-500">
                      Record audio to enable the run.
                    </span>
                  )}
                </div>

                {runActive && (
                  <div className="space-y-1">
                    <Progress value={runPercent} />
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      {runStage}
                    </div>
                  </div>
                )}
              </>
            )}

            {!detail && !detailLoading && !detailError && (
              <div className="rounded border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                Select a questionnaire from the list to begin.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ExpectedInput({
  question,
  value,
  onChange,
}: {
  question: QuestionnaireQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  if (question.type === "choice" && question.answer_option?.length) {
    return (
      <select
        className="h-8 rounded border border-slate-200 bg-white px-2 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— no expected —</option>
        {question.answer_option.map((o) => (
          <option key={o.value} value={o.value}>
            {o.display || o.value}
          </option>
        ))}
      </select>
    );
  }
  if (question.type === "boolean") {
    return (
      <select
        className="h-8 rounded border border-slate-200 bg-white px-2 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— no expected —</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  const inputType =
    question.type === "decimal" || question.type === "integer" || question.type === "quantity"
      ? "number"
      : question.type === "date"
        ? "date"
        : question.type === "time"
          ? "time"
          : question.type === "dateTime"
            ? "datetime-local"
            : "text";
  return (
    <Input
      className="h-8 text-xs"
      type={inputType}
      value={value}
      placeholder="expected answer"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function extFromMime(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base === "audio/webm") return "webm";
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/mpeg") return "mp3";
  if (base === "audio/wav") return "wav";
  if (base === "audio/ogg") return "ogg";
  return "bin";
}
