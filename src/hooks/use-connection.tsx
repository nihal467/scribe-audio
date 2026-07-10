import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { CareAPI, CareApiError } from "@/lib/care-api";
import type { Session } from "@/types";
import { useStoredState } from "@/hooks/use-stored-state";

type ConnectionCtx = {
  session: Session | null;
  api: CareAPI | null;
  login: (baseUrl: string, username: string, password: string) => Promise<void>;
  logout: () => void;
};

const Context = createContext<ConnectionCtx | null>(null);

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession, clearSession] = useStoredState<Session | null>(
    "scribe-audio.session",
    null,
    "session",
  );

  // Cache the CareAPI instance across renders while the session is stable.
  const apiRef = useRef<CareAPI | null>(null);
  const api = useMemo(() => {
    if (!session) {
      apiRef.current = null;
      return null;
    }
    if (
      !apiRef.current ||
      apiRef.current.baseUrl !== session.baseUrl.replace(/\/+$/, "")
    ) {
      apiRef.current = new CareAPI(session.baseUrl, session.access);
    } else {
      apiRef.current.setToken(session.access);
    }
    return apiRef.current;
  }, [session]);

  // On mount / when the session first loads, verify the access token.
  // If it's expired, try refreshing once. If that also fails, clear
  // the session so the user sees the login form instead of silently
  // getting 403s on every request.
  const validatedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!session || !api) return;
    // Skip if we already validated this exact access token.
    if (validatedForRef.current === session.access) return;
    validatedForRef.current = session.access;
    let cancelled = false;
    (async () => {
      const ok = await api.validateToken();
      if (cancelled || ok) return;
      // Try refresh
      try {
        const { access } = await api.refreshToken(session.refresh);
        if (cancelled) return;
        setSession({ ...session, access });
      } catch (err) {
        if (cancelled) return;
        // Refresh token is also dead — force re-login.
        // eslint-disable-next-line no-console
        console.warn(
          "[scribe-audio] Session expired; clearing.",
          err instanceof CareApiError ? err.body : err,
        );
        clearSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, api, setSession, clearSession]);

  const login = useCallback(
    async (baseUrl: string, username: string, password: string) => {
      const tempApi = new CareAPI(baseUrl);
      const tokens = await tempApi.login(username, password);
      setSession({
        baseUrl: baseUrl.replace(/\/+$/, ""),
        access: tokens.access,
        refresh: tokens.refresh,
        loggedInAt: new Date().toISOString(),
        username,
      });
    },
    [setSession],
  );

  const logout = useCallback(() => {
    clearSession();
    apiRef.current = null;
  }, [clearSession]);

  const value = useMemo<ConnectionCtx>(
    () => ({ session, api, login, logout }),
    [session, api, login, logout],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConnection(): ConnectionCtx {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useConnection must be used within <ConnectionProvider>");
  return ctx;
}
