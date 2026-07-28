"use client";

import { useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";
import { downloadAuthed } from "../../../src/lib/download";

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
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    api
      .get<Payment[]>("/api/v1/admin/payments")
      .then((r) => setRows(r ?? []))
      .catch((e) => {
        setError(e instanceof ApiClientError ? e.message : "Could not load payments.");
        setRows([]);
      });

  useEffect(() => {
    void load();
  }, []);

  async function refund(p: Payment) {
    if (
      !window.confirm(
        `Refund ${p.credits} credits to ${p.tenantName}? This reverses the credits in the ledger and marks the payment refunded. Issue the actual money-back in your ${p.provider} dashboard.`,
      )
    )
      return;
    setBusy(p.id);
    setError(null);
    try {
      await api.post(`/api/v1/admin/payments/${p.id}/refund`);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not refund the payment.");
    } finally {
      setBusy(null);
    }
  }

  const captured = (rows ?? []).filter((r) => r.status === "CAPTURED");
  const creditsSold = captured.reduce((s, r) => s + r.credits, 0);

  return (
    <AdminShell title="Payments">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      {(rows?.length ?? 0) > 0 && (
        <div className="mb-3.5 flex">
          <button
            type="button"
            onClick={() =>
              void downloadAuthed("/api/v1/admin/payments/export", "payments.csv").catch(() =>
                setError("Could not export payments."),
              )
            }
            className="ml-auto rounded-control border border-adm-line px-3 py-1.5 text-xs2 font-medium text-adm-muted hover:bg-adm-panel-hover"
          >
            Export CSV
          </button>
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
                {["When", "Workspace", "Gateway", "Credits", "Amount", "Status", "Payment id", ""].map((h) => (
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
                  <td className="px-4 py-3 text-right">
                    {p.status === "CAPTURED" && (
                      <button
                        type="button"
                        disabled={busy === p.id}
                        onClick={() => void refund(p)}
                        className="rounded-control border border-adm-line px-2.5 py-1 text-xs2 font-medium text-[#ff8f85] hover:bg-gmb-danger/10 disabled:opacity-50"
                      >
                        {busy === p.id ? "…" : "Refund"}
                      </button>
                    )}
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
