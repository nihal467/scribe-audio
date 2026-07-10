import type { CareAPI } from "@/lib/care-api";
import type { FormGroup, Scribe, ScribeStatus, TestCaseManifest } from "@/types";
import { readAudioDuration } from "@/lib/utils";

const TERMINAL: ReadonlySet<ScribeStatus> = new Set(["COMPLETED", "FAILED", "REFUSED"]);

/**
 * Recursively walk a form_data tree and collapse JSON-Schema-nullable
 * `type: ["X", "null"]` (or `["null", "X"]`) into a single `type: "X"`.
 *
 * care_scribe passes each field's `schema` verbatim into Google Gemini's
 * `types.Tool(function_declarations=[…])`, whose Pydantic model rejects the
 * array-of-types shape with:
 *   "Input should be 'TYPE_UNSPECIFIED', 'STRING', 'NUMBER', ..., 'NULL'
 *    [input_value=['string', 'null'], input_type=list]"
 * OpenAI's structured outputs accept either form, so the single-type
 * variant is portable across providers.
 */
export function sanitizeFormDataForGemini(form_data: FormGroup[]): FormGroup[] {
  return JSON.parse(JSON.stringify(form_data), (_key, value) => {
    if (
      value &&
      typeof value === "object" &&
      Array.isArray((value as { type?: unknown }).type)
    ) {
      const types = (value as { type: unknown[] }).type;
      const nonNull = types.filter((t) => t !== "null" && t !== null);
      if (nonNull.length === 1 && typeof nonNull[0] === "string") {
        return { ...value, type: nonNull[0] };
      }
    }
    return value;
  });
}

export type ScribeStage =
  | "creating"
  | "uploading"
  | "marking-ready"
  | "polling"
  | "done";

export type RunUpdate = {
  stage: ScribeStage;
  scribeId?: string;
  status?: ScribeStatus;
  message?: string;
};

/**
 * Ambient "a run is in flight for case X" state passed from the panel that
 * kicked off the run down to any UI that needs to disable itself or show a
 * progress bar. Owned by App.tsx; consumed by QuestionnairePanel.
 */
export type ActiveRunState = {
  caseId: string;
  update: RunUpdate;
  startedAt: number;
};

export type RunOptions = {
  chatModel?: string;
  audioModel?: string;
  temperature?: number;
  transcriptOnly?: boolean;
  /** Poll interval in ms — default 1500. */
  pollIntervalMs?: number;
  /** Give up after this many polls — default 240 (≈6 min at default interval). */
  maxPolls?: number;
  onUpdate?: (u: RunUpdate) => void;
  signal?: AbortSignal;
};

export type RunOutcome = {
  scribe: Scribe;
  latencyMs: number;
};

/**
 * Run one test case through the scribe pipeline in benchmark mode.
 * Sequence: create scribe (benchmark=true) → upload audio → mark READY → poll.
 * Returns the final Scribe (status COMPLETED or FAILED).
 */
export async function runTestCase(args: {
  api: CareAPI;
  manifest: TestCaseManifest;
  audio: Blob;
  options?: RunOptions;
}): Promise<RunOutcome> {
  const { api, manifest, audio, options = {} } = args;
  const {
    chatModel,
    audioModel,
    temperature,
    transcriptOnly = false,
    pollIntervalMs = 1500,
    maxPolls = 240,
    onUpdate,
    signal,
  } = options;
  const start = performance.now();

  const emit = (u: RunUpdate) => onUpdate?.(u);
  const abortIfNeeded = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };

  // 1. Create the scribe record in benchmark mode
  emit({ stage: "creating" });
  abortIfNeeded();
  const scribe = await api.createScribe({
    status: "CREATED",
    form_data: sanitizeFormDataForGemini(manifest.form_data),
    benchmark: true,
    chat_model: chatModel,
    audio_model: audioModel,
    chat_model_temperature: temperature,
    transcript_only: transcriptOnly,
  });

  // 2. Upload audio
  emit({ stage: "uploading", scribeId: scribe.external_id });
  abortIfNeeded();
  const duration =
    manifest.durationSec != null && manifest.durationSec > 0
      ? manifest.durationSec
      : await readAudioDuration(audio).catch(() => 0);
  const originalName = manifest.audio || "audio.mp3";
  // MediaRecorder produces mimes like `audio/webm;codecs=opus`, but CARE's
  // `settings.ALLOWED_MIME_TYPES` is an exact-match allowlist of *base* types
  // (`audio/webm`, `audio/mp4`, `audio/ogg`, `audio/mpeg`, …). Sending the
  // codec parameter 400s with `{"detail":"Invalid File Type"}`. Strip it and
  // reuse the same clean type for the S3 PUT so the presigned URL signature
  // (which is bound to Content-Type) stays consistent.
  const wireMime = manifest.mimeType.split(";")[0].trim();
  const file = await api.createScribeFile({
    file_type: "SCRIBE_AUDIO",
    associating_id: scribe.external_id,
    original_name: originalName,
    mime_type: wireMime,
    name: originalName,
    length: duration,
  });
  await api.uploadToSignedUrl(file.signed_url, audio, wireMime);
  abortIfNeeded();
  await api.completeScribeFile(file.id, {
    associatingId: scribe.external_id,
    fileType: "SCRIBE_AUDIO",
  });

  // 3. Mark READY → triggers Celery process_ai_form_fill
  emit({ stage: "marking-ready", scribeId: scribe.external_id });
  abortIfNeeded();
  await api.updateScribe(scribe.external_id, { status: "READY" });

  // 4. Poll until terminal state
  emit({ stage: "polling", scribeId: scribe.external_id, status: "READY" });
  let final: Scribe | null = null;
  for (let i = 0; i < maxPolls; i++) {
    abortIfNeeded();
    await sleep(pollIntervalMs, signal);
    const current = await api.getScribe(scribe.external_id);
    emit({ stage: "polling", scribeId: scribe.external_id, status: current.status });
    if (TERMINAL.has(current.status)) {
      final = current;
      break;
    }
  }
  if (!final) {
    throw new Error(
      `Scribe ${scribe.external_id} did not complete within ${(maxPolls * pollIntervalMs) / 1000}s`,
    );
  }

  emit({ stage: "done", scribeId: scribe.external_id, status: final.status });
  const latencyMs = performance.now() - start;
  return { scribe: final, latencyMs };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
