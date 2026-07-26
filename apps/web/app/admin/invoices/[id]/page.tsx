"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminShell, AdmCard } from "../../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../../src/lib/api";

// Printable invoice detail. Derived from a single Payment; "Print" uses the
// browser's own print dialog (no PDF service). Read-only.

interface InvoiceLine {
  description: string;
  quantity: number;
  unitAmountMinor: number;
  amountMinor: number;
}
interface Invoice {
  id: string;
  number: string;
  status: "PAID" | "REFUNDED";
  issuedAt: string;
  currency: string;
  seller: { name: string; product: string; supportEmail: string };
  buyer: { tenantId: string; name: string };
  payment: { provider: string; providerPaymentId: string };
  lines: InvoiceLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export default function AdminInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    void api
      .get<Invoice>(`/api/v1/admin/invoices/${id}`)
      .then((r) => setInv(r))
      .catch((e) =>
        setError(e instanceof ApiClientError ? e.message : "Could not load invoice."),
      )
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <AdminShell title="Invoice">
      <div className="mb-3.5 flex items-center gap-2 print:hidden">
        <Link
          href="/admin/invoices"
          className="rounded-control border border-adm-line px-3 py-1.5 text-xs2 font-medium text-adm-muted no-underline hover:bg-adm-panel-hover hover:no-underline"
        >
          ← All invoices
        </Link>
        {inv && (
          <button
            type="button"
            onClick={() => window.print()}
            className="ml-auto rounded-control bg-gmb-brand px-3 py-1.5 text-xs2 font-semibold text-white hover:opacity-90"
          >
            Print
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      {loading ? (
        <AdmCard>
          <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
        </AdmCard>
      ) : inv ? (
        <AdmCard className="mx-auto max-w-[720px] p-8">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-bold tracking-[-0.01em]">{inv.seller.name}</div>
              <div className="text-xs2 text-adm-muted">{inv.seller.product}</div>
              <div className="mt-1 font-geist-mono text-micro text-adm-subtle">
                {inv.seller.supportEmail}
              </div>
            </div>
            <div className="text-right">
              <div className="font-geist-mono text-sm2 font-semibold text-adm-ink">{inv.number}</div>
              <div className="mt-1 text-micro text-adm-subtle">
                Issued {new Date(inv.issuedAt).toLocaleDateString()}
              </div>
              <div
                className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-tiny font-semibold ${
                  inv.status === "PAID" ? "bg-adm-ok/15 text-adm-ok" : "bg-white/[0.06] text-adm-muted"
                }`}
              >
                {inv.status}
              </div>
            </div>
          </div>

          <div className="my-6 border-t border-adm-line" />

          <div className="mb-6">
            <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-adm-subtle">
              Billed to
            </div>
            <div className="mt-1 text-sm2 text-adm-ink">{inv.buyer.name}</div>
          </div>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-adm-line">
                {["Description", "Qty", "Unit", "Amount"].map((h, i) => (
                  <th
                    key={h}
                    className={`py-2 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-adm-subtle ${
                      i > 0 ? "text-right" : ""
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i} className="border-b border-adm-line/60">
                  <td className="py-2.5 text-xs2 text-adm-ink">{l.description}</td>
                  <td className="py-2.5 text-right font-geist-mono text-xs2 text-adm-muted">
                    {l.quantity.toLocaleString()}
                  </td>
                  <td className="py-2.5 text-right font-geist-mono text-xs2 text-adm-muted">
                    {money(l.unitAmountMinor, inv.currency)}
                  </td>
                  <td className="py-2.5 text-right font-geist-mono text-xs2 text-adm-ink">
                    {money(l.amountMinor, inv.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 ml-auto w-[240px] space-y-1.5 text-xs2">
            <div className="flex justify-between text-adm-muted">
              <span>Subtotal</span>
              <span className="font-geist-mono">{money(inv.subtotalMinor, inv.currency)}</span>
            </div>
            <div className="flex justify-between text-adm-muted">
              <span>Tax</span>
              <span className="font-geist-mono">{money(inv.taxMinor, inv.currency)}</span>
            </div>
            <div className="flex justify-between border-t border-adm-line pt-1.5 text-sm2 font-semibold text-adm-ink">
              <span>Total</span>
              <span className="font-geist-mono">{money(inv.totalMinor, inv.currency)}</span>
            </div>
          </div>

          <div className="my-6 border-t border-adm-line" />

          <div className="font-geist-mono text-micro text-adm-subtle">
            Paid via {inv.payment.provider} · {inv.payment.providerPaymentId}
          </div>
        </AdmCard>
      ) : null}
    </AdminShell>
  );
}
