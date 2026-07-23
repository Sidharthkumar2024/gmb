"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Accounts — every workspace on the platform.
//
// Suspending a workspace revokes its refresh tokens server-side, so live
// sessions end within one access-token lifetime. The confirm names the
// workspace, because suspending the wrong customer is the costly mistake here.

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  users: number;
  locations: number;
  reviews: number;
  credits: number;
  createdAt: string;
}

const STATUS_TONE = { ACTIVE: "ok", SUSPENDED: "warn", DELETED: "danger" } as const;

export default function AdminAccountsPage() {
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    setError(null);
    try {
      const qs = query ? `?q=${encodeURIComponent(query)}` : "";
      setRows((await api.get<TenantRow[]>(`/api/v1/admin/tenants${qs}`)) ?? []);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load accounts.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  async function setStatus(t: TenantRow, status: "ACTIVE" | "SUSPENDED") {
    const verb = status === "SUSPENDED" ? "Suspend" : "Reactivate";
    if (!window.confirm(`${verb} "${t.name}"? ${status === "SUSPENDED" ? "All its users are signed out and locked out until reactivated." : ""}`))
      return;
    setBusy(t.id);
    setError(null);
    try {
      await api.patch(`/api/v1/admin/tenants/${t.id}`, { status });
      await load(q);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update the workspace.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Accounts">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <AdmCard className="mb-3.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(q);
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by workspace name…"
            className="flex-1 rounded-control border border-adm-line bg-adm-bg px-3 py-2 text-sm2 text-adm-ink outline-none placeholder:text-adm-subtle focus:border-gmb-brand"
          />
          <button
            type="submit"
            className="rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white hover:bg-gmb-brand-hover"
          >
            Search
          </button>
        </form>
      </AdmCard>

      {rows === null ? (
        <AdmCard>
          <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
        </AdmCard>
      ) : rows.length === 0 ? (
        <AdmCard>
          <div className="py-8 text-center text-sm2 text-adm-muted">No workspaces match.</div>
        </AdmCard>
      ) : (
        <AdmCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-adm-line">
                {["Workspace", "Status", "Users", "Locations", "Reviews", "Credits", "Created", ""].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-adm-subtle"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-adm-line/60 last:border-0 hover:bg-adm-panel-hover">
                  <td className="px-4 py-3">
                    <div className="text-[13px] font-semibold text-adm-ink">{t.name}</div>
                    <div className="font-geist-mono text-micro text-adm-subtle">
                      {t.slug}
                      {t.industry ? ` · ${t.industry}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <AdmPill tone={STATUS_TONE[t.status]}>{t.status}</AdmPill>
                  </td>
                  {[t.users, t.locations, t.reviews, t.credits].map((n, i) => (
                    <td key={i} className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">
                      {n.toLocaleString()}
                    </td>
                  ))}
                  <td className="px-4 py-3 font-geist-mono text-micro text-adm-subtle">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {t.status === "ACTIVE" ? (
                      <button
                        type="button"
                        disabled={busy === t.id}
                        onClick={() => void setStatus(t, "SUSPENDED")}
                        className="rounded-control border border-adm-line px-3 py-1.5 text-xs2 font-medium text-[#ff8f85] hover:bg-gmb-danger/10 disabled:opacity-50"
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === t.id}
                        onClick={() => void setStatus(t, "ACTIVE")}
                        className="rounded-control border border-adm-line px-3 py-1.5 text-xs2 font-medium text-adm-ok hover:bg-adm-ok/10 disabled:opacity-50"
                      >
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdmCard>
      )}

      <div className="mt-3 flex items-center gap-2">
        <AdmLabel>Note</AdmLabel>
        <span className="text-xs2 text-adm-muted">
          Suspending signs out every user in the workspace and blocks sign-in until reactivated.
        </span>
      </div>
    </AdminShell>
  );
}
