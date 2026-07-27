"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PartnerShell, PtnCard } from "../../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../../src/lib/api";

// Finalised partner invoice — the frozen snapshot for one closed month.
// Printable via the browser's own print dialog.

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
}
interface Invoice {
  id: string;
  number: string;
  issuedAt: string;
  statement: Statement;
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

export default function PartnerInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    void api
      .get<Invoice>(`/api/v1/partner/invoices/${id}`)
      .then(setInv)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Could not load invoice."))
      .finally(() => setLoading(false));
  }, [id]);

  const s = inv?.statement;

  return (
    <PartnerShell title="Invoice">
      <div className="mb-3.5 flex items-center gap-2 print:hidden">
        <Link
          href="/partner/invoices"
          className="rounded-control border border-ptn-line px-3 py-1.5 text-xs2 font-medium text-ptn-muted no-underline hover:bg-ptn-panel-hover hover:no-underline"
        >
          ← All invoices
        </Link>
        {inv && (
          <button
            type="button"
            onClick={() => window.print()}
            className="ml-auto rounded-control bg-ptn-accent px-3 py-1.5 text-xs2 font-semibold text-ptn-bg hover:bg-ptn-accent-hover"
          >
            Print
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
          {error}
        </div>
      )}

      {loading ? (
        <PtnCard>
          <div className="py-8 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div>
        </PtnCard>
      ) : inv && s ? (
        <PtnCard className="mx-auto max-w-[720px] p-8">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-bold tracking-[-0.01em]">Adgrowly</div>
              <div className="text-xs2 text-ptn-muted">Partner statement</div>
            </div>
            <div className="text-right">
              <div className="font-geist-mono text-sm2 font-semibold text-ptn-ink">{inv.number}</div>
              <div className="mt-1 text-micro text-ptn-subtle">{s.period.label}</div>
              <div className="mt-1 text-micro text-ptn-subtle">
                Issued {new Date(inv.issuedAt).toLocaleDateString()}
              </div>
            </div>
          </div>

          <div className="my-6 border-t border-ptn-line" />

          <div className="mb-4 grid grid-cols-3 gap-3 text-center">
            {(
              [
                ["Wholesale due", byCurrency(s.totals.wholesaleDueByCurrency)],
                ["Collected", byCurrency(s.totals.collectedByCurrency)],
                ["Margin", byCurrency(s.totals.marginByCurrency)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-ptn-subtle">
                  {label}
                </div>
                <div className="mt-1 font-geist-mono text-sm2 font-semibold text-ptn-ink">{value}</div>
              </div>
            ))}
          </div>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ptn-line">
                {["Customer", "Plan", "Wholesale", "Collected", "Margin"].map((h, i) => (
                  <th
                    key={h}
                    className={`py-2 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-ptn-subtle ${
                      i > 1 ? "text-right" : ""
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => {
                const margin = l.collectedThisMonthMinor - l.wholesaleMinor;
                return (
                  <tr key={l.customerId} className="border-b border-ptn-line/60">
                    <td className="py-2.5 text-xs2 text-ptn-ink">{l.customerName}</td>
                    <td className="py-2.5 text-xs2 text-ptn-muted">{l.planName ?? "—"}</td>
                    <td className="py-2.5 text-right font-geist-mono text-xs2 text-ptn-muted">
                      {money(l.wholesaleMinor, l.currency)}
                    </td>
                    <td className="py-2.5 text-right font-geist-mono text-xs2 text-ptn-ink">
                      {money(l.collectedThisMonthMinor, l.currency)}
                    </td>
                    <td className="py-2.5 text-right font-geist-mono text-xs2 text-ptn-muted">
                      {margin >= 0 ? "+" : "−"}
                      {money(Math.abs(margin), l.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="my-6 border-t border-ptn-line" />
          <div className="font-geist-mono text-micro text-ptn-subtle">
            Finalised snapshot · {s.totals.activeCustomers} active customer
            {s.totals.activeCustomers === 1 ? "" : "s"}
          </div>
        </PtnCard>
      ) : null}
    </PartnerShell>
  );
}
