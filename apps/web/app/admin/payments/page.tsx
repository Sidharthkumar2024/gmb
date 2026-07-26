"use client";

import { useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Payments — captured gateway payments across all workspaces. Each row is a real
// Payment record written by the top-up webhook, not scraped from the ledger.

interface Payment {
  id: string;
  tenantName: string;
  provider: "RAZORPAY" | "STRIPE";
  providerPaymentId: string;
  credits: number;
  amountMinor: number;
  currency: string;
  status: "CAPTURED" | "REFUNDED";
  createdAt: string;
}

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export default function AdminPaymentsPage() {
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<Payment[]>("/api/v1/admin/payments")
      .then((r) => setRows(r ?? []))
      .catch((e) => {
        setError(e instanceof ApiClientError ? e.message : "Could not load payments.");
        setRows([]);
      });
  }, []);

  const captured = (rows ?? []).filter((r) => r.status === "CAPTURED");
  const creditsSold = captured.reduce((s, r) => s + r.credits, 0);

  return (
    <AdminShell title="Payments">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="mb-3.5 grid grid-cols-3 gap-3.5">
        {(
          [
            ["Payments", rows?.length, "captured top-ups"],
            ["Credits sold", rows ? creditsSold : null, "across all workspaces"],
            ["Workspaces paying", rows ? new Set(captured.map((r) => r.tenantName)).size : null, "with a payment"],
          ] as const
        ).map(([label, value, caption]) => (
          <AdmCard key={label}>
            <AdmLabel>{label}</AdmLabel>
            <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
              {typeof value === "number" ? value.toLocaleString() : "—"}
            </div>
            <div className="mt-1 text-xs2 text-adm-muted">{caption}</div>
          </AdmCard>
        ))}
      </div>

      {rows === null ? (
        <AdmCard>
          <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
        </AdmCard>
      ) : rows.length === 0 ? (
        <AdmCard>
          <div className="py-8 text-center text-sm2 text-adm-muted">
            No payments yet. Captured gateway top-ups appear here.
          </div>
        </AdmCard>
      ) : (
        <AdmCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-adm-line">
                {["When", "Workspace", "Gateway", "Credits", "Amount", "Status", "Payment id"].map((h) => (
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
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-adm-line/60 last:border-0 hover:bg-adm-panel-hover">
                  <td className="whitespace-nowrap px-4 py-3 font-geist-mono text-micro text-adm-subtle">
                    {new Date(p.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs2 text-adm-muted">{p.tenantName}</td>
                  <td className="px-4 py-3 text-xs2 text-adm-muted">{p.provider}</td>
                  <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-ok">
                    +{p.credits.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">
                    {money(p.amountMinor, p.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <AdmPill tone={p.status === "CAPTURED" ? "ok" : "neutral"}>{p.status}</AdmPill>
                  </td>
                  <td className="px-4 py-3 font-geist-mono text-micro text-adm-subtle">
                    {p.providerPaymentId}
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
