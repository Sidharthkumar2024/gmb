"use client";

import { useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Partner monthly statement. Adgrowly bills the partner wholesale for each active
// customer on a plan; the partner collects retail. Margin = collected − wholesale,
// per currency. Every figure is derived from real Tenant/Plan/Payment rows.

interface StatementLine {
  customerId: string;
  customerName: string;
  planName: string | null;
  wholesaleMinor: number;
  currency: string;
  collectedThisMonthMinor: number;
}
interface Statement {
  period: { year: number; month: number; label: string };
  lines: StatementLine[];
  totals: {
    activeCustomers: number;
    wholesaleDueByCurrency: Record<string, number>;
    collectedByCurrency: Record<string, number>;
    marginByCurrency: Record<string, number>;
  };
  singleCurrency: string | null;
}

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

function byCurrency(map: Record<string, number>): string {
  const e = Object.entries(map);
  return e.length === 0 ? "—" : e.map(([c, m]) => money(m, c)).join(" · ");
}

export default function PartnerInvoicesPage() {
  const [stmt, setStmt] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<Statement>("/api/v1/partner/statement")
      .then(setStmt)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Could not load statement."));
  }, []);

  const marginTone = (v: number) => (v > 0 ? "text-ptn-accent" : v < 0 ? "text-ptn-danger" : "text-ptn-subtle");

  return (
    <PartnerShell title="Invoices">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
          {error}
        </div>
      )}

      <div className="mb-3.5 flex items-center gap-2">
        <PtnPill tone="neutral">{stmt ? stmt.period.label : "…"}</PtnPill>
        <span className="text-xs2 text-ptn-muted">
          What Adgrowly bills you this month, and what you collected from customers.
        </span>
      </div>

      <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-4">
        {(
          [
            ["Active customers", stmt ? stmt.totals.activeCustomers.toLocaleString() : null, "on a plan or trial"],
            ["Wholesale due", stmt ? byCurrency(stmt.totals.wholesaleDueByCurrency) : null, "billed to you"],
            ["Collected", stmt ? byCurrency(stmt.totals.collectedByCurrency) : null, "from customers this month"],
            ["Est. margin", stmt ? byCurrency(stmt.totals.marginByCurrency) : null, "collected − wholesale"],
          ] as const
        ).map(([label, value, caption]) => (
          <PtnCard key={label}>
            <PtnLabel>{label}</PtnLabel>
            <div className="mt-1.5 text-[22px] font-bold tracking-[-0.02em]">{value ?? "—"}</div>
            <div className="mt-1 text-xs2 text-ptn-muted">{caption}</div>
          </PtnCard>
        ))}
      </div>

      {stmt === null ? (
        <PtnCard>
          <div className="py-8 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div>
        </PtnCard>
      ) : stmt.lines.length === 0 ? (
        <PtnCard>
          <div className="py-8 text-center text-sm2 text-ptn-muted">
            No active customers yet. Your monthly statement appears once you have customers on a plan.
          </div>
        </PtnCard>
      ) : (
        <PtnCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ptn-line">
                {["Customer", "Plan", "Wholesale (billed to you)", "Collected this month", "Margin"].map((h) => (
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
              {stmt.lines.map((l) => {
                const margin = l.collectedThisMonthMinor - l.wholesaleMinor;
                return (
                  <tr key={l.customerId} className="border-b border-ptn-line/60 last:border-0 hover:bg-ptn-panel-hover">
                    <td className="px-4 py-3 text-xs2 font-semibold text-ptn-ink">{l.customerName}</td>
                    <td className="px-4 py-3 text-xs2 text-ptn-muted">
                      {l.planName ?? <span className="text-ptn-subtle">No plan</span>}
                    </td>
                    <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-muted">
                      {money(l.wholesaleMinor, l.currency)}
                    </td>
                    <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-ink">
                      {money(l.collectedThisMonthMinor, l.currency)}
                    </td>
                    <td className={`px-4 py-3 font-geist-mono text-xs2 font-semibold ${marginTone(margin)}`}>
                      {margin >= 0 ? "+" : "−"}
                      {money(Math.abs(margin), l.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PtnCard>
      )}

      <p className="mt-3 text-micro text-ptn-subtle">
        Figures are the live month-to-date derivation. A finalised, downloadable invoice is issued at
        month close.
      </p>
    </PartnerShell>
  );
}
