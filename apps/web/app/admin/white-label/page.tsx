"use client";

import { useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface PartnerRow {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  customerCount: number;
  users: number;
  locations: number;
  credits: number;
  planName: string | null;
  createdAt: string;
}
const STATUS_TONE = { ACTIVE: "ok", SUSPENDED: "warn", DELETED: "danger" } as const;

export default function AdminWhiteLabelPage() {
  const [rows, setRows] = useState<PartnerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<{ items: PartnerRow[] }>("/api/v1/admin/tenants?type=WHITE_LABEL")
      .then((data) => setRows(data.items ?? []))
      .catch((reason) => {
        setRows([]);
        setError(reason instanceof ApiClientError ? reason.message : "Could not load partners.");
      });
  }, []);

  const partners = rows?.length ?? 0;
  const customers = (rows ?? []).reduce((sum, row) => sum + row.customerCount, 0);
  const locations = (rows ?? []).reduce((sum, row) => sum + row.locations, 0);
  const credits = (rows ?? []).reduce((sum, row) => sum + row.credits, 0);

  return (
    <AdminShell title="White-label partners">
      {error ? <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">{error}</div> : null}

      <div className="mb-3.5 grid grid-cols-4 gap-3.5">
        {[
          ["Partners", partners, "reseller workspaces"],
          ["White-label clients", customers, "child workspaces"],
          ["Managed locations", locations, "across partner clients"],
          ["AI credits", credits, "current partner balances"],
        ].map(([label, value, hint]) => (
          <AdmCard key={label}>
            <AdmLabel>{label}</AdmLabel>
            <div className="mt-1.5 text-[26px] font-bold tracking-[-0.02em] text-adm-ink">
              {rows === null ? "—" : Number(value).toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs2 text-adm-muted">{hint}</div>
          </AdmCard>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <span className="text-[13px] text-adm-muted">White-label partners reselling GMB Suite under their own brand</span>
      </div>
      <AdmCard className="overflow-x-auto p-0">
        {rows === null ? (
          <div className="py-10 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm2 text-adm-muted">No white-label partners yet.</div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead><tr className="border-b border-adm-line bg-adm-panel-hover">
              {["Partner", "Plan", "Clients", "Locations", "AI credits", "Status", "Created"].map((heading) => <th key={heading} className="px-4 py-3 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-adm-subtle">{heading}</th>)}
            </tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id} className="border-b border-adm-line/60 last:border-0 hover:bg-adm-panel-hover">
                <td className="px-4 py-3"><div className="text-[13px] font-semibold text-adm-ink">{row.name}</div><div className="font-geist-mono text-micro text-adm-subtle">{row.slug}</div></td>
                <td className="px-4 py-3 text-xs2 text-adm-muted">{row.planName ?? "No plan"}</td>
                <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">{row.customerCount}</td>
                <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">{row.locations}</td>
                <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">{row.credits.toLocaleString()}</td>
                <td className="px-4 py-3"><AdmPill tone={STATUS_TONE[row.status]}>{row.status}</AdmPill></td>
                <td className="px-4 py-3 font-geist-mono text-micro text-adm-subtle">{new Date(row.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </AdmCard>
    </AdminShell>
  );
}
