import { prisma, PaymentProvider, PaymentStatus } from "@nexaflow/db";

// Captured-payment records. Written by the top-up webhook alongside the credit
// grant, so the admin Payments/Invoices screens read a real record rather than
// scraping the credit ledger. Idempotent on providerPaymentId: a redelivered
// webhook upserts the same row, never a duplicate payment.

export interface RecordPaymentInput {
  tenantId: string;
  provider: PaymentProvider;
  providerPaymentId: string;
  credits: number;
  amountMinor: number;
  currency: string;
}

export async function recordPayment(input: RecordPaymentInput): Promise<void> {
  const data = {
    tenantId: input.tenantId,
    provider: input.provider,
    credits: input.credits,
    amountMinor: input.amountMinor,
    currency: input.currency,
    status: PaymentStatus.CAPTURED,
  };
  await prisma.payment.upsert({
    where: { providerPaymentId: input.providerPaymentId },
    create: { ...data, providerPaymentId: input.providerPaymentId },
    // A redelivery shouldn't rewrite an already-recorded (possibly refunded)
    // payment, so update is intentionally a no-op on the immutable fields.
    update: {},
  });
}

export interface SafePayment {
  id: string;
  tenantId: string;
  tenantName: string;
  provider: PaymentProvider;
  providerPaymentId: string;
  credits: number;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  createdAt: Date;
}

/** Admin: recent payments across all workspaces. */
export async function listPayments(limit = 200): Promise<SafePayment[]> {
  const rows = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { tenant: { select: { name: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    tenantId: p.tenantId,
    tenantName: p.tenant.name,
    provider: p.provider,
    providerPaymentId: p.providerPaymentId,
    credits: p.credits,
    amountMinor: p.amountMinor,
    currency: p.currency,
    status: p.status,
    createdAt: p.createdAt,
  }));
}
