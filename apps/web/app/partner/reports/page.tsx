"use client";

import { useEffect, useMemo, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel } from "../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface Overview { totals: { customers: number; active: number; locations: number }; customers: Array<{ id: string; planName: string | null }>; }
interface Transactions { totals: { payments: number; creditsSold: number; collectedByCurrency: Record<string, number> }; payments: Array<{ amountMinor: number; currency: string; status: string; createdAt: string }>; }
interface Statement { totals: { marginByCurrency: Record<string, number> }; }
function money(minor: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100); } catch { return `${(minor / 100).toFixed(2)} ${currency}`; } }
function currencies(values: Record<string, number>) { const entries = Object.entries(values); return entries.length ? entries.map(([currency, minor]) => money(minor, currency)).join(" · ") : "—"; }

export default function PartnerReportsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [transactions, setTransactions] = useState<Transactions | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void Promise.all([api.get<Overview>("/api/v1/partner/overview"), api.get<Transactions>("/api/v1/partner/transactions"), api.get<Statement>("/api/v1/partner/statement")]).then(([o, t, s]) => { setOverview(o); setTransactions(t); setStatement(s); }).catch((reason) => setError(reason instanceof ApiClientError ? reason.message : "Could not load reports.")); }, []);
  const plans = useMemo(() => { const counts = new Map<string, number>(); for (const customer of overview?.customers ?? []) { const key = customer.planName ?? "No plan"; counts.set(key, (counts.get(key) ?? 0) + 1); } return [...counts.entries()].sort((a, b) => b[1] - a[1]); }, [overview]);
  const monthly = useMemo(() => { const rows = new Map<string, Record<string, number>>(); for (const payment of transactions?.payments ?? []) { if (payment.status !== "CAPTURED") continue; const date = new Date(payment.createdAt); const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; const bucket = rows.get(key) ?? {}; bucket[payment.currency] = (bucket[payment.currency] ?? 0) + payment.amountMinor; rows.set(key, bucket); } return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-8); }, [transactions]);
  return (
    <PartnerShell title="Reports">
      {error ? <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">{error}</div> : null}
      <div className="mb-3.5 text-[13px] text-ptn-muted">Blended, real analytics across all your customer workspaces.</div>
      <div className="mb-3.5 grid grid-cols-4 gap-3.5">{[["Customers", overview?.totals.customers, "all child workspaces"], ["Active", overview?.totals.active, "currently active"], ["Locations", overview?.totals.locations, "managed profiles"], ["Margin · current month", statement ? currencies(statement.totals.marginByCurrency) : null, "by currency"]].map(([label, value, hint]) => <PtnCard key={label}><PtnLabel>{label}</PtnLabel><div className="mt-1.5 font-newsreader text-[26px] font-medium text-ptn-ink">{value ?? "—"}</div><div className="mt-1 text-xs2 text-ptn-muted">{hint}</div></PtnCard>)}</div>
      <div className="grid grid-cols-[1.4fr_1fr] gap-3.5"><PtnCard><div className="text-sm font-semibold text-ptn-ink">Captured payment volume</div><div className="mt-0.5 text-xs2 text-ptn-muted">Last eight months present in the transaction ledger</div><div className="mt-5 flex min-h-[170px] items-end gap-3">{monthly.length === 0 ? <div className="m-auto text-sm2 text-ptn-muted">No captured payments yet.</div> : monthly.map(([month, values]) => { const total = Object.values(values).reduce((sum, value) => sum + value, 0); const max = Math.max(...monthly.map(([, row]) => Object.values(row).reduce((sum, value) => sum + value, 0)), 1); return <div key={month} className="flex flex-1 flex-col items-center gap-2"><div className="font-geist-mono text-micro text-ptn-muted">{currencies(values)}</div><div className="w-full rounded-t-[6px] bg-gradient-to-b from-ptn-accent to-[#4fae74]" style={{ height: `${Math.max(8, Math.round((total / max) * 120))}px` }}/><span className="font-geist-mono text-micro text-ptn-subtle">{month}</span></div>; })}</div></PtnCard><PtnCard><div className="text-sm font-semibold text-ptn-ink">Customers by plan</div><div className="mt-5 space-y-4">{plans.length === 0 ? <div className="py-8 text-center text-sm2 text-ptn-muted">No customers yet.</div> : plans.map(([plan, count]) => <div key={plan}><div className="mb-1.5 flex justify-between text-xs2"><span className="text-ptn-ink">{plan}</span><span className="font-geist-mono text-ptn-muted">{count}</span></div><div className="h-2 overflow-hidden rounded-full bg-ptn-bg"><div className="h-full rounded-full bg-ptn-accent" style={{ width: `${Math.round((count / Math.max(overview?.totals.customers ?? 1, 1)) * 100)}%` }}/></div></div>)}</div></PtnCard></div>
    </PartnerShell>
  );
}
