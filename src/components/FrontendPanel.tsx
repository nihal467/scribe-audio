import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCw,
  Save,
  XCircle,
  Zap,
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
import { useConnection } from "@/hooks/use-connection";
import { CareApiError, findScribeFrontendPlug } from "@/lib/care-api";
import type { PlugConfig } from "@/types";

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; configs: PlugConfig[]; selected: PlugConfig | undefined }
  | { kind: "error"; message: string };

type ProbeState =
  | { kind: "idle" }
  | { kind: "checking" }
  | {
      kind: "valid";
      contentType: string;
      sizeBytes: number;
      markers: string[];
    }
  | {
      kind: "warning";
      contentType: string;
      sizeBytes: number;
      message: string;
    }
  | { kind: "invalid"; message: string; hint?: string };

const PRESET_URLS: { label: string; url: string }[] = [
  {
    label: "Cloudflare Pages (main)",
    url: "https://care-scribe-fe.pages.dev/assets/remoteEntry.js",
  },
  {
    label: "10bedicu prod",
    url: "https://care-scribe.10bedicu.in/assets/remoteEntry.js",
  },
  {
    label: "local dev (vite preview 4173)",
    url: "http://localhost:4173/assets/remoteEntry.js",
  },
];

/**
 * Panel 2 — Point the CARE backend's `plug_config` at any deployed scribe FE build.
 * Fetches /api/v1/plug_config/, auto-selects the scribe FE entry, edits `meta.url`.
 */
