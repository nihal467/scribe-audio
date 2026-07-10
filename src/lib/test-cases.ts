import type { TestCaseIndex, TestCaseIndexEntry, TestCaseManifest } from "@/types";

const INDEX_PATH = "test-cases/index.json";
const CASE_ROOT = "test-cases";

/** Base URL for test-case assets. Uses Vite's BASE_URL so it works under `/repo/` on GH Pages. */
function assetUrl(p: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;
}

export async function loadTestCaseIndex(): Promise<TestCaseIndex> {
  const res = await fetch(assetUrl(INDEX_PATH), { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(
      `Could not load test-case index at ${INDEX_PATH}. Did the build script run? (npm run test-cases:index)`,
    );
  }
  return (await res.json()) as TestCaseIndex;
}

export async function loadTestCaseManifest(caseId: string): Promise<TestCaseManifest> {
  const res = await fetch(assetUrl(`${CASE_ROOT}/${caseId}/manifest.json`), { cache: "no-cache" });
  if (!res.ok) throw new Error(`Manifest for case '${caseId}' not found`);
  return (await res.json()) as TestCaseManifest;
}

export async function loadTestCaseAudio(caseId: string, entry: TestCaseIndexEntry): Promise<Blob> {
  const url = assetUrl(`${CASE_ROOT}/${caseId}/${entry.audio}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audio for case '${caseId}' not found at ${url}`);
  return await res.blob();
}

export function audioPreviewUrl(caseId: string, entry: TestCaseIndexEntry): string {
  return assetUrl(`${CASE_ROOT}/${caseId}/${entry.audio}`);
}
