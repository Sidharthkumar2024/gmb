"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "../lib/api";

// GBP Verification panel (Adgrowly GMB Panel — "Verifications API").
// STRICTLY customer-initiated: nothing happens until the owner clicks
// "Request verification" and enters the code. No background triggers.

const METHOD_LABEL: Record<string, string> = {
  PHONE_CALL: "Phone call",
  SMS: "Text message",
  EMAIL: "Email",
  POSTCARD: "Postcard",
};

interface Status {
  googleVerified: boolean;
  googleState: string;
  availableMethods: string[];
  latestRequest: {
    id: string;
    method: string;
    state: string;
    requestedAt: string;
  } | null;
  allowed: boolean;
  reason?: string;
}

export function GmbVerificationPanel({
  locations,
}: {
  locations: Array<{ id: string; name: string }>;
}) {
  const [locationId, setLocationId] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [method, setMethod] = useState("SMS");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const refresh = useCallback(async () => {
    if (!locationId) return;
    setErr(null);
    try {
      setStatus(
        await api.get<Status>(`/api/v1/gmb/verifications/status?locationId=${locationId}`),
      );
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not load verification status.");
    }
  }, [locationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function request() {
    if (!locationId) return;
    setBusy("request");
    setErr(null);
    try {
      await api.post("/api/v1/gmb/verifications", { locationId, method });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not start verification.");
    } finally {
      setBusy(null);
    }
  }

  async function complete() {
    const id = status?.latestRequest?.id;
    if (!id || !code.trim()) return;
    setBusy("complete");
    setErr(null);
    try {
      await api.post(`/api/v1/gmb/verifications/${id}/complete`, { code: code.trim() });
      setCode("");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not complete verification.");
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
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not cancel.");
    } finally {
      setBusy(null);
    }
  }

  const pending = status?.latestRequest?.state === "PENDING";

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Profile verification</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Verify ownership of this location with Google. You start it — we never
            trigger verification on your behalf.
          </p>
        </div>
        {locations.length > 1 && (
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {err && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {status && (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Status:</span>
            {status.googleVerified ? (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                ✓ Verified
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                {status.googleState === "UNKNOWN" ? "Not verified" : status.googleState}
              </span>
            )}
          </div>

          {status.googleVerified ? (
            <p className="mt-3 text-sm text-emerald-700">
              This location is verified — nothing more to do.
            </p>
          ) : pending ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800">
                Verification in progress — {METHOD_LABEL[status.latestRequest!.method] ?? status.latestRequest!.method}
              </p>
              <p className="mt-0.5 text-xs text-amber-700">
                Google sends a code by your chosen method. Enter it below.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Verification code"
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void complete()}
                  disabled={busy === "complete" || !code.trim()}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy === "complete" ? "Verifying…" : "Submit code"}
                </button>
                <button
                  type="button"
                  onClick={() => void cancel()}
                  disabled={busy === "cancel"}
                  className="text-xs text-slate-400 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="text-xs font-medium text-slate-600">
                Method
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="mt-1 block rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                >
                  {status.availableMethods.map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABEL[m] ?? m}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void request()}
                disabled={busy === "request" || !status.allowed}
                title={status.allowed ? undefined : status.reason}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy === "request" ? "Starting…" : "Request verification"}
              </button>
            </div>
          )}
          <p className="mt-3 text-[11px] text-slate-400">
            Verification is submitted to Google once your Google Business account is connected.
          </p>
        </div>
      )}
    </div>
  );
}
