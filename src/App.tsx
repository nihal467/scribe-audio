import { useCallback, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { BackendPanel } from "@/components/BackendPanel";
import { FrontendPanel } from "@/components/FrontendPanel";
import { AudioPanel, type ActiveRunState } from "@/components/AudioPanel";
import { QualityPanel } from "@/components/QualityPanel";
import { ConnectionProvider, useConnection } from "@/hooks/use-connection";
import { useStoredState } from "@/hooks/use-stored-state";
import { runTestCase } from "@/lib/scribe-runner";
import { scoreAgainstExpected } from "@/lib/scoring";
import { uuid } from "@/lib/utils";
import type { RunResult } from "@/types";

const HISTORY_KEY = "scribe-audio.runs";
const HISTORY_LIMIT = 50;

/**
 * Pull the most recent `error` string out of a Scribe's `meta.processings`
 * array — that's where care_scribe stores the real reason a run failed
 * (Whisper 4xx, quota exceeded, malformed AI response, etc.). Returns null
 * if there's no error entry or `meta` isn't shaped as expected.
 */
function extractLastProcessingError(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const processings = (meta as Record<string, unknown>).processings;
  if (!Array.isArray(processings)) return null;
  for (let i = processings.length - 1; i >= 0; i--) {
    const p = processings[i];
    if (p && typeof p === "object") {
      const err = (p as Record<string, unknown>).error;
      if (typeof err === "string" && err.trim()) return err.trim();
    }
  }
  return null;
}

export default function App() {
  return (
    <ConnectionProvider>
      <Shell />
      <Toaster richColors position="top-right" closeButton />
    </ConnectionProvider>
  );
}

function Shell() {
  const { api } = useConnection();
  const [runs, setRuns] = useStoredState<RunResult[]>(HISTORY_KEY, []);
  const [active, setActive] = useState<ActiveRunState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleRun = useCallback<
    React.ComponentProps<typeof AudioPanel>["onRun"]
  >(
    async ({ entry, manifest, audio, modelOverrides, audioSource }) => {
      if (!api) {
        toast.error("Not connected", { description: "Log in to the CARE backend first." });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = Date.now();
      setActive({ caseId: entry.id, update: { stage: "creating" }, startedAt });
      const source: RunResult["audioSource"] = audioSource ?? "test-case";

      let result: RunResult;
      try {
        const outcome = await runTestCase({
          api,
          manifest,
          audio,
          options: {
            chatModel: modelOverrides.chatModel,
            audioModel: modelOverrides.audioModel,
            onUpdate: (u) => setActive({ caseId: entry.id, update: u, startedAt }),
            signal: controller.signal,
          },
        });

        const s = outcome.scribe;
        if (s.status !== "COMPLETED") {
          // care_scribe embeds the real reason in meta.processings[*].error
          // (see care_scribe/tasks/scribe.py — every failure branch appends
          // `processing["error"] = str(e)` before setting status=FAILED).
          const backendErr = extractLastProcessingError(s.meta);
          const errMsg = backendErr
            ? `Backend returned ${s.status} — ${backendErr}`
            : `Backend returned status ${s.status}`;
          result = {
            id: uuid(),
            timestamp: new Date().toISOString(),
            caseId: entry.id,
            caseName: entry.name,
            status: "failed",
            errorMessage: errMsg,
            scribeId: s.external_id,
            latencyMs: outcome.latencyMs,
            ai_response: s.ai_response ?? undefined,
            score: null,
            formData: manifest.form_data,
            audioSource: source,
            scribeMeta: s.meta ?? null,
            scribeStatus: s.status,
          };
          toast.error("Run finished with an error", {
            description: backendErr ?? `Status: ${s.status}`,
          });
        } else {
          // Score against `expected` whenever the manifest has any — the
          // audio source (test-case file vs. live recording) doesn't matter;
          // scoring compares AI output to the ground-truth values.
          const hasExpected =
            manifest.expected && Object.keys(manifest.expected).length > 0;
          const score =
            s.ai_response && hasExpected
              ? scoreAgainstExpected(s.ai_response, manifest.expected)
              : null;
          result = {
            id: uuid(),
            timestamp: new Date().toISOString(),
            caseId: entry.id,
            caseName: entry.name,
            status: "success",
            scribeId: s.external_id,
            latencyMs: outcome.latencyMs,
            ai_response: s.ai_response ?? undefined,
            score,
            formData: manifest.form_data,
            audioSource: source,
            expected: hasExpected ? manifest.expected : undefined,
          };
          toast.success("Run complete", {
            description: score
              ? `Score: ${score.percentage.toFixed(0)}%`
              : hasExpected
                ? "No score (empty AI response)"
                : "No ground truth — scoring skipped",
          });
        }
      } catch (err) {
        if (controller.signal.aborted) {
          toast.info("Run cancelled");
          setActive(null);
          abortRef.current = null;
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        result = {
          id: uuid(),
          timestamp: new Date().toISOString(),
          caseId: entry.id,
          caseName: entry.name,
          status: "failed",
          errorMessage: msg,
          latencyMs: Date.now() - startedAt,
          score: null,
          formData: manifest.form_data,
          audioSource: source,
        };
        toast.error("Run failed", { description: msg });
      }

      setRuns((prev) => [result, ...prev].slice(0, HISTORY_LIMIT));
      setActive(null);
      abortRef.current = null;
    },
    [api, setRuns],
  );

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleClearHistory = useCallback(() => {
    if (confirm("Clear all run history?")) setRuns([]);
  }, [setRuns]);

  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-slate-900" />
            <div>
              <h1 className="text-sm font-semibold leading-tight">CARE Scribe Bench</h1>
              <p className="text-xs text-slate-500">
                End-to-end audio testing for the CARE Scribe stack
              </p>
            </div>
          </div>
          <a
            href="https://github.com/10bedicu/care_scribe"
            className="text-xs text-slate-500 hover:text-slate-800 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            docs
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="grid gap-4 md:grid-cols-2">
          <BackendPanel />
          <FrontendPanel />
          <AudioPanel active={active} onRun={handleRun} onCancel={handleCancel} />
          <QualityPanel runs={runs} onClear={handleClearHistory} />
        </div>
      </main>

      <footer className="mx-auto max-w-7xl px-4 py-6 text-xs text-slate-400">
        Runs and configuration are stored locally in your browser. Nothing is sent anywhere except
        the CARE backend you configure.
      </footer>
    </div>
  );
}
