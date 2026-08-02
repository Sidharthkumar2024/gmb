"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";
import { downloadAuthed } from "../../../src/lib/download";

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
interface PageResult<T> { items: T[]; pagination: { page: number; pageSize: number; total: number; pages: number } }

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
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"" | "CAPTURED" | "REFUNDED">("");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (status) qs.set("status", status);
    if (search.trim()) qs.set("search", search.trim());
    return api.get<PageResult<InvoiceRow>>(`/api/v1/admin/invoices?${qs.toString()}`)
      .then((result) => {
        setRows(result?.items ?? []);
        setPages(result?.pagination.pages ?? 1);
        setTotal(result?.pagination.total ?? 0);
      })
      .catch((e) => {
        setError(e instanceof ApiClientError ? e.message : "Could not load invoices.");
        setRows([]);
      });
  }, [page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const paid = (rows ?? []).filter((r) => r.status === "PAID");
  // Sum PER CURRENCY — never add paise (INR) and cents (USD) into one number.
  const billedByCurrency: Record<string, number> = {};
  for (const r of paid) billedByCurrency[r.currency] = (billedByCurrency[r.currency] ?? 0) + r.totalMinor;
  const billedLabel =
    Object.keys(billedByCurrency).length === 0
      ? "—"
      : Object.entries(billedByCurrency)
          .map(([c, m]) => money(m, c))
          .join(" · ");

  return (
    <AdminShell title="Invoices">
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
              void downloadAuthed("/api/v1/admin/invoices/export", "invoices.csv").catch(() =>
                setError("Could not export invoices."),
              )
            }
            className="ml-auto rounded-control border border-adm-line px-3 py-1.5 text-xs2 font-medium text-adm-muted hover:bg-adm-panel-hover"
          >
            Export CSV
          </button>
        </div>
      )}

      <div className="mb-3 flex gap-2">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Workspace or payment id" className="rounded-control border border-adm-line bg-adm-panel px-3 py-2 text-xs2 text-adm-ink outline-none" />
        <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} className="rounded-control border border-adm-line bg-adm-panel px-3 py-2 text-xs2 text-adm-ink">
          <option value="">All statuses</option><option value="CAPTURED">Paid</option><option value="REFUNDED">Refunded</option>
        </select>
      </div>

      <div className="mb-3.5 grid grid-cols-3 gap-3.5">
        {(
          [
            ["Invoices", rows ? total : null, "matching this view"],
            ["Paid", rows ? paid.length : null, "on this page"],
            ["Billed", rows ? billedLabel : null, "this page, per currency"],
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
                  <td className="flex justify-end gap-1.5 px-4 py-3 text-right">
                    <Link
                      href={`/admin/invoices/${r.id}`}
                      className="rounded-control border border-adm-line px-2.5 py-1 text-xs2 font-medium text-adm-muted no-underline hover:bg-adm-panel-hover hover:no-underline"
                    >
                      View
                    </Link>
                    <button
                      type="button"
                      onClick={() => void downloadAuthed(`/api/v1/admin/invoices/${r.id}/pdf`, `${r.number}.pdf`).catch(() => setError("Could not download invoice PDF."))}
                      className="rounded-control border border-adm-line px-2.5 py-1 text-xs2 font-medium text-adm-muted hover:bg-adm-panel-hover"
                    >
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdmCard>
      )}
      {rows && total > 0 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs2 text-adm-muted">
          <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-control border border-adm-line px-3 py-1.5 disabled:opacity-40">Previous</button>
          Page {page} of {pages}
          <button disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="rounded-control border border-adm-line px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      )}
    </AdminShell>
  );
}
