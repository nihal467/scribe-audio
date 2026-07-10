import type {
  PlugConfig,
  QuestionnaireDetail,
  QuestionnaireListResponse,
  Scribe,
  ScribeFile,
  TokenPair,
} from "@/types";
import { trimTrailingSlash } from "@/lib/utils";

/**
 * care_scribe's ScribeFile.FileType is a Django `IntegerChoices` enum;
 * the DRF ChoiceField wants the *integer*, not the string name.
 * (The GET-list viewset filters on the string name via `__members__`, hence
 *  the asymmetry with the create serializer.)
 */
const SCRIBE_FILE_TYPE = {
  OTHER: 0,
  SCRIBE_AUDIO: 1,
  SCRIBE_DOCUMENT: 2,
} as const;

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
      // Build a human-friendly message that surfaces the DRF error body
      // so callers don't lose the actual reason (e.g. "You do not have
      // permission to create a benchmark scribe request.").
      const detail = extractDetail(body);
      const message = detail
        ? `${res.status} ${res.statusText || ""} — ${detail}`
        : `${res.status} ${res.statusText || ""}`.trim();
      throw new CareApiError(message, { status: res.status, body });
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

  /**
   * Exchange a refresh token for a new access token.
   * Throws CareApiError if the refresh token itself is expired/invalid.
   */
  async refreshToken(refresh: string): Promise<{ access: string }> {
    return this.request<{ access: string }>("/api/v1/auth/token/refresh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
  }

  /**
   * Quick liveness check — hits a protected endpoint and returns true iff the
   * current access token is accepted. Useful on page load to detect stale JWTs.
   */
  async validateToken(): Promise<boolean> {
    if (!this.accessToken) return false;
    try {
      await this.request<unknown>("/api/v1/auth/token/verify/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: this.accessToken }),
      });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Plug config ─────────────────────────────────────────────────────────

  async listPlugConfigs(): Promise<PlugConfig[]> {
    // The CARE plug_config endpoint returns `{configs: [...]}` in the wild
    // (confirmed against teleicuapi.ohc.network), but older builds return a bare
    // array or a DRF-paginated `{results: [...]}`. Handle all three.
    const res = await this.request<
      | PlugConfig[]
      | { configs: PlugConfig[] }
      | { results: PlugConfig[] }
    >("/api/v1/plug_config/");
    if (Array.isArray(res)) return res;
    if ("configs" in res && Array.isArray(res.configs)) return res.configs;
    if ("results" in res && Array.isArray(res.results)) return res.results;
    return [];
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
  // NB: plugin routes mount at /api/{plug_name}/... (see care/config/urls.py:
  //   for plug in settings.PLUGIN_APPS: urlpatterns += [path(f"api/{plug}/", ...)])

  async createScribe(payload: Partial<Scribe> & { benchmark?: boolean }): Promise<Scribe> {
    try {
      return await this.request<Scribe>("/api/care_scribe/scribe/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (err instanceof CareApiError) {
        if (err.status === 404) {
          throw new CareApiError(
            "The CARE backend does not have care_scribe installed. Ask the ops team to add care_scribe to INSTALLED_APPS + run migrations.",
            { status: 404, body: err.body },
          );
        }
        if (err.status === 401 || err.status === 403) {
          // The two most common causes on care_scribe/scribe/:
          //   - JWT expired / not sent   → log in again
          //   - Non-superuser + benchmark=true or model overrides
          //     (see care_scribe/serializers/scribe.py — those checks throw
          //     but Django's auth layer may surface as 403 for MFA-guarded users too)
          const hint =
            "This usually means your JWT expired (log in again) or your account isn't a superuser " +
            "— care_scribe requires superuser for `benchmark: true` and for custom chat/audio model overrides.";
          throw new CareApiError(`${err.message}\n\n${hint}`, {
            status: err.status,
            body: err.body,
          });
        }
      }
      throw err;
    }
  }

  async getScribe(externalId: string): Promise<Scribe> {
    return this.request<Scribe>(`/api/care_scribe/scribe/${externalId}/`);
  }

  async updateScribe(externalId: string, patch: Partial<Scribe>): Promise<Scribe> {
    return this.request<Scribe>(`/api/care_scribe/scribe/${externalId}/`, {
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
    // care_scribe's ScribeFile.FileType is IntegerChoices:
    //   OTHER=0, SCRIBE_AUDIO=1, SCRIBE_DOCUMENT=2
    // The DRF ChoiceField wants the integer, not the string name.
    // And `length` is DecimalField(max_digits=20, decimal_places=2) — must be
    // rounded to at most 2 decimals or the serializer 400s.
    const wire: Record<string, unknown> = {
      ...payload,
      file_type: SCRIBE_FILE_TYPE[payload.file_type],
    };
    if (typeof payload.length === "number") {
      wire.length = Math.round(payload.length * 100) / 100;
    }
    return this.request<ScribeFile>("/api/care_scribe/scribe_file/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wire),
    });
  }

  /**
   * Mark the upload finished. The viewset's `get_queryset()` requires
   * `?file_type=<STRING_NAME>&associating_id=<scribe.external_id>` on EVERY
   * request (even retrieve/update by external_id), and — asymmetric with the
   * create serializer — the filter uses the enum string name, not the int.
   * Omitting these params 400s with `{"file_type":"file_type missing in
   * request params"}`.
   */
  async completeScribeFile(
    id: string,
    opts: { associatingId: string; fileType?: "SCRIBE_AUDIO" | "SCRIBE_DOCUMENT" },
  ): Promise<ScribeFile> {
    const qs = new URLSearchParams({
      file_type: opts.fileType ?? "SCRIBE_AUDIO",
      associating_id: opts.associatingId,
    });
    return this.request<ScribeFile>(
      `/api/care_scribe/scribe_file/${id}/?${qs.toString()}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_completed: true }),
      },
    );
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

  // ─── Questionnaire ───────────────────────────────────────────────────────
  // ohcnetwork/care exposes questionnaires at /api/v1/questionnaire/ with a
  // slug lookup (see care/emr/api/viewsets/questionnaire.py). List is paginated
  // — we use the `results[]` shape. Filters that work: title (icontains),
  // subject_type, status.

  async listQuestionnaires(
    opts: { search?: string; limit?: number; status?: string; subjectType?: string } = {},
  ): Promise<QuestionnaireListResponse> {
    const qs = new URLSearchParams();
    if (opts.search) qs.set("title", opts.search);
    if (opts.limit != null) qs.set("limit", String(opts.limit));
    if (opts.status) qs.set("status", opts.status);
    if (opts.subjectType) qs.set("subject_type", opts.subjectType);
    const path = `/api/v1/questionnaire/${qs.toString() ? `?${qs.toString()}` : ""}`;
    return this.request<QuestionnaireListResponse>(path);
  }

  async getQuestionnaire(slug: string): Promise<QuestionnaireDetail> {
    return this.request<QuestionnaireDetail>(
      `/api/v1/questionnaire/${encodeURIComponent(slug)}/`,
    );
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

/**
 * Pull a readable message out of a DRF error body.
 * Handles the common shapes: {detail}, {field:[msg]}, {non_field_errors:[…]}, string.
 */
function extractDetail(body: unknown): string | null {
  if (!body) return null;
  if (typeof body === "string") return body.slice(0, 300);
  if (typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.detail === "string") return b.detail;
  if (Array.isArray(b.non_field_errors) && b.non_field_errors.length > 0) {
    return String(b.non_field_errors[0]);
  }
  // First field-level error, if any: {benchmark: ["You do not have permission…"]}
  for (const [k, v] of Object.entries(b)) {
    if (Array.isArray(v) && v.length > 0) return `${k}: ${v[0]}`;
    if (typeof v === "string") return `${k}: ${v}`;
  }
  return null;
}
