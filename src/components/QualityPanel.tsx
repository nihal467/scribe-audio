import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  Code2,
  Download,
  FileText,
  Gauge,
  History,
  ListChecks,
  Mic,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FormField, FormGroup, RunResult, ScoreOutcome } from "@/types";
import { formatDuration } from "@/lib/utils";

export type QualityPanelProps = {
  runs: RunResult[];
  onClear: () => void;
};

/**
 * Panel 4 — Quality of the AI response.
 * Three views on the latest run:
 *   - form: renders the case's form_data with received values overlaid (mirrors CARE FE's Voice Autofill UX).
 *   - diff: per-field expected vs. received table (benchmark score view).
 *   - raw:  raw JSON ai_response.
 */
export function QualityPanel({ runs, onClear }: QualityPanelProps) {
  const latest = runs[0];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"form" | "diff" | "raw">("form");
  const showing = useMemo(
    () => runs.find((r) => r.id === selectedId) ?? latest,
    [runs, selectedId, latest],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-fuchsia-600" /> Quality of AI response
            </CardTitle>
            <CardDescription>
              Per-field score vs. expected — same algorithm as{" "}
              <code>care_scribe_fe Benchmark</code>.
            </CardDescription>
          </div>
          {runs.length > 0 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => exportJson(runs)}>
                <Download className="h-3.5 w-3.5" /> JSON
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportCsv(runs)}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button variant="ghost" size="sm" onClick={onClear}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!showing ? (
          <EmptyState />
        ) : (
          <RunDetail run={showing} view={view} onViewChange={setView} />
        )}

        {runs.length > 1 && (
          <div className="border-t border-slate-100 pt-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
              <History className="h-4 w-4" /> History ({runs.length})
            </div>
            <div className="max-h-64 overflow-auto rounded-md border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Case</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow
                      key={r.id}
                      className={
                        r.id === showing.id
                          ? "cursor-pointer bg-sky-50 hover:bg-sky-100"
                          : "cursor-pointer"
                      }
                      onClick={() => setSelectedId(r.id)}
                    >
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">
                        {new Date(r.timestamp).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="text-sm">{r.caseName}</TableCell>
                      <TableCell>
                        {r.score ? (
                          <ScoreBadge score={r.score} />
                        ) : (
                          <Badge variant="danger">no score</Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">
                        {formatDuration(r.latencyMs)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={r.status === "success" ? "success" : "danger"}
                        >
                          {r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <Gauge className="mx-auto mb-2 h-8 w-8 text-slate-300" />
      <p className="text-sm text-slate-500">
        No runs yet. Pick a test case and hit <strong>Run</strong>.
      </p>
    </div>
  );
}

function RunDetail({
  run,
  view,
  onViewChange,
}: {
  run: RunResult;
  view: "form" | "diff" | "raw";
  onViewChange: (v: "form" | "diff" | "raw") => void;
}) {
  if (run.status === "failed") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-sm font-semibold text-red-800">Run failed</div>
          <div className="mt-1 whitespace-pre-wrap text-xs text-red-700">
            {run.errorMessage ?? "Unknown error"}
          </div>
          {run.scribeId && (
            <div className="mt-2 font-mono text-[11px] text-red-600/70">
              scribe {run.scribeId}
              {run.scribeStatus ? ` · ${run.scribeStatus}` : ""}
            </div>
          )}
        </div>
        {run.scribeMeta && Object.keys(run.scribeMeta).length > 0 && (
          <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-700">
              Backend meta (full)
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-mono text-[11px] leading-relaxed text-slate-700">
              {JSON.stringify(run.scribeMeta, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  }
  const hasForm = !!run.formData && run.formData.length > 0;
  const hasDiff = !!run.score && Object.keys(run.score.perField).length > 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ScoreGauge score={run.score} liveRecord={run.audioSource === "live-record"} />
        <div className="flex-1 space-y-1 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-700">Case:</span> {run.caseName}
            {run.audioSource === "live-record" && (
              <Badge variant="info">
                <Mic className="mr-0.5 h-3 w-3" /> live
              </Badge>
            )}
          </div>
          <div>
            <span className="font-medium text-slate-700">Latency:</span>{" "}
            {formatDuration(run.latencyMs)}
          </div>
          {run.scribeId && (
            <div className="truncate">
              <span className="font-medium text-slate-700">Scribe:</span>{" "}
              <code>{run.scribeId}</code>
            </div>
          )}
        </div>
      </div>

      {/* View toggle — form (default, matches CARE FE), diff (benchmark), raw (JSON) */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
        <ViewTab active={view === "form"} disabled={!hasForm} onClick={() => onViewChange("form")}>
          <FileText className="h-3.5 w-3.5" /> Filled form
        </ViewTab>
        <ViewTab active={view === "diff"} disabled={!hasDiff} onClick={() => onViewChange("diff")}>
          <ListChecks className="h-3.5 w-3.5" /> Diff
        </ViewTab>
        <ViewTab active={view === "raw"} disabled={!run.ai_response} onClick={() => onViewChange("raw")}>
          <Code2 className="h-3.5 w-3.5" /> Raw JSON
        </ViewTab>
      </div>

      {view === "form" && hasForm && (
        <FilledFormView
          formData={run.formData!}
          received={run.ai_response ?? {}}
          expected={run.expected}
          score={run.score}
        />
      )}
      {view === "form" && !hasForm && (
        <EmptyDetailPlaceholder text="No form data captured for this run." />
      )}

      {view === "diff" && hasDiff && run.score && (
        <div className="overflow-hidden rounded-md border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Got</TableHead>
                <TableHead className="w-24 text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(run.score.perField).map(([key, info]) => (
                <TableRow key={key}>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <KindDot kind={info.kind} />
                      <code className="text-xs">{key}</code>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[16ch] truncate font-mono text-xs">
                    {short(info.expected)}
                  </TableCell>
                  <TableCell className="max-w-[16ch] truncate font-mono text-xs">
                    {short(info.received)}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <span className={info.score >= 2 ? "text-emerald-700" : info.score >= 1 ? "text-amber-700" : "text-red-700"}>
                      {info.score.toFixed(1)}
                    </span>
                    <span className="text-slate-400">/{info.maxScore}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {view === "diff" && !hasDiff && (
        <EmptyDetailPlaceholder
          text={
            run.audioSource === "live-record"
              ? "Live recordings have no ground truth — scoring is skipped."
              : "No per-field diff available (no expected values or empty response)."
          }
        />
      )}

      {view === "raw" && run.ai_response && (
        <details className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm" open>
          <summary className="cursor-pointer select-none font-medium">
            <ChevronRight className="mr-1 inline h-3 w-3" /> Raw AI response
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-white p-2 text-xs">
            {JSON.stringify(run.ai_response, null, 2)}
          </pre>
        </details>
      )}
      {view === "raw" && !run.ai_response && (
        <EmptyDetailPlaceholder text="No AI response body." />
      )}
    </div>
  );
}

function ViewTab({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition",
        active
          ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
          : "text-slate-500 hover:text-slate-800",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function EmptyDetailPlaceholder({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">
      {text}
    </div>
  );
}

// ─── Filled-form view (mirrors CARE FE's Voice Autofill filled form) ──────

function FilledFormView({
  formData,
  received,
  expected,
  score,
}: {
  formData: FormGroup[];
  received: Record<string, unknown>;
  expected?: Record<string, unknown>;
  score: ScoreOutcome | null;
}) {
  return (
    <div className="space-y-4">
      {formData.map((group, i) => (
        <FormGroupView
          key={`${group.title}-${i}`}
          group={group}
          received={received}
          expected={expected}
          score={score}
        />
      ))}
    </div>
  );
}

function FormGroupView({
  group,
  received,
  expected,
  score,
  depth = 0,
}: {
  group: FormGroup;
  received: Record<string, unknown>;
  expected?: Record<string, unknown>;
  score: ScoreOutcome | null;
  depth?: number;
}) {
  return (
    <div
      className={
        depth === 0
          ? "rounded-lg border border-slate-200 bg-white p-3"
          : "mt-2 border-l-2 border-slate-100 pl-3"
      }
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className={depth === 0 ? "text-sm font-semibold text-slate-800" : "text-xs font-semibold uppercase tracking-wide text-slate-500"}>
          {group.title}
        </div>
        {group.description && (
          <div className="text-xs text-slate-400">{group.description}</div>
        )}
      </div>
      <div className="space-y-2">
        {group.fields.map((child, i) =>
          isGroup(child) ? (
            <FormGroupView
              key={`${(child as FormGroup).title}-${i}`}
              group={child as FormGroup}
              received={received}
              expected={expected}
              score={score}
              depth={depth + 1}
            />
          ) : (
            <FormFieldView
              key={(child as FormField).id}
              field={child as FormField}
              received={received}
              expected={expected}
              score={score}
            />
          ),
        )}
      </div>
    </div>
  );
}

function FormFieldView({
  field,
  received,
  expected,
  score,
}: {
  field: FormField;
  received: Record<string, unknown>;
  expected?: Record<string, unknown>;
  score: ScoreOutcome | null;
}) {
  const raw = received[field.id];
  const value = unwrapValueNote(raw);
  const hasValue = value !== undefined && value !== null && value !== "";
  const expectedValue = expected ? unwrapValueNote(expected[field.id]) : undefined;
  const scoreInfo = score?.perField[field.id];

  return (
    <div className="grid grid-cols-1 gap-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-start md:gap-3">
      <div className="flex items-center gap-1.5 pt-1.5 text-xs font-medium text-slate-600">
        {scoreInfo && <KindDot kind={scoreInfo.kind} />}
        <span>{field.friendlyName}</span>
        <span className="text-slate-300">·</span>
        <span className="font-mono text-[10px] uppercase text-slate-400">{field.type}</span>
      </div>
      <div>
        <div
          className={[
            "min-h-[2.25rem] rounded-md border px-3 py-1.5 text-sm",
            hasValue
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-slate-200 bg-slate-50 text-slate-400 italic",
          ].join(" ")}
        >
          {hasValue ? formatFieldValue(value, field) : "— empty —"}
          {isValueNoteObject(raw) && (raw as { note?: string }).note && (
            <div className="mt-1 text-[10px] font-normal text-slate-500">
              note: {(raw as { note?: string }).note}
            </div>
          )}
        </div>
        {expectedValue !== undefined && expectedValue !== null && expectedValue !== "" && (
          <div className="mt-1 text-[11px] text-slate-500">
            <span className="text-slate-400">expected:</span>{" "}
            <span className="font-mono">{formatFieldValue(expectedValue, field)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function isGroup(x: FormField | FormGroup): x is FormGroup {
  return typeof (x as FormGroup).fields !== "undefined" && Array.isArray((x as FormGroup).fields);
}

function isValueNoteObject(x: unknown): boolean {
  return (
    typeof x === "object" &&
    x !== null &&
    !Array.isArray(x) &&
    Object.prototype.hasOwnProperty.call(x, "value")
  );
}

function unwrapValueNote(x: unknown): unknown {
  if (isValueNoteObject(x)) return (x as { value: unknown }).value;
  if (Array.isArray(x)) return x.map(unwrapValueNote);
  return x;
}

function formatFieldValue(v: unknown, field: FormField): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((item) => formatFieldValue(item, field)).join(", ");
  // Resolve option ids to human labels for select-like fields
  if (field.options && (typeof v === "string" || typeof v === "number")) {
    const opt = field.options.find((o) => o.id === v || String(o.id) === String(v));
    if (opt) return opt.text;
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function ScoreGauge({ score, liveRecord }: { score: ScoreOutcome | null; liveRecord?: boolean }) {
  if (!score) {
    return (
      <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full border-4 border-slate-200 text-center text-slate-400">
        {liveRecord ? (
          <>
            <Mic className="h-4 w-4" />
            <span className="mt-0.5 text-[9px] uppercase tracking-wide">no truth</span>
          </>
        ) : (
          <span className="text-sm">—</span>
        )}
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, score.percentage));
  const color = pct >= 80 ? "text-emerald-600" : pct >= 50 ? "text-amber-500" : "text-red-500";
  const ring = pct >= 80 ? "border-emerald-500" : pct >= 50 ? "border-amber-400" : "border-red-400";
  return (
    <div
      className={`flex h-24 w-24 flex-col items-center justify-center rounded-full border-4 ${ring} bg-white`}
    >
      <span className={`text-xl font-bold ${color}`}>{pct.toFixed(0)}%</span>
      <span className="text-[10px] uppercase tracking-wide text-slate-400">
        {score.score.toFixed(1)}/{score.maxScore}
      </span>
    </div>
  );
}

function ScoreBadge({ score }: { score: ScoreOutcome }) {
  const pct = score.percentage;
  const v = pct >= 80 ? "success" : pct >= 50 ? "warning" : "danger";
  return <Badge variant={v}>{pct.toFixed(0)}%</Badge>;
}

function KindDot({ kind }: { kind: ScoreOutcome["perField"][string]["kind"] }) {
  const cls = {
    match: "bg-emerald-500",
    partial: "bg-amber-400",
    miss: "bg-red-500",
    hallucination: "bg-fuchsia-500",
    "correct-absence": "bg-emerald-400",
    error: "bg-slate-400",
  }[kind];
  return (
    <span
      title={kind}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`}
    />
  );
}

function short(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ─── Export helpers ─────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportJson(runs: RunResult[]) {
  try {
    const blob = new Blob([JSON.stringify(runs, null, 2)], { type: "application/json" });
    downloadBlob(blob, `scribe-runs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  } catch (err) {
    toast.error("Export failed", { description: err instanceof Error ? err.message : String(err) });
  }
}

function exportCsv(runs: RunResult[]) {
  try {
    const headers = ["timestamp", "case", "status", "score_pct", "score", "max", "latency_ms", "scribe_id"];
    const rows = runs.map((r) => [
      r.timestamp,
      r.caseName,
      r.status,
      r.score ? r.score.percentage.toFixed(2) : "",
      r.score ? r.score.score.toFixed(2) : "",
      r.score ? r.score.maxScore.toFixed(0) : "",
      r.latencyMs.toFixed(0),
      r.scribeId ?? "",
    ]);
    const lines = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([lines], { type: "text/csv" });
    downloadBlob(blob, `scribe-runs-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
  } catch (err) {
    toast.error("Export failed", { description: err instanceof Error ? err.message : String(err) });
  }
}
