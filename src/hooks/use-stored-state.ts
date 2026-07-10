import { useCallback, useEffect, useState } from "react";

type Storage = "local" | "session";

function getStorage(kind: Storage): globalThis.Storage | null {
  if (typeof window === "undefined") return null;
  return kind === "local" ? window.localStorage : window.sessionStorage;
}

/**
 * React hook mirroring useState but persisted to local/sessionStorage as JSON.
 * SSR-safe: falls back to `initial` if window is not defined.
 */
export function useStoredState<T>(
  key: string,
  initial: T,
  kind: Storage = "local",
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    const s = getStorage(kind);
    if (!s) return initial;
    const raw = s.getItem(key);
    if (raw == null) return initial;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    const s = getStorage(kind);
    if (!s) return;
    try {
      s.setItem(key, JSON.stringify(value));
    } catch {
      // quota exceeded or storage disabled — silently drop
    }
  }, [key, value, kind]);

  const clear = useCallback(() => {
    const s = getStorage(kind);
    s?.removeItem(key);
    setValue(initial);
  }, [key, kind, initial]);

  return [value, setValue, clear];
}
