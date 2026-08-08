"use client";

import { useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnPill } from "../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface AuditRow { id: string; action: string; resource: string; resourceId: string | null; userName: string | null; userEmail: string; tenantName: string; ipAddress: string | null; createdAt: string; }
interface AuditPage { items: AuditRow[]; total: number; page: number; pageSize: number; }

export default function PartnerAuditPage() {
  const [data, setData] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api.get<AuditPage>("/api/v1/partner/audit").then(setData).catch((reason) => setError(reason instanceof ApiClientError ? reason.message : "Could not load audit logs.")); }, []);
  return (
    <PartnerShell title="Audit logs">
      {error ? <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">{error}</div> : null}
      <div className="mb-3.5 text-[13px] text-ptn-muted">Security and configuration activity for your partner workspace and child customers.</div>
      <PtnCard className="overflow-x-auto p-0">
        {data === null ? <div className="py-10 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div> : data.items.length === 0 ? <div className="py-10 text-center text-sm2 text-ptn-muted">No audited actions yet.</div> : (
          <table className="w-full border-collapse text-left"><thead><tr className="border-b border-ptn-line bg-ptn-panel-hover">{["Time", "Action", "Resource", "Workspace", "Member", "IP"].map((heading) => <th key={heading} className="px-4 py-3 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-ptn-subtle">{heading}</th>)}</tr></thead>
          <tbody>{data.items.map((row) => <tr key={row.id} className="border-b border-ptn-line/60 last:border-0 hover:bg-ptn-panel-hover"><td className="whitespace-nowrap px-4 py-3 font-geist-mono text-micro text-ptn-subtle">{new Date(row.createdAt).toLocaleString()}</td><td className="px-4 py-3"><PtnPill tone={row.action.includes("DELETE") || row.action.includes("FAILED") ? "danger" : row.action.includes("CREATE") ? "ok" : "neutral"}>{row.action}</PtnPill></td><td className="px-4 py-3 text-xs2 text-ptn-ink">{row.resource}<div className="font-geist-mono text-micro text-ptn-subtle">{row.resourceId ?? "—"}</div></td><td className="px-4 py-3 text-xs2 text-ptn-muted">{row.tenantName}</td><td className="px-4 py-3 text-xs2 text-ptn-ink">{row.userName ?? row.userEmail}<div className="font-geist-mono text-micro text-ptn-subtle">{row.userEmail}</div></td><td className="px-4 py-3 font-geist-mono text-micro text-ptn-subtle">{row.ipAddress ?? "—"}</td></tr>)}</tbody></table>
        )}
      </PtnCard>
    </PartnerShell>
  );
}
