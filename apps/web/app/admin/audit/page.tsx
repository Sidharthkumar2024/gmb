"use client";

import { useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Audit log — every admin/sensitive mutation on the platform, newest first.
// Read-only by design: audit rows are never editable or deletable from the UI.

interface AuditRow {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  userEmail: string | null;
  tenantName: string | null;
  ipAddress: string | null;
  createdAt: string;
}

function actionTone(action: string): "ok" | "warn" | "danger" | "neutral" {
  const a = action.toLowerCase();
  if (a.includes("delete") || a.includes("suspend") || a.includes("deactivate")) return "danger";
  if (a.includes("update") || a.includes("change")) return "warn";
  if (a.includes("create") || a.includes("activate")) return "ok";
  return "neutral";
}

export default function AdminAuditPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<AuditRow[]>("/api/v1/admin/audit")
      .then((r) => setRows(r ?? []))
      .catch((e) => {
        setError(e instanceof ApiClientError ? e.message : "Could not load the audit log.");
        setRows([]);
      });
  }, []);

  return (
    <AdminShell title="Audit log">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="mb-3.5 flex items-center gap-2">
        <AdmLabel>Scope</AdmLabel>
        <span className="text-xs2 text-adm-muted">
          Most recent 200 entries across all workspaces. Entries are written by the API and cannot
          be edited here.
        </span>
      </div>

      {rows === null ? (
        <AdmCard>
          <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
        </AdmCard>
      ) : rows.length === 0 ? (
        <AdmCard>
          <div className="py-8 text-center text-sm2 text-adm-muted">No audit entries yet.</div>
        </AdmCard>
      ) : (
        <AdmCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-adm-line">
                {["When", "Action", "Resource", "Actor", "Workspace", "IP"].map((h) => (
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
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-adm-line/60 last:border-0 hover:bg-adm-panel-hover">
                  <td className="whitespace-nowrap px-4 py-3 font-geist-mono text-micro text-adm-subtle">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <AdmPill tone={actionTone(r.action)}>{r.action}</AdmPill>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs2 text-adm-ink">{r.resource}</div>
                    {r.resourceId && (
                      <div className="font-geist-mono text-micro text-adm-subtle">{r.resourceId}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs2 text-adm-muted">{r.userEmail ?? "system"}</td>
                  <td className="px-4 py-3 text-xs2 text-adm-muted">{r.tenantName ?? "—"}</td>
                  <td className="px-4 py-3 font-geist-mono text-micro text-adm-subtle">
                    {r.ipAddress ?? "—"}
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
