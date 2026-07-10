import type { ScoreOutcome } from "@/types";

/**
 * Score an ai_response against expected values.
 *
 * Adapted from the scoring logic in care_scribe_fe/src/pages/Benchmark.tsx (MIT, © 10bedicu).
 *
 * Rules:
 *   • Exact match → 3 pts
 *   • Number close-enough → similarity
 *   • String → 3 * (1 − levenshtein / max(len))
 *   • Array → per-element similarity, averaged (max 3)
 *   • Object → recursively unwrap `{ value, note? }` then apply above rules
 *   • Missing key with expected null/undefined → 3 pts (correct absence)
 *   • Missing key with expected value → -1 (miss)
 *   • Unexpected key (not in expected) → -1 (hallucination), unless value is empty
 *
 * Max per field is 3, so percentage = totalScore / (fields × 3) × 100.
 */
export function scoreAgainstExpected(
  received: Record<string, unknown> | null | undefined,
  expected: Record<string, unknown>,
): ScoreOutcome {
  const perField: ScoreOutcome["perField"] = {};
  const totalFields = Object.keys(expected).length;
  const maxScore = totalFields * 3;

  for (const [key, expRaw] of Object.entries(expected)) {
    const expVal = unwrap(expRaw);
    const gotRaw = received?.[key];
    const gotVal = gotRaw === undefined ? undefined : unwrap(gotRaw);

    if (gotRaw === undefined) {
      // key missing from response
      if (expVal === null || expVal === undefined) {
        perField[key] = { expected: expRaw, received: null, score: 3, maxScore: 3, kind: "correct-absence" };
      } else {
        perField[key] = { expected: expRaw, received: null, score: -1, maxScore: 3, kind: "miss" };
      }
      continue;
    }

    try {
      const s = similarity(expVal, gotVal);
      const score = s * 3;
      let kind: ScoreOutcome["perField"][string]["kind"] = "match";
      if (score < 3 && score >= 1) kind = "partial";
      else if (score < 1) kind = "miss";
      perField[key] = { expected: expRaw, received: gotRaw, score, maxScore: 3, kind };
    } catch (err) {
      perField[key] = {
        expected: expRaw,
        received: gotRaw,
        score: 0,
        maxScore: 3,
        kind: "error",
      };
      console.error(`Scoring error for '${key}':`, err);
    }
  }

  // Penalise hallucinations: keys in `received` but not in `expected` with non-empty values
  if (received) {
    for (const [key, rawVal] of Object.entries(received)) {
      if (key in expected) continue;
      const v = unwrap(rawVal);
      if (isEmpty(v)) continue;
      perField[key] = {
        expected: null,
        received: rawVal,
        score: -1,
        maxScore: 0,
        kind: "hallucination",
      };
    }
  }

  const score = Object.values(perField).reduce((acc, f) => acc + f.score, 0);
  const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

  return { score, maxScore, percentage, perField };
}

/**
 * If value is `{ value: X, note?: Y }`, unwrap to X. Otherwise return as-is.
 * This accommodates the scribe convention where each field is `{value, note}`.
 */
function unwrap(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in (v as Record<string, unknown>)) {
    return (v as Record<string, unknown>).value;
  }
  return v;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/**
 * Return a similarity score in [0, 1] for two values of arbitrary shape.
 * 1 = identical, 0 = no useful overlap.
 */
export function similarity(expected: unknown, got: unknown): number {
  if (expected === got) return 1;

  if (expected == null && got == null) return 1;
  if (expected == null || got == null) return 0;

  if (typeof expected === "number" && typeof got === "number") {
    if (expected === got) return 1;
    const denom = Math.max(Math.abs(expected), Math.abs(got), 1);
    const diff = Math.abs(expected - got) / denom;
    // within 5% → full credit, then linear falloff to 0 at 50%
    if (diff <= 0.05) return 1;
    if (diff >= 0.5) return 0;
    return Math.max(0, 1 - (diff - 0.05) / 0.45);
  }

  if (typeof expected === "string" && typeof got === "string") {
    return stringSimilarity(expected, got);
  }

  if (typeof expected === "boolean" && typeof got === "boolean") {
    return expected === got ? 1 : 0;
  }

  if (Array.isArray(expected) && Array.isArray(got)) {
    if (expected.length === 0 && got.length === 0) return 1;
    if (expected.length === 0 || got.length === 0) return 0;
    // Greedy match: for each expected, take max similarity from unused `got` items.
    const used = new Set<number>();
    let total = 0;
    for (const e of expected) {
      let best = 0;
      let bestIdx = -1;
      for (let i = 0; i < got.length; i++) {
        if (used.has(i)) continue;
        const s = similarity(e, got[i]);
        if (s > best) {
          best = s;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) used.add(bestIdx);
      total += best;
    }
    // Divide by max length so extra items in `got` are penalised.
    return total / Math.max(expected.length, got.length);
  }

  if (typeof expected === "object" && typeof got === "object") {
    // Deep structural similarity — average of per-key similarity.
    const expObj = expected as Record<string, unknown>;
    const gotObj = got as Record<string, unknown>;
    const keys = new Set([...Object.keys(expObj), ...Object.keys(gotObj)]);
    if (keys.size === 0) return 1;
    let sum = 0;
    for (const k of keys) sum += similarity(expObj[k], gotObj[k]);
    return sum / keys.size;
  }

  // Type mismatch, fall back to loose equality via string cast.
  return String(expected) === String(got) ? 1 : 0;
}

/** Levenshtein-derived similarity in [0, 1]. */
export function stringSimilarity(a: string, b: string): number {
  const A = a.trim().toLowerCase();
  const B = b.trim().toLowerCase();
  if (A === B) return 1;
  if (!A.length && !B.length) return 1;
  if (!A.length || !B.length) return 0;
  const d = levenshtein(A, B);
  return 1 - d / Math.max(A.length, B.length);
}

/** Iterative memory-efficient Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}
