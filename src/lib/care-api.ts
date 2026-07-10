import type {
  PlugConfig,
  Scribe,
  ScribeFile,
  TokenPair,
} from "@/types";
import { trimTrailingSlash } from "@/lib/utils";

/**
 * Error thrown by CareAPI on non-2xx responses.
 * `body` holds the JSON body (if any) so callers can render actionable messages.
 */
export class CareApiError extends Error {
  status: number;
  body: unknown;
  isCorsSuspected: boolean;

  constructor(message: string, opts: { status: number; body: unknown; isCorsSuspected?: boolean }) {
    super(message);
    this.name = "CareApiError";
    this.status = opts.status;
    this.body = opts.body;
    this.isCorsSuspected = opts.isCorsSuspected ?? false;
  }
}

/**
 * Thin wrapper around the CARE backend REST API.
 * Instantiate once you have a baseUrl (+ optional access token) and call methods.
 * All request paths are appended to `<baseUrl>/api/v1/…`.
 */
export class CareAPI {
  readonly baseUrl: string;
  private accessToken?: string;

  constructor(baseUrl: string, accessToken?: string) {
    this.baseUrl = trimTrailingSlash(baseUrl);
    this.accessToken = accessToken;
  }

  setToken(token: string | undefined) {
    this.accessToken = token;
  }

  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = { Accept: "application/json", ...extra };
    if (this.accessToken) h.Authorization = `Bearer ${this.accessToken}`;
    return h;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { expectJson?: boolean } = {},
  ): Promise<T> {
    const { expectJson = true, ...rest } = init;
    const url = `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;

    let res: Response;
    try {
      res = await fetch(url, {
        ...rest,
        headers: { ...this.headers(), ...(rest.headers as Record<string, string> | undefined) },
      });
    } catch (err) {
      // A fetch() rejection with `TypeError: Failed to fetch` is almost always
      // CORS or a network issue — surface that clearly to the user.
      throw new CareApiError(
        "Could not reach the CARE backend. Likely CORS (see README) or the URL is wrong.",
        { status: 0, body: { rawError: String(err) }, isCorsSuspected: true },
      );
    }

    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        try {
          body = await res.text();
        } catch {
          /* ignore */
        }
      }
      throw new CareApiError(`${res.status} ${res.statusText}`, { status: res.status, body });
    }

    if (!expectJson || res.status === 204) {
      return undefined as unknown as T;
    }
    return (await res.json()) as T;
  }

  // ─── Auth ────────────────────────────────────────────────────────────────

  async login(username: string, password: string): Promise<TokenPair> {
    return this.request<TokenPair>("/api/v1/auth/login/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  }

  // ─── Plug config ─────────────────────────────────────────────────────────

  async listPlugConfigs(): Promise<PlugConfig[]> {
    const res = await this.request<PlugConfig[] | { results: PlugConfig[] }>("/api/v1/plug_config/");
    return Array.isArray(res) ? res : res.results ?? [];
  }

  async getPlugConfig(slug: string): Promise<PlugConfig> {
    return this.request<PlugConfig>(`/api/v1/plug_config/${slug}/`);
  }

  async updatePlugConfig(slug: string, patch: Partial<PlugConfig>): Promise<PlugConfig> {
    return this.request<PlugConfig>(`/api/v1/plug_config/${slug}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async createPlugConfig(config: PlugConfig): Promise<PlugConfig> {
    return this.request<PlugConfig>("/api/v1/plug_config/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
  }

  // ─── Scribe ──────────────────────────────────────────────────────────────

  async createScribe(payload: Partial<Scribe> & { benchmark?: boolean }): Promise<Scribe> {
    return this.request<Scribe>("/api/v1/scribe/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async getScribe(externalId: string): Promise<Scribe> {
    return this.request<Scribe>(`/api/v1/scribe/${externalId}/`);
  }

  async updateScribe(externalId: string, patch: Partial<Scribe>): Promise<Scribe> {
    return this.request<Scribe>(`/api/v1/scribe/${externalId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  // ─── Scribe file ─────────────────────────────────────────────────────────

  async createScribeFile(payload: {
    file_type: "SCRIBE_AUDIO" | "SCRIBE_DOCUMENT";
    associating_id: string;
    original_name: string;
    mime_type: string;
    name: string;
    length?: number; // seconds; serializer multiplies by 1000
  }): Promise<ScribeFile> {
    return this.request<ScribeFile>("/api/v1/scribe_file/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async completeScribeFile(id: string): Promise<ScribeFile> {
    return this.request<ScribeFile>(`/api/v1/scribe_file/${id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_completed: true }),
    });
  }

  /** Upload the raw audio bytes to the presigned URL returned by createScribeFile. */
  async uploadToSignedUrl(signedUrl: string, blob: Blob, mimeType: string): Promise<void> {
    const res = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: blob,
    });
    if (!res.ok) {
      throw new CareApiError(`Signed-URL upload failed: ${res.status} ${res.statusText}`, {
        status: res.status,
        body: await safeText(res),
      });
    }
  }
}

async function safeText(res: Response): Promise<string | null> {
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Best-effort match for the scribe FE slug in a list of plug configs.
 * Prefers explicit `care_scribe_fe`; falls back to any slug containing "scribe".
 */
export function findScribeFrontendPlug(configs: PlugConfig[]): PlugConfig | undefined {
  return (
    configs.find((c) => c.slug === "care_scribe_fe") ??
    configs.find((c) => c.slug.toLowerCase().includes("scribe"))
  );
}
