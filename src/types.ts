/**
 * Shared types used across the dashboard.
 * Mirrors the shapes returned by the CARE backend + care_scribe plugin.
 */

export type TokenPair = {
  access: string;
  refresh: string;
};

/** From `GET /api/v1/plug_config/` */
export type PlugConfig = {
  slug: string;
  version?: string | null;
  meta: {
    url?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

/** Subset of the Scribe model exposed via `/api/care_scribe/scribe/`. */
export type ScribeStatus =
  | "CREATED"
  | "READY"
  | "GENERATING_TRANSCRIPT"
  | "GENERATING_AI_RESPONSE"
  | "COMPLETED"
  | "REFUSED"
  | "FAILED";

export type Scribe = {
  external_id: string;
  status: ScribeStatus;
  transcript?: string | null;
  ai_response?: Record<string, unknown> | null;
  form_data?: FormGroup[];
  meta?: Record<string, unknown> | null;
  chat_model?: string | null;
  audio_model?: string | null;
  chat_model_temperature?: number | null;
  transcript_only?: boolean;
  chat_input_tokens?: number | null;
  chat_output_tokens?: number | null;
};

/** File resource returned by `POST /api/care_scribe/scribe_file/`. */
export type ScribeFile = {
  id: string;
  file_type: "SCRIBE_AUDIO" | "SCRIBE_DOCUMENT";
  signed_url: string;
  internal_name: string;
  mime_type: string;
  name?: string;
};

export type FormField = {
  id: string;
  friendlyName: string;
  type: string;
  current: unknown;
  structuredType?: string | null;
  repeats?: boolean;
  options?: Array<{ id: string | number; text: string }>;
  schema?: Record<string, unknown>;
};

export type FormGroup = {
  title: string;
  description?: string;
  fields: Array<FormField | FormGroup>;
};

/** manifest.json shape for a test case. */
export type TestCaseManifest = {
  name: string;
  audio: string;
  mimeType: string;
  durationSec: number | null;
  notes?: string | null;
  tags?: string[];
  form_data: FormGroup[];
  expected: Record<string, unknown>;
};

/** Row in `public/test-cases/index.json`. */
export type TestCaseIndexEntry = {
  id: string;
  name: string;
  audio: string;
  mimeType: string;
  durationSec: number | null;
  tags: string[];
  notes: string | null;
  fieldCount: number;
};

export type TestCaseIndex = {
  generatedAt: string;
  cases: TestCaseIndexEntry[];
};

/** Aggregate result of one benchmark run. */
export type RunResult = {
  id: string;
  timestamp: string;
  caseId: string;
  caseName: string;
  status: "success" | "failed";
  errorMessage?: string;
  scribeId?: string;
  latencyMs: number;
  ai_response?: Record<string, unknown>;
  score: ScoreOutcome | null;
  /** The form definition sent to /scribe/ — kept so we can render the "filled form" view. */
  formData?: FormGroup[];
  /** Where the audio came from — 'live-record' runs skip scoring. */
  audioSource?: "test-case" | "live-record";
  /** Only set for live-record runs (test cases use their manifest's expected). */
  expected?: Record<string, unknown>;
};

/** Per-field + aggregate scoring outcome. */
export type ScoreOutcome = {
  score: number;
  maxScore: number;
  percentage: number;
  perField: Record<
    string,
    {
      expected: unknown;
      received: unknown;
      score: number;
      maxScore: number;
      kind: "match" | "partial" | "miss" | "hallucination" | "correct-absence" | "error";
    }
  >;
};

/** Auth state kept in sessionStorage. */
export type Session = {
  baseUrl: string;
  access: string;
  refresh: string;
  loggedInAt: string;
  username: string;
};
