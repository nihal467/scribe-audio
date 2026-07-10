import { useState } from "react";
import { toast } from "sonner";
import { LogIn, LogOut, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConnection } from "@/hooks/use-connection";
import { CareApiError } from "@/lib/care-api";

/**
 * Panel 1 — CARE backend URL + username/password.
 * Handles JWT login, shows connection state, offers logout.
 */
export function BackendPanel() {
  const { session, login, logout } = useConnection();
  const [baseUrl, setBaseUrl] = useState(session?.baseUrl ?? "");
  const [username, setUsername] = useState(session?.username ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = !!session;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(baseUrl.trim(), username.trim(), password);
      setPassword("");
      toast.success("Connected", { description: session ? undefined : `Logged in to ${baseUrl}` });
    } catch (err) {
      const msg = extractErrorMessage(err);
      setError(msg);
      toast.error("Login failed", { description: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-sky-600" /> API to connect backend
            </CardTitle>
            <CardDescription>CARE backend URL + credentials (JWT).</CardDescription>
          </div>
          {isConnected ? (
            <Badge variant="success">
              <ShieldCheck className="mr-1 h-3 w-3" /> Connected
            </Badge>
          ) : (
            <Badge variant="outline">
              <WifiOff className="mr-1 h-3 w-3" /> Disconnected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected && session ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-slate-500">Backend:</span>
                <code className="text-slate-900">{session.baseUrl}</code>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-slate-500">User:</span>
                <code className="text-slate-900">{session.username}</code>
                <span className="ml-2 text-xs text-slate-400">
                  since {new Date(session.loggedInAt).toLocaleTimeString()}
                </span>
              </div>
            </div>
            <Button variant="outline" onClick={logout} className="w-full">
              <LogOut className="h-4 w-4" /> Log out
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="backend-url">Backend URL</Label>
              <Input
                id="backend-url"
                type="url"
                placeholder="https://careapi.your-hospital.org"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
                autoComplete="url"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>
            {error && (
              <Alert variant="danger">
                <AlertTitle>Login failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
              className="w-full"
            >
              <LogIn className="h-4 w-4" />
              {submitting ? "Connecting…" : "Connect"}
            </Button>
            <p className="text-xs text-slate-500">
              Requires a <strong>superuser</strong> account — benchmark mode is superuser-only in
              <code className="mx-1">care_scribe</code>.
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof CareApiError) {
    if (err.isCorsSuspected) {
      return "Could not reach the backend. This is almost always CORS — add this dashboard's origin to CORS_ALLOWED_ORIGINS on the CARE backend.";
    }
    const body = err.body as { detail?: string; non_field_errors?: string[] } | null;
    if (body?.detail) return body.detail;
    if (body?.non_field_errors?.length) return body.non_field_errors.join("; ");
    return `${err.status} ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
