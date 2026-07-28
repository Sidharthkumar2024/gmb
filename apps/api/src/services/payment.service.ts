import { prisma, PaymentProvider, PaymentStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { reverseCredits } from "./billing.service";

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

/**
 * Refund a captured payment: reverse the credits it granted (a REFUND ledger
 * row) and mark the Payment REFUNDED. Idempotent — a payment already REFUNDED is
 * a no-op. This records the refund in OUR ledger only; the actual money-back is
 * issued by the operator in the gateway dashboard (we never move money). Because
 * the credit reversal and the ledger row are both keyed on `refund:<paymentId>`,
 * re-refunding never double-debits.
 */
export async function refundPayment(paymentId: string): Promise<SafePayment> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { tenant: { select: { name: true } } },
  });
  if (!payment) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Payment not found.");

  if (payment.status !== PaymentStatus.REFUNDED) {
    await reverseCredits(payment.tenantId, payment.credits, {
      reason: `Refund of ${payment.providerPaymentId}`,
      idempotencyKey: `refund:${payment.id}`,
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.REFUNDED },
    });
  }

  return {
    id: payment.id,
    tenantId: payment.tenantId,
    tenantName: payment.tenant.name,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    credits: payment.credits,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    status: PaymentStatus.REFUNDED,
    createdAt: payment.createdAt,
  };
}
