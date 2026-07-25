"use client";

import { useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../src/lib/api";

// Partner dashboard — the reseller's customers, from real records. Revenue and
// commission are deliberately omitted (no payment ledger exists), so this shows
// what is true: customer count, locations, plans, status. A note stands in for
// the billing widgets until payments are wired, rather than faking numbers.

interface Customer {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  planName: string | null;
  locations: number;
  users: number;
  createdAt: string;
}
interface Overview {
  totals: { customers: number; active: number; locations: number };
  customers: Customer[];
}

const STATUS_TONE = { ACTIVE: "ok", SUSPENDED: "warn", DELETED: "danger" } as const;

export default function PartnerDashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<Overview>("/api/v1/partner/overview")
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Could not load your customers."));
  }, []);

  return (
    <PartnerShell title="Dashboard">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3.5">
        {(
          [
            ["Customers", data?.totals.customers, "workspaces you manage"],
            ["Active", data?.totals.active, "not suspended"],
            ["Locations", data?.totals.locations, "across all customers"],
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

      <div className="mt-3.5 rounded-card border border-ptn-line bg-ptn-panel-hover px-4 py-3">
        <div className="flex items-center gap-2">
          <PtnLabel>Billing & commission</PtnLabel>
          <span className="text-xs2 text-ptn-muted">
            Revenue, margin and payouts appear here once platform payments are enabled — nothing is
            estimated in the meantime.
          </span>
        </div>
      </div>

      <div className="mt-3.5">
        <div className="mb-2 flex items-center gap-2">
          <PtnLabel>Customers</PtnLabel>
        </div>
        {data === null ? (
          <PtnCard>
            <div className="py-8 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div>
          </PtnCard>
        ) : data.customers.length === 0 ? (
          <PtnCard>
            <div className="py-8 text-center text-sm2 text-ptn-muted">
              No customers yet. Once you onboard workspaces under your agency they appear here.
            </div>
          </PtnCard>
        ) : (
          <PtnCard className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-ptn-line">
                  {["Business", "Plan", "Locations", "Users", "Status", "Since"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-ptn-subtle"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.customers.map((c) => (
                  <tr key={c.id} className="border-b border-ptn-line/60 last:border-0 hover:bg-ptn-panel-hover">
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-semibold text-ptn-ink">{c.name}</div>
                      <div className="font-geist-mono text-micro text-ptn-subtle">{c.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-xs2 text-ptn-muted">{c.planName ?? "No plan"}</td>
                    <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-muted">{c.locations}</td>
                    <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-muted">{c.users}</td>
                    <td className="px-4 py-3">
                      <PtnPill tone={STATUS_TONE[c.status]}>{c.status}</PtnPill>
                    </td>
                    <td className="px-4 py-3 font-geist-mono text-micro text-ptn-subtle">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PtnCard>
        )}
      </div>
    </PartnerShell>
  );
}
