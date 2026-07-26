"use client";

// Google — which of the partner's customers have linked their Google Business
// Profile. Status-only: a customer connects Google inside their own workspace
// (the OAuth belongs to them), so this is a read-only rollup, not a place to
// connect on their behalf. The platform OAuth client itself is admin-owned and
// not shown here.

import { useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface CustomerGoogle {
  tenantId: string;
  name: string;
  connected: boolean;
  accountName: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  locations: number;
}

export default function PartnerGooglePage() {
  const [rows, setRows] = useState<CustomerGoogle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<CustomerGoogle[]>("/api/v1/partner/google")
      .then((r) => setRows(r ?? []))
      .catch((e) => {
        setError(e instanceof ApiClientError ? e.message : "Could not load Google status.");
        setRows([]);
      });
  }, []);

  const connected = (rows ?? []).filter((r) => r.connected).length;

  return (
    <PartnerShell title="Google">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
          {error}
        </div>
      )}

      <div className="mb-3.5 grid grid-cols-3 gap-3.5">
        {(
          [
            ["Connected", rows ? connected : null, "linked to Google"],
            ["Not connected", rows ? rows.length - connected : null, "need to link"],
            ["Customers", rows?.length ?? null, "total"],
          ] as const
        ).map(([label, value, caption]) => (
          <PtnCard key={label}>
            <PtnLabel>{label}</PtnLabel>
            <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
              {typeof value === "number" ? value.toLocaleString() : "—"}
            </div>
            <div className="mt-1 text-xs2 text-ptn-muted">{caption}</div>
          </PtnCard>
        ))}
      </div>

      <div className="mb-3.5 flex items-center gap-2">
        <PtnLabel>How connecting works</PtnLabel>
        <span className="text-xs2 text-ptn-muted">
          Each customer links Google from inside their own workspace — the OAuth grant belongs to
          them. This is a read-only view of who has, and who hasn&rsquo;t yet.
        </span>
      </div>

      {rows === null ? (
        <PtnCard>
          <div className="py-8 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div>
        </PtnCard>
      ) : rows.length === 0 ? (
        <PtnCard>
          <div className="py-8 text-center text-sm2 text-ptn-muted">
            No customers yet. Once you onboard workspaces their Google status appears here.
          </div>
        </PtnCard>
      ) : (
        <PtnCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ptn-line">
                {["Customer", "Google", "Account", "Locations", "Last sync"].map((h) => (
                  <th key={h} className="px-4 py-3 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-ptn-subtle">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenantId} className="border-b border-ptn-line/60 last:border-0 hover:bg-ptn-panel-hover">
                  <td className="px-4 py-3 text-[13px] font-semibold text-ptn-ink">{r.name}</td>
                  <td className="px-4 py-3">
                    <PtnPill tone={r.connected ? "ok" : "warn"}>
                      {r.connected ? "Connected" : "Not connected"}
                    </PtnPill>
                  </td>
                  <td className="px-4 py-3 text-xs2 text-ptn-muted">
                    {r.accountName ?? (r.connected ? "—" : "not linked")}
                  </td>
                  <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-muted">{r.locations}</td>
                  <td className="px-4 py-3 font-geist-mono text-micro text-ptn-subtle">
                    {r.lastSyncedAt ? new Date(r.lastSyncedAt).toLocaleString() : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PtnCard>
      )}
    </PartnerShell>
  );
}
