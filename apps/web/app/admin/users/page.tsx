"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Users — every account on the platform, across all workspaces.
// Deactivating revokes the user's refresh tokens server-side; the API refuses
// to let an admin deactivate themselves.

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  tenantName: string;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLE_TONE: Record<string, "brand" | "neutral" | "ok"> = {
  SUPER_ADMIN: "brand",
  BUSINESS_ADMIN: "ok",
  AGENT: "neutral",
  WHITE_LABEL_ADMIN: "neutral",
};

export default function AdminUsersPage() {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    setError(null);
    try {
      const qs = query ? `?q=${encodeURIComponent(query)}` : "";
      setRows((await api.get<UserRow[]>(`/api/v1/admin/users${qs}`)) ?? []);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load users.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  async function toggleActive(u: UserRow) {
    const verb = u.isActive ? "Deactivate" : "Reactivate";
    if (!window.confirm(`${verb} ${u.email}?`)) return;
    setBusy(u.id);
    setError(null);
    try {
      await api.patch(`/api/v1/admin/users/${u.id}`, { isActive: !u.isActive });
      await load(q);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update the user.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Users">
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
            placeholder="Search by email…"
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
          <div className="py-8 text-center text-sm2 text-adm-muted">No users match.</div>
        </AdmCard>
      ) : (
        <AdmCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-adm-line">
                {["User", "Workspace", "Role", "Status", "Last login", ""].map((h) => (
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
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-adm-line/60 last:border-0 hover:bg-adm-panel-hover">
                  <td className="px-4 py-3">
                    <div className="text-[13px] font-semibold text-adm-ink">{u.name || u.email}</div>
                    <div className="font-geist-mono text-micro text-adm-subtle">
                      {u.email}
                      {!u.emailVerified && " · unverified"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs2 text-adm-muted">{u.tenantName}</td>
                  <td className="px-4 py-3">
                    <AdmPill tone={ROLE_TONE[u.role] ?? "neutral"}>{u.role}</AdmPill>
                  </td>
                  <td className="px-4 py-3">
                    <AdmPill tone={u.isActive ? "ok" : "danger"}>
                      {u.isActive ? "Active" : "Deactivated"}
                    </AdmPill>
                  </td>
                  <td className="px-4 py-3 font-geist-mono text-micro text-adm-subtle">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "never"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={busy === u.id}
                      onClick={() => void toggleActive(u)}
                      className={`rounded-control border border-adm-line px-3 py-1.5 text-xs2 font-medium disabled:opacity-50 ${
                        u.isActive
                          ? "text-[#ff8f85] hover:bg-gmb-danger/10"
                          : "text-adm-ok hover:bg-adm-ok/10"
                      }`}
                    >
                      {u.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdmCard>
      )}
    </AdminShell>
  );
}
