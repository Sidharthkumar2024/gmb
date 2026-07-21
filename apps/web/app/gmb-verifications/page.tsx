"use client";

import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Verification — proving ownership of a location to Google.
//
// This screen is the customer-initiated guarantee made visible. The backend
// refuses to create a request without a signed-in user, and nothing here
// starts one on load, on a timer, or as a side effect of anything else. The
// owner presses the button or it does not happen — and the copy says so, so
// nobody assumes we verify on their behalf.

const METHOD_LABEL: Record<string, string> = {
  PHONE_CALL: "Phone call",
  SMS: "Text message",
  EMAIL: "Email",
  POSTCARD: "Postcard",
};

const METHOD_BLURB: Record<string, string> = {
  PHONE_CALL: "Google calls the business number with a code.",
  SMS: "Google texts a code to the business number.",
  EMAIL: "Google emails a code to the address on the profile.",
  POSTCARD: "Google mails a postcard — usually 5–14 days.",
};

interface Status {
  googleVerified: boolean;
  googleState: string;
  availableMethods: string[];
  latestRequest: {
    id: string;
    method: string;
    state: "PENDING" | "VERIFIED" | "FAILED" | "CANCELED";
    requestedAt: string;
    completedAt: string | null;
  } | null;
  allowed: boolean;
  reason?: string;
}

interface LocationLite {
  id: string;
  name: string;
}

export default function GmbVerificationsPage() {
  const [locations, setLocations] = useState<LocationLite[]>([]);
  const [locationId, setLocationId] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [method, setMethod] = useState("SMS");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<LocationLite[]>("/api/v1/gmb/locations")
      .then((rows) => {
        setLocations(rows ?? []);
        const saved = window.localStorage.getItem("gmb_active_location");
        setLocationId(rows?.some((r) => r.id === saved) ? saved! : (rows?.[0]?.id ?? ""));
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    if (!locationId) return;
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
      setError(e instanceof ApiClientError ? e.message : "Could not submit the code.");
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

      <Card className="mb-3.5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <SectionLabel>Ownership verification</SectionLabel>
            <div className="mt-1 max-w-xl text-sm2 text-gmb-ink-muted">
              Google needs to confirm you own this business before your profile can be managed.
              <strong className="text-gmb-ink"> You start this — we never begin verification on
              your behalf.</strong>
            </div>
          </div>
          {locations.length > 1 && (
            <label className="font-geist-mono text-micro uppercase tracking-wide text-gmb-ink-subtle">
              Location
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="mt-1 block rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Card>

      {status === null ? (
        <Skeleton className="h-40" />
      ) : status.googleVerified ? (
        <Card>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gmb-ok-bg text-lg text-gmb-ok">
              ✓
            </span>
            <div>
              <div className="text-[15px] font-semibold text-gmb-ok">Verified with Google</div>
              <div className="mt-0.5 text-sm2 text-gmb-ink-muted">
                Nothing more to do for this location.
              </div>
            </div>
          </div>
        </Card>
      ) : pending ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="warn">In progress</Pill>
            <span className="text-[13px] font-semibold">
              {METHOD_LABEL[status.latestRequest!.method] ?? status.latestRequest!.method}
            </span>
            <span className="font-geist-mono text-micro text-gmb-ink-subtle">
              started {new Date(status.latestRequest!.requestedAt).toLocaleDateString()}
            </span>
          </div>
          <div className="mt-2 text-sm2 text-gmb-ink-muted">
            Google is sending your code. Enter it below once it arrives.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Verification code"
              inputMode="numeric"
              className="rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 font-geist-mono text-sm2 outline-none focus:border-gmb-brand-border"
            />
            <Button disabled={busy === "complete" || !code.trim()} onClick={() => void complete()}>
              {busy === "complete" ? "Checking…" : "Submit code"}
            </Button>
            <Button variant="ghost" disabled={busy === "cancel"} onClick={() => void cancel()}>
              Cancel request
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center gap-2">
            <SectionLabel>Status</SectionLabel>
            <Pill>{status.googleState === "UNKNOWN" ? "Not verified" : status.googleState}</Pill>
          </div>

          <div className="mt-4 grid gap-2.5 md:grid-cols-2">
            {status.availableMethods.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                aria-pressed={method === m}
                className={`rounded-control border p-3 text-left transition ${
                  method === m
                    ? "border-gmb-brand bg-gmb-brand-wash"
                    : "border-gmb-line bg-gmb-surface hover:border-gmb-brand-border"
                }`}
              >
                <div className="text-[13px] font-semibold">{METHOD_LABEL[m] ?? m}</div>
                <div className="mt-0.5 text-micro text-gmb-ink-subtle">{METHOD_BLURB[m] ?? ""}</div>
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={busy === "request" || !status.allowed}
              onClick={() => void request()}
            >
              {busy === "request" ? "Starting…" : "Request verification"}
            </Button>
            {!status.allowed && status.reason && (
              <span className="text-xs2 text-gmb-ink-muted">{status.reason}</span>
            )}
          </div>

          <p className="mt-3 text-micro text-gmb-ink-subtle">
            Submitted to Google once your Business Profile connection is live.
          </p>
        </Card>
      )}
    </GmbShell>
  );
}
