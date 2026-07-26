import { prisma, PaymentStatus, type PaymentProvider } from "@nexaflow/db";

// Invoices are derived one-per-captured-Payment rather than stored: a Payment is
// already the immutable record of money received, so an invoice is just a
// formatted view of it plus the seller (platform) and buyer (workspace) details.
// The invoice NUMBER is derived deterministically from the payment's immutable
// fields, so the same payment always yields the same number without a sequence
// table. If accounting-grade sequential numbering is ever needed, promote this
// to a stored Invoice model — the DTO shape below stays the same.

// Platform / seller identity shown on every invoice. Static for now; if these
// ever need to be operator-editable, back them with a PLATFORM vault entry.
const SELLER = {
  name: "Adgrowly",
  product: "GMB Suite",
  supportEmail: "billing@adgrowly.local",
};

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitAmountMinor: number;
  amountMinor: number;
}

export interface Invoice {
  id: string; // == payment id, so /admin/invoices/:id is stable
  number: string;
  status: "PAID" | "REFUNDED";
  issuedAt: Date;
  currency: string;
  seller: typeof SELLER;
  buyer: { tenantId: string; name: string };
  payment: { provider: PaymentProvider; providerPaymentId: string };
  lines: InvoiceLine[];
  subtotalMinor: number;
  taxMinor: number; // 0 — no tax model configured; shown honestly, not hidden
  totalMinor: number;
}

/**
 * Stable, human-readable invoice number derived from the payment: the issue
 * month plus a short suffix of the payment id. Deterministic — a redelivered
 * webhook that upserts the same Payment keeps the same invoice number.
 */
function invoiceNumber(id: string, issuedAt: Date): string {
  const y = issuedAt.getUTCFullYear();
  const m = String(issuedAt.getUTCMonth() + 1).padStart(2, "0");
  const suffix = id.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
  return `INV-${y}${m}-${suffix}`;
}

function toInvoice(p: {
  id: string;
  tenantId: string;
  provider: PaymentProvider;
  providerPaymentId: string;
  credits: number;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  createdAt: Date;
  tenant: { name: string };
}): Invoice {
  const unit = p.credits > 0 ? Math.round(p.amountMinor / p.credits) : p.amountMinor;
  return {
    id: p.id,
    number: invoiceNumber(p.id, p.createdAt),
    status: p.status === PaymentStatus.REFUNDED ? "REFUNDED" : "PAID",
    issuedAt: p.createdAt,
    currency: p.currency,
    seller: SELLER,
    buyer: { tenantId: p.tenantId, name: p.tenant.name },
    payment: { provider: p.provider, providerPaymentId: p.providerPaymentId },
    lines: [
      {
        description: `${p.credits.toLocaleString()} ${SELLER.product} credits`,
        quantity: p.credits,
        unitAmountMinor: unit,
        amountMinor: p.amountMinor,
      },
    ],
    subtotalMinor: p.amountMinor,
    taxMinor: 0,
    totalMinor: p.amountMinor,
  };
}

/** Admin: one invoice per payment, newest first. */
export async function listInvoices(limit = 200): Promise<Invoice[]> {
  const rows = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { tenant: { select: { name: true } } },
  });
  return rows.map(toInvoice);
}

/** Admin: a single invoice by its id (the payment id). Null if not found. */
export async function getInvoice(id: string): Promise<Invoice | null> {
  const p = await prisma.payment.findUnique({
    where: { id },
    include: { tenant: { select: { name: true } } },
  });
  return p ? toInvoice(p) : null;
}
