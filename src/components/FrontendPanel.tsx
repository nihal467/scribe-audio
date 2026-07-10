import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, RefreshCw, Save, Zap } from "lucide-react";
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

const PRESET_URLS: { label: string; url: string }[] = [
  {
    label: "main branch (GH Pages)",
    url: "https://10bedicu.github.io/care_scribe_fe/assets/remoteEntry.js",
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
      ? "This URL is not on a recognised host (10bedicu.github.io / localhost / your CARE domain). Anyone loading the CARE FE will execute code from here."
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
                <AlertTitle>Untrusted host</AlertTitle>
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
    return (
      u.hostname === "localhost" ||
      u.hostname.endsWith(".localhost") ||
      u.hostname.endsWith(".github.io") ||
      u.hostname === "10bedicu.github.io"
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
