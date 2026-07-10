import type {
  FormField,
  FormGroup,
  QuestionnaireDetail,
  QuestionnaireQuestion,
  QuestionnaireType,
  TestCaseManifest,
} from "@/types";

/**
 * Question types we consider "fillable" — i.e. the AI is expected to produce
 * a value for them. `group` becomes a nested FormGroup and is not fillable
 * itself; `display` is prose; `structured` needs backend-specific schemas
 * that we can't safely synthesize on the fly.
 */
const SKIP_TYPES = new Set<QuestionnaireType>(["display", "structured"]);

/**
 * Map a CARE questionnaire question type to a JSON-Schema primitive type that
 * care_scribe's LLM function-calling layer understands. Gemini's Pydantic
 * validator rejects nullable arrays, so we always use a single type — see
 * `sanitizeFormDataForGemini` in scribe-runner for the safety net.
 */
function schemaTypeFor(type: QuestionnaireType): "string" | "number" | "boolean" {
  switch (type) {
    case "decimal":
    case "integer":
    case "quantity":
      return "number";
    case "boolean":
      return "boolean";
    default:
      // string, text, url, date, dateTime, time, choice → strings.
      // choice options are carried via `options` + `enum` in the schema.
      return "string";
  }
}

function isFillable(q: QuestionnaireQuestion): boolean {
  if (q.type === "group") return false;
  if (SKIP_TYPES.has(q.type)) return false;
  if (q.structured_type) return false;
  if (q.read_only) return false;
  return true;
}

/**
 * Convert one question into a scribe FormField. Assumes `isFillable(q)`.
 * The `schema` shape mirrors what the hand-written test-case manifests use:
 * an object with `value` (the extracted answer) + `note` (any commentary).
 */
function questionToField(q: QuestionnaireQuestion): FormField {
  const baseType = schemaTypeFor(q.type);
  const valueSchema: Record<string, unknown> = {
    type: baseType,
    description: q.text,
  };

  if (q.type === "choice" && q.answer_option?.length) {
    valueSchema.enum = q.answer_option.map((o) => o.value);
  }

  const field: FormField = {
    id: q.id,
    friendlyName: q.text,
    type: baseType,
    current: null,
    schema: {
      type: "object",
      properties: {
        value: valueSchema,
        note: { type: "string", description: "Any additional context" },
      },
    },
  };

  if (q.answer_option?.length) {
    field.options = q.answer_option.map((o) => ({
      id: o.value,
      text: o.display || o.value,
    }));
  }

  if (q.repeats) {
    field.repeats = true;
  }

  return field;
}

/**
 * Walk a list of questions, producing either fields (for scalar questions) or
 * nested FormGroups (for `group` questions). Groups without any fillable
 * descendants are dropped so the LLM isn't asked about empty sections.
 */
function walk(questions: QuestionnaireQuestion[]): Array<FormField | FormGroup> {
  const out: Array<FormField | FormGroup> = [];
  for (const q of questions) {
    if (q.type === "group") {
      const children = walk(q.questions ?? []);
      if (children.length === 0) continue;
      out.push({
        title: q.text,
        description: q.description ?? undefined,
        fields: children,
      });
      continue;
    }
    if (!isFillable(q)) continue;
    out.push(questionToField(q));
  }
  return out;
}

/**
 * Flatten a questionnaire tree into the ordered list of fillable questions
 * (skipping groups + display + structured). Useful when the UI wants to
 * render one row per expected-value input.
 */
export function flattenFillableQuestions(
  questions: QuestionnaireQuestion[],
): QuestionnaireQuestion[] {
  const out: QuestionnaireQuestion[] = [];
  const visit = (list: QuestionnaireQuestion[]) => {
    for (const q of list) {
      if (q.type === "group") {
        visit(q.questions ?? []);
        continue;
      }
      if (!isFillable(q)) continue;
      out.push(q);
    }
  };
  visit(questions);
  return out;
}

/**
 * Coerce a raw string from an `<input>` to the shape the scoring layer
 * expects. Mirrors the primitive types we produce in `schemaTypeFor`.
 */
export function coerceExpectedValue(raw: string, type: QuestionnaireType): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const primitive = schemaTypeFor(type);
  if (primitive === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  if (primitive === "boolean") {
    return ["true", "yes", "1", "y"].includes(trimmed.toLowerCase());
  }
  return trimmed;
}

/**
 * Build a scribe-runnable manifest from a fetched questionnaire plus the
 * user-provided expected answers. The top-level `form_data` is always a
 * single group (labelled with the questionnaire title) whose `fields`
 * mirror the questionnaire tree.
 */
export function questionnaireToManifest(
  questionnaire: QuestionnaireDetail,
  expectedByQid: Record<string, unknown>,
  opts: {
    audio: string;
    mimeType: string;
    durationSec: number | null;
    /**
     * Optional natural-language ground truth for the audio's transcript.
     * The scribe pipeline transcribes the audio independently of the
     * form-fill step; capturing this lets the UI show how accurate that
     * transcription is on its own.
     */
    expectedTranscript?: string;
  },
): TestCaseManifest {
  const nested = walk(questionnaire.questions ?? []);
  // Wrap in a single top-level group so the payload always has the
  // { title, fields } shape care_scribe expects — even if the questionnaire
  // has no top-level `group` question.
  const form_data: FormGroup[] = [
    {
      title: questionnaire.title,
      description: questionnaire.description ?? undefined,
      fields: nested,
    },
  ];

  // Only carry entries with non-null expected values so the scorer treats
  // unfilled questions as "no truth" rather than expecting an empty string.
  const expected: Record<string, { value: unknown; note: null }> = {};
  for (const [qid, value] of Object.entries(expectedByQid)) {
    if (value == null || value === "") continue;
    expected[qid] = { value, note: null };
  }

  // Flat UUID → friendly-name map so the UI can relabel the AI response
  // (whose keys are question UUIDs) with human-readable question text.
  const fieldLabels: Record<string, string> = {};
  const collectLabels = (list: QuestionnaireQuestion[]) => {
    for (const q of list) {
      if (q.text) fieldLabels[q.id] = q.text;
      if (q.questions?.length) collectLabels(q.questions);
    }
  };
  collectLabels(questionnaire.questions ?? []);

  return {
    name: questionnaire.title,
    audio: opts.audio,
    mimeType: opts.mimeType,
    durationSec: opts.durationSec,
    notes: questionnaire.description ?? null,
    tags: ["questionnaire", questionnaire.slug],
    form_data,
    expected,
    expectedTranscript: opts.expectedTranscript?.trim() || null,
    fieldLabels,
  };
}
