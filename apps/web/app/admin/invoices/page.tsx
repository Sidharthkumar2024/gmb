"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Invoices — one per captured payment, derived (see invoice.service). Each row
// links to a printable detail view. Read-only; the source of truth is Payment.

interface InvoiceRow {
  id: string;
  number: string;
  status: "PAID" | "REFUNDED";
  issuedAt: string;
  currency: string;
  buyer: { tenantId: string; name: string };
  totalMinor: number;
}

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export default function AdminInvoicesPage() {
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<InvoiceRow[]>("/api/v1/admin/invoices")
      .then((r) => setRows(r ?? []))
      .catch((e) => {
        setError(e instanceof ApiClientError ? e.message : "Could not load invoices.");
        setRows([]);
      });
  }, []);

  const paid = (rows ?? []).filter((r) => r.status === "PAID");
  const billed = paid.reduce((s, r) => s + r.totalMinor, 0);
  const billedCurrency = paid[0]?.currency ?? "INR";

  return (
    <AdminShell title="Invoices">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="mb-3.5 grid grid-cols-3 gap-3.5">
        {(
          [
            ["Invoices", rows?.length, "one per payment"],
            ["Paid", rows ? paid.length : null, "captured"],
            ["Billed", rows ? money(billed, billedCurrency) : null, "sum of paid invoices"],
          ] as const
        ).map(([label, value, caption]) => (
          <AdmCard key={label}>
            <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-adm-subtle">
              {label}
            </div>
            <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
              {value === null || value === undefined
                ? "—"
                : typeof value === "number"
                  ? value.toLocaleString()
                  : value}
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
            No invoices yet. One is generated for each captured payment.
          </div>
        </AdmCard>
      ) : (
        <AdmCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-adm-line">
                {["Invoice", "Issued", "Workspace", "Total", "Status", ""].map((h) => (
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
                  <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-ink">{r.number}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-geist-mono text-micro text-adm-subtle">
                    {new Date(r.issuedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-xs2 text-adm-muted">{r.buyer.name}</td>
                  <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">
                    {money(r.totalMinor, r.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <AdmPill tone={r.status === "PAID" ? "ok" : "neutral"}>{r.status}</AdmPill>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/invoices/${r.id}`}
                      className="rounded-control border border-adm-line px-2.5 py-1 text-xs2 font-medium text-adm-muted no-underline hover:bg-adm-panel-hover hover:no-underline"
                    >
                      View
                    </Link>
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
