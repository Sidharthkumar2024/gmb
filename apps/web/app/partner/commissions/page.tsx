"use client";

import { useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface Statement {
  period: { label: string };
  totals: {
    activeCustomers: number;
    wholesaleDueByCurrency: Record<string, number>;
    collectedByCurrency: Record<string, number>;
    marginByCurrency: Record<string, number>;
  };
}
interface Invoice { id: string; number: string; issuedAt: string; status: "OPEN" | "PAID" | "OVERDUE" | "VOID"; statement: Statement; }

function money(minor: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100); }
  catch { return `${(minor / 100).toFixed(2)} ${currency}`; }
}
function currencies(values: Record<string, number>) {
  const entries = Object.entries(values);
  return entries.length ? entries.map(([currency, minor]) => money(minor, currency)).join(" · ") : "—";
}
const invoiceTone = { OPEN: "warn", PAID: "ok", OVERDUE: "danger", VOID: "neutral" } as const;

export default function PartnerCommissionsPage() {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([
      api.get<Statement>("/api/v1/partner/statement"),
      api.get<Invoice[]>("/api/v1/partner/invoices"),
    ]).then(([current, history]) => { setStatement(current); setInvoices(history ?? []); })
      .catch((reason) => setError(reason instanceof ApiClientError ? reason.message : "Could not load commissions."));
  }, []);

  const collected = statement ? currencies(statement.totals.collectedByCurrency) : "—";
  const wholesale = statement ? currencies(statement.totals.wholesaleDueByCurrency) : "—";
  const margin = statement ? currencies(statement.totals.marginByCurrency) : "—";

  return (
    <PartnerShell title="Commissions">
      {error ? <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">{error}</div> : null}
      <div className="mb-3.5 grid grid-cols-3 gap-3.5">
        {[["Collected · current month", collected, "captured customer payments"], ["Wholesale due", wholesale, "platform cost for active customers"], ["Accrued margin", margin, "collected − wholesale, by currency"]].map(([label, value, hint]) => (
          <PtnCard key={label}><PtnLabel>{label}</PtnLabel><div className={`mt-1.5 font-newsreader text-[30px] font-medium tracking-[-0.015em] ${label === "Accrued margin" ? "text-ptn-accent" : "text-ptn-ink"}`}>{value}</div><div className="mt-1 text-xs2 text-ptn-muted">{hint}</div></PtnCard>
        ))}
      </div>
      <PtnCard className="overflow-x-auto p-0">
        <div className="border-b border-ptn-line px-5 py-3.5 text-sm font-semibold text-ptn-ink">Settlement history</div>
        {invoices.length === 0 ? <div className="py-10 text-center text-sm2 text-ptn-muted">No finalised settlement periods yet.</div> : (
          <table className="w-full border-collapse text-left"><thead><tr className="border-b border-ptn-line bg-ptn-panel-hover">{["Period", "Invoice", "Status", "Margin", "Issued"].map((heading) => <th key={heading} className="px-5 py-3 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-ptn-subtle">{heading}</th>)}</tr></thead>
          <tbody>{invoices.map((invoice) => <tr key={invoice.id} className="border-b border-ptn-line/60 last:border-0"><td className="px-5 py-3 text-sm2 text-ptn-ink">{invoice.statement.period.label}</td><td className="px-5 py-3 font-geist-mono text-xs2 text-ptn-muted">{invoice.number}</td><td className="px-5 py-3"><PtnPill tone={invoiceTone[invoice.status]}>{invoice.status}</PtnPill></td><td className="px-5 py-3 font-geist-mono text-xs2 text-ptn-accent">{currencies(invoice.statement.totals.marginByCurrency)}</td><td className="px-5 py-3 font-geist-mono text-micro text-ptn-subtle">{new Date(invoice.issuedAt).toLocaleDateString()}</td></tr>)}</tbody></table>
        )}
      </PtnCard>
    </PartnerShell>
  );
}
