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
    async ({ entry, manifest, audio, modelOverrides }) => {
      if (!api) {
        toast.error("Not connected", { description: "Log in to the CARE backend first." });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = Date.now();
      setActive({ caseId: entry.id, update: { stage: "creating" }, startedAt });

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
          result = {
            id: uuid(),
            timestamp: new Date().toISOString(),
            caseId: entry.id,
            caseName: entry.name,
            status: "failed",
            errorMessage: `Backend returned status ${s.status}`,
            scribeId: s.external_id,
            latencyMs: outcome.latencyMs,
            ai_response: s.ai_response ?? undefined,
            score: null,
          };
          toast.error("Run finished with an error", {
            description: `Status: ${s.status}`,
          });
        } else {
          const score = s.ai_response
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
          };
          toast.success("Run complete", {
            description: score ? `Score: ${score.percentage.toFixed(0)}%` : "No score",
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
