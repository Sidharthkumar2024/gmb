"use client";

import { useCallback, useEffect, useState } from "react";
import { GmbShell, useActiveLocationId } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Verification — proving ownership of a location with Google.
//
// STRICTLY customer-initiated, which the backend enforces by requiring a
// signed-in user on every request. The copy says so plainly: this is the one
// flow where a background job acting "helpfully" would be a policy violation,
// so the UI must never suggest the platform starts it for you.

type Method = "PHONE_CALL" | "SMS" | "EMAIL" | "POSTCARD";

const METHOD_LABEL: Record<Method, string> = {
  PHONE_CALL: "Phone call",
  SMS: "Text message",
  EMAIL: "Email",
  POSTCARD: "Postcard",
};

interface Status {
  googleVerified: boolean;
  googleState: string;
  availableMethods: Method[];
  latestRequest: {
    id: string;
    method: Method;
    state: "PENDING" | "VERIFIED" | "FAILED" | "CANCELED";
    requestedAt: string;
    completedAt: string | null;
  } | null;
  allowed: boolean;
  reason?: string;
}

export default function GmbVerificationsPage() {
  const locationId = useActiveLocationId();
  const [status, setStatus] = useState<Status | null>(null);
  const [method, setMethod] = useState<Method>("SMS");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!locationId) {
      setStatus(null);
      return;
    }
    setError(null);
    try {
      setStatus(
        await api.get<Status>(`/api/v1/gmb/verifications/status?locationId=${locationId}`),
      );
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load verification status.");
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function request() {
    if (!locationId) return;
    setBusy("request");
    setError(null);
    try {
      await api.post("/api/v1/gmb/verifications", { locationId, method });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not start verification.");
    } finally {
      setBusy(null);
    }
  }

  async function complete() {
    const id = status?.latestRequest?.id;
    if (!id || !code.trim()) return;
    setBusy("complete");
    setError(null);
    try {
      await api.post(`/api/v1/gmb/verifications/${id}/complete`, { code: code.trim() });
      setCode("");
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not complete verification.");
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    const id = status?.latestRequest?.id;
    if (!id) return;
    setBusy("cancel");
    try {
      await api.post(`/api/v1/gmb/verifications/${id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not cancel.");
    } finally {
      setBusy(null);
    }
  }

  const pending = status?.latestRequest?.state === "PENDING";

  return (
    <GmbShell title="Verification">
      {error && <ErrorNote>{error}</ErrorNote>}

      {!locationId ? (
        <Card>
          <div className="py-4 text-center text-sm2 text-gmb-ink-muted">
            Select a location in the sidebar to verify it.
          </div>
        </Card>
      ) : status === null ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid grid-cols-[1.3fr_1fr] items-start gap-3.5">
          <Card>
            <div className="flex items-center gap-2">
              <SectionLabel>Status</SectionLabel>
              {status.googleVerified ? (
                <Pill tone="ok">Verified</Pill>
              ) : (
                <Pill>
                  {status.googleState === "UNKNOWN" ? "Not verified" : status.googleState.toLowerCase()}
                </Pill>
              )}
            </div>

            {status.googleVerified ? (
              <p className="mt-3 text-sm2 text-gmb-ok">
                This location is verified — nothing more to do.
              </p>
            ) : pending ? (
              <div className="mt-4 rounded-control border border-gmb-warn/30 bg-gmb-warn-bg p-3.5">
                <div className="text-sm2 font-semibold text-gmb-warn">
                  Verification in progress —{" "}
                  {METHOD_LABEL[status.latestRequest!.method] ?? status.latestRequest!.method}
                </div>
                <div className="mt-0.5 text-xs2 text-gmb-warn">
                  Google sends a code by your chosen method. Enter it below once it
                  arrives — a postcard can take up to two weeks.
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Verification code"
                    className="rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 font-geist-mono text-sm2 outline-none focus:border-gmb-brand-border"
                  />
                  <Button
                    disabled={busy === "complete" || !code.trim()}
                    onClick={() => void complete()}
                  >
                    {busy === "complete" ? "Verifying…" : "Submit code"}
                  </Button>
                  <Button variant="ghost" disabled={busy === "cancel"} onClick={() => void cancel()}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <label className="text-micro font-semibold uppercase tracking-wide text-gmb-ink-subtle">
                  How should Google reach you?
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as Method)}
                    className="mt-1 block w-64 rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none"
                  >
                    {status.availableMethods.map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABEL[m] ?? m}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-3">
                  <Button
                    disabled={busy === "request" || !status.allowed}
                    onClick={() => void request()}
                  >
                    {busy === "request" ? "Starting…" : "Request verification"}
                  </Button>
                  {!status.allowed && status.reason && (
                    <span className="ml-2.5 text-xs2 text-gmb-ink-subtle">{status.reason}</span>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card>
            <SectionLabel>How this works</SectionLabel>
            <ul className="mt-2.5 flex list-none flex-col gap-2 p-0 text-sm2 text-gmb-ink-muted">
              <li>
                <strong className="text-gmb-ink">You start it.</strong> We never
                trigger verification on your behalf — Google requires the owner to
                request it.
              </li>
              <li>Google sends a code by your chosen method.</li>
              <li>Enter the code here to finish.</li>
            </ul>
            <div className="mt-3 border-t border-gmb-line-soft pt-3 text-micro text-gmb-ink-subtle">
              Verification is submitted to Google once your Business Profile
              connection is live.
            </div>
          </Card>
        </div>
      )}
    </GmbShell>
  );
}