export function FrontendPanel() {
  const { api, session } = useConnection();
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [draftUrl, setDraftUrl] = useState<string>("");
  const [draftSlug, setDraftSlug] = useState<string>("care_scribe_fe");
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState<ProbeState>({ kind: "idle" });
  const [probeNonce, setProbeNonce] = useState(0);

  const load = useCallback(async () => {
    if (!api) return;
    setState({ kind: "loading" });
    try {
      const configs = await api.listPlugConfigs();
      const selected = findScribeFrontendPlug(configs);
      setState({ kind: "loaded", configs, selected });
      if (selected) {
        setDraftUrl((selected.meta?.url as string) ?? "");
        setDraftSlug(selected.slug);
      }
    } catch (err) {
      setState({ kind: "error", message: describe(err) });
    }
  }, [api]);

  useEffect(() => {
    if (api) load();
    else setState({ kind: "idle" });
  }, [api, load]);

  // Debounced probe of the URL — validates the file actually loads and looks
  // like a Vite / Webpack Module Federation remoteEntry before the user hits Save.
  useEffect(() => {
    const url = draftUrl.trim();
    if (!url || !isSyntacticallyValidUrl(url)) {
      setProbe({ kind: "idle" });
      return;
    }
    setProbe({ kind: "checking" });
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      const result = await probeRemoteEntry(url, controller.signal);
      if (!controller.signal.aborted) setProbe(result);
    }, 500);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [draftUrl, probeNonce]);

  async function handleSave() {
    if (!api || !draftSlug) return;
    setSaving(true);
    try {
      const existing = state.kind === "loaded" ? state.configs.find((c) => c.slug === draftSlug) : undefined;
      if (existing) {
        await api.updatePlugConfig(draftSlug, {
          meta: { ...(existing.meta ?? {}), url: draftUrl.trim() },
        });
        toast.success("Plug config updated", {
          description: "Reload the CARE FE tab to pick up the new URL.",
        });
      } else {
        await api.createPlugConfig({
          slug: draftSlug,
          meta: { url: draftUrl.trim() },
        });
        toast.success("Plug config created", {
          description: "Reload the CARE FE tab to load the plugin.",
        });
      }
      await load();
    } catch (err) {
      toast.error("Save failed", { description: describe(err) });
    } finally {
      setSaving(false);
    }
  }

  const disabled = !session;
  const externalHostWarning =
    draftUrl && !isLikelyTrustedUrl(draftUrl)
      ? "This URL isn’t on a recognised care-ecosystem host (pages.dev / github.io / 10bedicu.in / localhost). Anyone loading the CARE FE will execute code from here — save only if you trust the origin."
      : null;

  return (
    <Card className={disabled ? "opacity-60" : undefined}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" /> API to connect frontend
            </CardTitle>
            <CardDescription>
              Point the CARE backend&apos;s <code>plug_config</code> at any deployed{" "}
              <code>care_scribe_fe</code> build.
            </CardDescription>
          </div>
          {state.kind === "loaded" && state.selected && (
            <Badge variant="info">slug: {state.selected.slug}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled && (
          <p className="text-sm text-slate-500">Connect to a backend first.</p>
        )}

        {state.kind === "loading" && <p className="text-sm text-slate-500">Loading plug configs…</p>}

        {state.kind === "error" && (
          <Alert variant="danger">
            <AlertTitle>Could not load plug configs</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}

        {state.kind === "loaded" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                value={draftSlug}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraftSlug(v);
                  const match = state.configs.find((c) => c.slug === v);
                  if (match) setDraftUrl((match.meta?.url as string) ?? "");
                }}
                list="slug-suggestions"
                spellCheck={false}
                disabled={disabled}
              />
              <datalist id="slug-suggestions">
                {state.configs.map((c) => (
                  <option key={c.slug} value={c.slug} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plug-url">remoteEntry.js URL</Label>
              <Input
                id="plug-url"
                type="url"
                placeholder="https://…/assets/remoteEntry.js"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                disabled={disabled}
                spellCheck={false}
              />
              <ProbeStatus
                probe={probe}
                onRetry={() => setProbeNonce((n) => n + 1)}
                url={draftUrl.trim()}
              />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {PRESET_URLS.map((p) => (
                  <button
                    key={p.url}
                    type="button"
                    className="text-xs text-sky-600 hover:text-sky-800 hover:underline"
                    onClick={() => setDraftUrl(p.url)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {externalHostWarning && (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Unrecognised host — you can still save</AlertTitle>
                <AlertDescription>{externalHostWarning}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={handleSave}
                variant="primary"
                disabled={saving || !draftUrl || !draftSlug}
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button variant="outline" onClick={load} disabled={saving}>
                <RefreshCw className="h-4 w-4" /> Reload
              </Button>
              {session && (
                <a
                  className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 hover:underline"
                  href={session.baseUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open CARE backend <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <p className="text-xs text-slate-500">
              CARE FE tabs cache <code>remoteEntry.js</code>. A full reload of the CARE FE is
              required to load the new build.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function isLikelyTrustedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    return (
      h === "localhost" ||
      h.endsWith(".localhost") ||
      // Cloudflare Pages / Workers — what CARE plugins use in prod
      h.endsWith(".pages.dev") ||
      h.endsWith(".workers.dev") ||
      // GitHub Pages
      h.endsWith(".github.io") ||
      // 10bedicu’s own domains
      h === "10bedicu.in" ||
      h.endsWith(".10bedicu.in")
    );
  } catch {
    return false;
  }
}

function describe(err: unknown): string {
  if (err instanceof CareApiError) {
    if (err.isCorsSuspected) return "CORS or network error. See README.";
    const body = err.body as { detail?: string } | null;
    return body?.detail ?? `${err.status} ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function isSyntacticallyValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Fetches the URL from the browser and checks that it looks like a Vite or
 * Webpack Module Federation remoteEntry. Returns a ProbeState the UI can render.
 * Fetches are subject to CORS — a CORS-blocked target returns 'invalid' with a
 * hint, since we can't distinguish that from a network failure client-side.
 */
async function probeRemoteEntry(
  url: string,
  signal: AbortSignal,
): Promise<ProbeState> {
  let res: Response;
  try {
    res = await fetch(url, { signal, cache: "no-cache", redirect: "follow" });
  } catch (err) {
    if (signal.aborted) return { kind: "idle" };
    return {
      kind: "invalid",
      message: "Could not fetch the URL from this browser.",
      hint:
        "Likely CORS is not enabled on the host, or the URL is unreachable. Try opening it in a new tab — if it downloads or shows JavaScript, CARE FE can probably still load it. Details: " +
        String(err),
    };
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

  if (!res.ok) {
    return {
      kind: "invalid",
      message: `HTTP ${res.status} ${res.statusText}`,
      hint: "The URL is reachable but the server returned an error.",
    };
  }

  const text = await res.text();
  const sizeBytes = new Blob([text]).size;

  const looksLikeJs =
    contentType.includes("javascript") ||
    contentType.includes("ecmascript") ||
    contentType === "" || // some CDNs omit it
    /^(?:import|export|const|let|var|\(|!function|"use strict")/.test(text.trimStart());

  if (!looksLikeJs) {
    return {
      kind: "invalid",
      message: `Response is ${contentType || "unknown type"}, not JavaScript.`,
      hint:
        "You're probably pointing at the wrong path — a module-federation entry is served at .../assets/remoteEntry.js.",
    };
  }

  // Detect known module-federation runtime markers.
  const markerChecks: { name: string; re: RegExp }[] = [
    { name: "vite-mf", re: /__federation_expose_/ },
    { name: "vite-mf", re: /Set\(\["Module","__esModule"/ },
    { name: "webpack-mf", re: /__webpack_require__/ },
    { name: "webpack-mf", re: /webpackChunk/ },
    { name: "shared-scope", re: /initShareScope|initSharing/ },
    { name: "container-get", re: /container[.\s]*get\(/i },
  ];
  const markers = Array.from(
    new Set(markerChecks.filter((m) => m.re.test(text)).map((m) => m.name)),
  );

  if (markers.length === 0) {
    return {
      kind: "warning",
      contentType,
      sizeBytes,
      message:
        "Loaded JavaScript but no Module Federation markers found. Save may still work if CARE FE can consume it, but double-check the path.",
    };
  }

  return { kind: "valid", contentType, sizeBytes, markers };
}

function ProbeStatus({
  probe,
  onRetry,
  url,
}: {
  probe: ProbeState;
  onRetry: () => void;
  url: string;
}) {
  if (probe.kind === "idle") return null;
  if (probe.kind === "checking") {
    return (
      <div className="flex items-center gap-1.5 pt-1 text-xs text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Checking…</span>
      </div>
    );
  }
  if (probe.kind === "valid") {
    return (
      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        <span className="font-medium text-emerald-700">Valid remoteEntry</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500">{humanBytes(probe.sizeBytes)}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500">{probe.markers.join(", ")}</span>
      </div>
    );
  }
  if (probe.kind === "warning") {
    return (
      <div className="flex items-start gap-1.5 pt-1 text-xs">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
        <div className="space-y-0.5">
          <div className="font-medium text-amber-700">{probe.message}</div>
          <div className="text-slate-500">
            {probe.contentType} · {humanBytes(probe.sizeBytes)}
          </div>
        </div>
      </div>
    );
  }
  // invalid
  return (
    <div className="flex items-start gap-1.5 pt-1 text-xs">
      <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-red-500" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="font-medium text-red-700">{probe.message}</div>
        {probe.hint && <div className="text-slate-500">{probe.hint}</div>}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800 hover:underline"
            onClick={onRetry}
          >
            <RotateCw className="h-3 w-3" /> Retry
          </button>
          {url && (
            <a
              className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800 hover:underline"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              Open in new tab <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
