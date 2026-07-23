"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Connect Google Business Profile.
//
// This page was previously missing — the Locations "Connect Google" button
// linked to a 404. It shows the tenant's current connection, and starts the
// OAuth flow by asking the API for an authorization URL (which encodes a
// signed state) and redirecting the browser to Google.
//
// Two states gate the button honestly:
//   - configured=false → the PLATFORM OAuth client isn't set up yet; no amount
//     of clicking here will work, so we say so and don't offer the button.
//   - connected=true   → already linked; we show the account + offer a reconnect.

interface Connection {
  configured: boolean;
  connected: boolean;
  label: string | null;
  last4: string | null;
  accountName: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  lastSyncedAt: string | null;
}

export default function GmbConnectPage() {
  const [conn, setConn] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setConn(await api.get<Connection>("/api/v1/gmb/google/connection"));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load the connection status.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startConnect() {
    setStarting(true);
    setError(null);
    try {
      const redirectUri = `${window.location.origin}/gmb-connect/callback`;
      const { authorizationUrl } = await api.get<{ authorizationUrl: string; state: string }>(
        `/api/v1/gmb/google/oauth-url?redirectUri=${encodeURIComponent(redirectUri)}`,
      );
      // Hand the browser to Google; the callback route finishes the exchange.
      window.location.href = authorizationUrl;
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not start the Google connection.");
      setStarting(false);
    }
  }

  return (
    <GmbShell title="Connect Google">
      {error && <ErrorNote>{error}</ErrorNote>}

      {conn === null ? (
        <Skeleton className="h-[220px] max-w-[560px]" />
      ) : (
        <div className="flex max-w-[560px] flex-col gap-3.5">
          <Card>
            <div className="flex items-center justify-between">
              <SectionLabel>Google Business Profile</SectionLabel>
              <Pill tone={conn.connected ? "ok" : conn.configured ? "neutral" : "warn"}>
                {conn.connected ? "Connected" : conn.configured ? "Not connected" : "Unavailable"}
              </Pill>
            </div>

            {conn.connected ? (
              <>
                <div className="mt-3 flex flex-col gap-1.5 text-sm2 text-gmb-ink-muted">
                  {conn.accountName && (
                    <div>
                      Account: <span className="text-gmb-ink">{conn.accountName}</span>
                    </div>
                  )}
                  {conn.last4 && (
                    <div>
                      Credential: <span className="font-geist-mono">••••{conn.last4}</span>
                    </div>
                  )}
                  {conn.connectedAt && (
                    <div>Connected {new Date(conn.connectedAt).toLocaleDateString()}</div>
                  )}
                  <div>
                    {conn.lastSyncedAt
                      ? `Last synced ${new Date(conn.lastSyncedAt).toLocaleString()}`
                      : "Not synced yet — import locations to pull your profiles."}
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Link href="/gmb-locations" className="no-underline hover:no-underline">
                    <Button>Go to locations</Button>
                  </Link>
                  <Button variant="ghost" onClick={() => void startConnect()} disabled={starting}>
                    {starting ? "Redirecting…" : "Reconnect"}
                  </Button>
                </div>
              </>
            ) : conn.configured ? (
              <>
                <p className="mt-3 text-sm2 leading-relaxed text-gmb-ink-muted">
                  Link your Google Business Profile so GMB Suite can import your locations, sync
                  reviews and insights, and publish updates you approve. You'll sign in with Google
                  and grant access — you can revoke it any time from your Google account.
                </p>
                <div className="mt-4">
                  <Button onClick={() => void startConnect()} disabled={starting}>
                    {starting ? "Redirecting to Google…" : "Connect Google Business Profile"}
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm2 leading-relaxed text-gmb-ink-muted">
                Google sign-in isn't available on this workspace yet — the platform's Google
                connection hasn't been configured. Contact your administrator, or add locations
                manually from{" "}
                <Link href="/gmb-locations" className="font-semibold text-gmb-brand">
                  Locations
                </Link>{" "}
                in the meantime.
              </p>
            )}
          </Card>

          {conn.configured && !conn.connected && (
            <Card>
              <SectionLabel>Prefer to start without Google?</SectionLabel>
              <p className="mt-2 text-sm2 leading-relaxed text-gmb-ink-muted">
                You can add a location by hand and connect Google later — everything except live
                Google sync works on a manual location.
              </p>
              <div className="mt-3">
                <Link href="/gmb-locations" className="no-underline hover:no-underline">
                  <Button variant="ghost">Add a location manually</Button>
                </Link>
              </div>
            </Card>
          )}
        </div>
      )}
    </GmbShell>
  );
}
