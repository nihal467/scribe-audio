import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  Download,
  Gauge,
  History,
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
import type { RunResult, ScoreOutcome } from "@/types";
import { formatDuration } from "@/lib/utils";

export type QualityPanelProps = {
  runs: RunResult[];
  onClear: () => void;
};

/**
 * Panel 4 — Quality of the AI response.
 * Shows the latest run's score, per-field diff, transcript, and history table.
 */
export function QualityPanel({ runs, onClear }: QualityPanelProps) {
  const latest = runs[0];
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
          <RunDetail run={showing} />
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

function RunDetail({ run }: { run: RunResult }) {
  if (run.status === "failed") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="text-sm font-semibold text-red-800">Run failed</div>
        <div className="mt-1 text-xs text-red-700">{run.errorMessage ?? "Unknown error"}</div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ScoreGauge score={run.score} />
        <div className="flex-1 space-y-1 text-xs text-slate-500">
          <div>
            <span className="font-medium text-slate-700">Case:</span> {run.caseName}
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

      {run.score && Object.keys(run.score.perField).length > 0 && (
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

      {run.ai_response && (
        <details className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer select-none font-medium">
            <ChevronRight className="mr-1 inline h-3 w-3" /> Raw AI response
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-xs">
            {JSON.stringify(run.ai_response, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function ScoreGauge({ score }: { score: ScoreOutcome | null }) {
  if (!score) {
    return (
      <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-slate-200 text-sm text-slate-400">
        —
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
