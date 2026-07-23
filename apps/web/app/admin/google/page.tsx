"use client";

import { useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Google APIs — OAuth client status and recent Google Business Profile calls.
// The client secret is never sent to the browser; the API returns only a
// masked client id and the secret's last 4 characters.

interface GoogleApis {
  oauth: {
    configured: boolean;
    clientIdMasked: string | null;
    secretLast4: string | null;
    redirectUri: string | null;
  };
  last7d: Record<string, number>;
  recent: Array<{
    id: string;
    tenantName: string | null;
    operation: string;
    status: string;
    statusCode: number | null;
    durationMs: number | null;
    createdAt: string;
  }>;
}

const STATUS_TONE: Record<string, "ok" | "warn" | "danger"> = {
  OK: "ok",
  RATE_LIMITED: "warn",
  ERROR: "danger",
};

export default function AdminGooglePage() {
  const [data, setData] = useState<GoogleApis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<GoogleApis>("/api/v1/admin/google-apis")
      .then(setData)
      .catch((e) =>
        setError(e instanceof ApiClientError ? e.message : "Could not load Google API status."),
      );
  }, []);

  const counts = data?.last7d ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <AdminShell title="Google APIs">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3.5">
        <AdmCard>
          <div className="flex items-center justify-between">
            <AdmLabel>OAuth client</AdmLabel>
            <AdmPill tone={data ? (data.oauth.configured ? "ok" : "warn") : "neutral"}>
              {data ? (data.oauth.configured ? "Configured" : "Not configured") : "—"}
            </AdmPill>
          </div>
          {data?.oauth.configured ? (
            <div className="mt-3 flex flex-col gap-2">
              {(
                [
                  ["Client ID", data.oauth.clientIdMasked],
                  ["Secret", data.oauth.secretLast4 ? `••••${data.oauth.secretLast4}` : null],
                  ["Redirect URI", data.oauth.redirectUri],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <span className="text-micro uppercase tracking-wide text-adm-subtle">{label}</span>
                  <span className="break-all text-right font-geist-mono text-xs2 text-adm-muted">
                    {value ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-xs2 text-adm-muted">
              No Google OAuth client saved. Workspaces cannot connect their Business Profiles until
              one is configured on the server.
            </div>
          )}
        </AdmCard>

        <AdmCard>
          <AdmLabel>Calls · last 7 days</AdmLabel>
          <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
            {data ? total.toLocaleString() : "—"}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {data && total === 0 && (
              <span className="text-xs2 text-adm-muted">No Google API calls recorded yet.</span>
            )}
            {Object.entries(counts).map(([status, n]) => (
              <AdmPill key={status} tone={STATUS_TONE[status] ?? "neutral"}>
                {status} · {n.toLocaleString()}
              </AdmPill>
            ))}
          </div>
        </AdmCard>
      </div>

      <div className="mt-3.5">
        <div className="mb-2 flex items-center gap-2">
          <AdmLabel>Recent calls</AdmLabel>
          <span className="text-xs2 text-adm-muted">latest 50 across all workspaces</span>
        </div>
        {data === null ? (
          <AdmCard>
            <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
          </AdmCard>
        ) : data.recent.length === 0 ? (
          <AdmCard>
            <div className="py-8 text-center text-sm2 text-adm-muted">
              No calls logged. Entries appear once a workspace connects Google and syncs.
            </div>
          </AdmCard>
        ) : (
          <AdmCard className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-adm-line">
                  {["When", "Workspace", "Operation", "Status", "Code", "Duration"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-adm-subtle"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.id} className="border-b border-adm-line/60 last:border-0 hover:bg-adm-panel-hover">
                    <td className="whitespace-nowrap px-4 py-3 font-geist-mono text-micro text-adm-subtle">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs2 text-adm-muted">{r.tenantName ?? "—"}</td>
                    <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-ink">{r.operation}</td>
                    <td className="px-4 py-3">
                      <AdmPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</AdmPill>
                    </td>
                    <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">
                      {r.statusCode ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">
                      {r.durationMs != null ? `${r.durationMs} ms` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdmCard>
        )}
      </div>
    </AdminShell>
  );
}
