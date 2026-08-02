"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminShell, AdmCard } from "../../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../../src/lib/api";
import { downloadAuthed } from "../../../../src/lib/download";

// Immutable tax-invoice detail with print and authenticated server PDF.

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
  seller: { name: string; product: string; supportEmail: string; address: string | null; gstin: string | null };
  buyer: { tenantId: string; name: string; address: string | null; gstin: string | null; placeOfSupply: string | null };
  payment: { provider: string; providerPaymentId: string };
  lines: InvoiceLine[];
  subtotalMinor: number;
  taxMinor: number;
  taxRateBps: number;
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
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => void downloadAuthed(`/api/v1/admin/invoices/${inv.id}/pdf`, `${inv.number}.pdf`).catch(() => setError("Could not download invoice PDF."))} className="rounded-control border border-adm-line px-3 py-1.5 text-xs2 font-semibold text-adm-ink hover:bg-adm-panel-hover">Download PDF</button>
            <button type="button" onClick={() => window.print()} className="rounded-control bg-gmb-brand px-3 py-1.5 text-xs2 font-semibold text-white hover:opacity-90">Print</button>
          </div>
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
              {inv.seller.address && <div className="mt-1 max-w-sm whitespace-pre-line text-micro text-adm-subtle">{inv.seller.address}</div>}
              {inv.seller.gstin && <div className="mt-1 font-geist-mono text-micro text-adm-subtle">GSTIN {inv.seller.gstin}</div>}
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
            {inv.buyer.address && <div className="mt-1 whitespace-pre-line text-xs2 text-adm-muted">{inv.buyer.address}</div>}
            {inv.buyer.gstin && <div className="mt-1 font-geist-mono text-micro text-adm-subtle">GSTIN {inv.buyer.gstin}</div>}
            {inv.buyer.placeOfSupply && <div className="mt-1 text-micro text-adm-subtle">Place of supply: {inv.buyer.placeOfSupply}</div>}
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
              <span>Tax{inv.taxRateBps > 0 ? ` (${(inv.taxRateBps / 100).toFixed(2)}%)` : ""}</span>
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
