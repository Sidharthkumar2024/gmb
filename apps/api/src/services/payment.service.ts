import { prisma, Prisma, PaymentProvider, PaymentStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { reverseCredits } from "./billing.service";
import { refundRazorpayPayment } from "./razorpay.service";
import { refundStripeCheckoutSession } from "./stripe.service";
import { getPartnerGatewayCreds } from "./partnerGateway.service";
import { ensureTaxInvoice } from "./invoice.service";

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
  const payment = await prisma.payment.upsert({
    where: { providerPaymentId: input.providerPaymentId },
    create: { ...data, providerPaymentId: input.providerPaymentId },
    // A redelivery shouldn't rewrite an already-recorded (possibly refunded)
    // payment, so update is intentionally a no-op on the immutable fields.
    update: {},
  });
  await ensureTaxInvoice(payment.id);
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

export async function paginatePayments(input: {
  page: number;
  pageSize: number;
  status?: PaymentStatus;
  provider?: PaymentProvider;
  search?: string;
}) {
  const where: Prisma.PaymentWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.search
      ? {
          OR: [
            { providerPaymentId: { contains: input.search, mode: "insensitive" } },
            { tenant: { name: { contains: input.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: { tenant: { select: { name: true } } },
    }),
    prisma.payment.count({ where }),
  ]);
  return {
    items: rows.map((p) => ({
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
    })),
    pagination: { page: input.page, pageSize: input.pageSize, total, pages: Math.max(1, Math.ceil(total / input.pageSize)) },
  };
}

/**
 * Refund a captured payment: reverse the credits it granted (a REFUND ledger
 * row) and mark the Payment REFUNDED. The provider refund happens first; if it
 * fails, credits remain untouched. Provider + wallet operations use the same
 * stable idempotency identity, so a retry after a transient DB/network failure
 * cannot double-refund or double-debit.
 */
export async function refundPayment(paymentId: string): Promise<SafePayment> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { tenant: { select: { name: true, parentTenantId: true } } },
  });
  if (!payment) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Payment not found.");

  if (payment.status !== PaymentStatus.REFUNDED) {
    const partnerCreds = payment.tenant.parentTenantId
      ? await getPartnerGatewayCreds(
          payment.tenant.parentTenantId,
          payment.provider === PaymentProvider.RAZORPAY ? "razorpay" : "stripe",
        )
      : null;
    if (payment.tenant.parentTenantId && !partnerCreds) {
      throw new ApiError(ErrorCodes.SERVICE_UNAVAILABLE, 503, "The partner gateway credentials used for this payment are unavailable.");
    }
    const idempotencyKey = `refund_${payment.id}`;
    if (payment.provider === PaymentProvider.RAZORPAY) {
      await refundRazorpayPayment(
        payment.providerPaymentId,
        idempotencyKey,
        partnerCreds?.provider === "razorpay" && partnerCreds.keyId
          ? { keyId: partnerCreds.keyId, keySecret: partnerCreds.apiSecret }
          : undefined,
      );
    } else {
      await refundStripeCheckoutSession(
        payment.providerPaymentId,
        idempotencyKey,
        partnerCreds?.provider === "stripe" ? partnerCreds.apiSecret : undefined,
      );
    }
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
