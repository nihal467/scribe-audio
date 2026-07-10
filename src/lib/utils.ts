import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names, resolving conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Strip trailing slashes from a URL so we can safely append paths. */
export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Human-readable time delta. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

/** Read a File/Blob's audio duration (in seconds) using an off-screen audio element. */
export async function readAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = url;
    const cleanup = () => URL.revokeObjectURL(url);
    audio.addEventListener("loadedmetadata", () => {
      const dur = audio.duration;
      cleanup();
      if (Number.isFinite(dur) && dur > 0) resolve(dur);
      else reject(new Error("Could not read audio duration"));
    });
    audio.addEventListener("error", () => {
      cleanup();
      reject(new Error("Failed to load audio for duration probe"));
    });
  });
}

/** crypto.randomUUID with a v4 fallback for older browsers. */
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Pick n distinct random items from an array. Uses Fisher-Yates on a copy. */
export function sampleRandom<T>(arr: readonly T[], n: number): T[] {
  const copy = arr.slice();
  const out: T[] = [];
  const count = Math.min(n, copy.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}
