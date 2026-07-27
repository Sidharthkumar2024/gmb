"use client";

import { useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Partner transactions — payments made by the partner's own customers (its child
// tenants). Read-only. Every figure is a real Payment row; nothing is estimated.

interface PartnerPayment {
  id: string;
  customerName: string;
  provider: "RAZORPAY" | "STRIPE";
  providerPaymentId: string;
  credits: number;
  amountMinor: number;
  currency: string;
  status: "CAPTURED" | "REFUNDED";
  createdAt: string;
}
interface Transactions {
  totals: {
    payments: number;
    creditsSold: number;
    collectedByCurrency: Record<string, number>;
  };
  payments: PartnerPayment[];
}

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export default function PartnerTransactionsPage() {
  const [data, setData] = useState<Transactions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<Transactions>("/api/v1/partner/transactions")
      .then((d) => setData(d ?? { totals: { payments: 0, creditsSold: 0, collectedByCurrency: {} }, payments: [] }))
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Could not load transactions."));
  }, []);

  const collected = data ? Object.entries(data.totals.collectedByCurrency) : [];
  const collectedLabel =
    collected.length === 0 ? "—" : collected.map(([cur, m]) => money(m, cur)).join(" · ");

  return (
    <PartnerShell title="Transactions">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
          {error}
        </div>
      )}

      <div className="mb-3.5 grid grid-cols-3 gap-3.5">
        {(
          [
            ["Payments", data ? data.totals.payments.toLocaleString() : null, "from your customers"],
            ["Collected", data ? collectedLabel : null, "captured, per currency"],
            ["Credits sold", data ? data.totals.creditsSold.toLocaleString() : null, "across customers"],
          ] as const
        ).map(([label, value, caption]) => (
          <PtnCard key={label}>
            <PtnLabel>{label}</PtnLabel>
            <div className="mt-1.5 text-[26px] font-bold tracking-[-0.02em]">{value ?? "—"}</div>
            <div className="mt-1 text-xs2 text-ptn-muted">{caption}</div>
          </PtnCard>
        ))}
      </div>

      {data === null ? (
        <PtnCard>
          <div className="py-8 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div>
        </PtnCard>
      ) : data.payments.length === 0 ? (
        <PtnCard>
          <div className="py-8 text-center text-sm2 text-ptn-muted">
            No customer payments yet. Top-ups your customers make will appear here.
          </div>
        </PtnCard>
      ) : (
        <PtnCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ptn-line">
                {["When", "Customer", "Gateway", "Credits", "Amount", "Status", "Payment id"].map((h) => (
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
              {data.payments.map((p) => (
                <tr key={p.id} className="border-b border-ptn-line/60 last:border-0 hover:bg-ptn-panel-hover">
                  <td className="whitespace-nowrap px-4 py-3 font-geist-mono text-micro text-ptn-subtle">
                    {new Date(p.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs2 text-ptn-ink">{p.customerName}</td>
                  <td className="px-4 py-3 text-xs2 text-ptn-muted">{p.provider}</td>
                  <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-accent">
                    +{p.credits.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-muted">
                    {money(p.amountMinor, p.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <PtnPill tone={p.status === "CAPTURED" ? "ok" : "neutral"}>{p.status}</PtnPill>
                  </td>
                  <td className="px-4 py-3 font-geist-mono text-micro text-ptn-subtle">
                    {p.providerPaymentId}
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
