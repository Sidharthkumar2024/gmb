"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";
import { downloadAuthed } from "../../../src/lib/download";

// Transactions — the raw credit ledger across all workspaces. Every grant,
// spend, reservation and refund. Read-only; this is the reconcilable source of
// truth behind every wallet balance.

type TxnType = "RESERVE" | "SETTLE" | "RELEASE" | "GRANT" | "REFUND";

interface Txn {
  id: string;
  tenantName: string;
  type: TxnType;
  deltaCredits: number;
  balanceAfter: number;
  feature: string | null;
  reason: string | null;
  createdAt: string;
}
interface PageResult<T> { items: T[]; pagination: { page: number; pageSize: number; total: number; pages: number } }

const FILTERS: Array<"ALL" | TxnType> = ["ALL", "GRANT", "SETTLE", "RESERVE", "RELEASE", "REFUND"];
const TYPE_TONE: Record<TxnType, "ok" | "warn" | "neutral"> = {
  GRANT: "ok",
  REFUND: "ok",
  SETTLE: "neutral",
  RESERVE: "warn",
  RELEASE: "neutral",
};

export default function AdminTransactionsPage() {
  const [rows, setRows] = useState<Txn[] | null>(null);
  const [filter, setFilter] = useState<"ALL" | TxnType>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");

  const load = useCallback(async (f: "ALL" | TxnType) => {
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (f !== "ALL") qs.set("type", f);
      if (search.trim()) qs.set("search", search.trim());
      const result = await api.get<PageResult<Txn>>(`/api/v1/admin/transactions?${qs.toString()}`);
      setRows(result?.items ?? []);
      setPages(result?.pagination.pages ?? 1);
      setTotal(result?.pagination.total ?? 0);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load transactions.");
      setRows([]);
    }
  }, [page, search]);

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  return (
    <AdminShell title="Transactions">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="text-xs2 text-adm-muted">
          The credit ledger across all workspaces — the reconcilable source of truth for balances.
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => { setFilter(f); setPage(1); }}
              className={`rounded-full px-3 py-1 text-xs2 font-semibold transition ${
                filter === f
                  ? "bg-gmb-brand text-white"
                  : "border border-adm-line bg-adm-panel text-adm-muted hover:bg-adm-panel-hover"
              }`}
            >
              {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              void downloadAuthed("/api/v1/admin/transactions/export", "transactions.csv").catch(() =>
                setError("Could not export transactions."),
              )
            }
            className="ml-1 rounded-control border border-adm-line px-3 py-1 text-xs2 font-medium text-adm-muted hover:bg-adm-panel-hover"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="mb-3">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search workspace or detail" className="rounded-control border border-adm-line bg-adm-panel px-3 py-2 text-xs2 text-adm-ink outline-none" />
      </div>

      {rows === null ? (
        <AdmCard>
          <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
        </AdmCard>
      ) : rows.length === 0 ? (
        <AdmCard>
          <div className="py-8 text-center text-sm2 text-adm-muted">No transactions in this view.</div>
        </AdmCard>
      ) : (
        <AdmCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-adm-line">
                {["When", "Workspace", "Type", "Detail", "Change", "Balance"].map((h) => (
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
                  <td className="whitespace-nowrap px-4 py-3 font-geist-mono text-micro text-adm-subtle">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs2 text-adm-muted">{r.tenantName}</td>
                  <td className="px-4 py-3">
                    <AdmPill tone={TYPE_TONE[r.type]}>{r.type}</AdmPill>
                  </td>
                  <td className="px-4 py-3 text-xs2 text-adm-muted">{r.reason ?? r.feature ?? "—"}</td>
                  <td
                    className={`px-4 py-3 font-geist-mono text-xs2 font-semibold ${
                      r.deltaCredits > 0 ? "text-adm-ok" : r.deltaCredits < 0 ? "text-adm-ink" : "text-adm-subtle"
                    }`}
                  >
                    {r.deltaCredits > 0 ? `+${r.deltaCredits}` : r.deltaCredits}
                  </td>
                  <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">
                    {r.balanceAfter.toLocaleString()}
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
          Page {page} of {pages} · {total.toLocaleString()} entries
          <button disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="rounded-control border border-adm-line px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      )}
    </AdminShell>
  );
}
