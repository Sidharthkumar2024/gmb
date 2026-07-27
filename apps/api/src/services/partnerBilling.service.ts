import { prisma, type PaymentProvider, type PaymentStatus } from "@nexaflow/db";

// Partner-scoped billing views. A partner's customers are its CHILD tenants
// (Tenant.parentTenantId). Every query here is filtered to those children, so a
// partner only ever sees its own customers' payments — never another partner's
// and never the platform's. All figures come from real Payment rows.

export interface PartnerPaymentView {
  id: string;
  customerName: string;
  provider: PaymentProvider;
  providerPaymentId: string;
  credits: number;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  createdAt: Date;
}

export interface PartnerTransactions {
  totals: {
    payments: number;
    creditsSold: number;
    // Summed per currency — never add across currencies, which would be a lie.
    collectedByCurrency: Record<string, number>;
  };
  payments: PartnerPaymentView[];
}

/** Resolve the partner's customer tenant ids (its children). */
async function childTenantIds(partnerTenantId: string): Promise<string[]> {
  const children = await prisma.tenant.findMany({
    where: { parentTenantId: partnerTenantId },
    select: { id: true },
  });
  return children.map((c) => c.id);
}

export async function listPartnerTransactions(
  partnerTenantId: string,
  limit = 200,
): Promise<PartnerTransactions> {
  const ids = await childTenantIds(partnerTenantId);
  if (ids.length === 0) {
    return { totals: { payments: 0, creditsSold: 0, collectedByCurrency: {} }, payments: [] };
  }

  const rows = await prisma.payment.findMany({
    where: { tenantId: { in: ids } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { tenant: { select: { name: true } } },
  });

  const payments: PartnerPaymentView[] = rows.map((p) => ({
    id: p.id,
    customerName: p.tenant.name,
    provider: p.provider,
    providerPaymentId: p.providerPaymentId,
    credits: p.credits,
    amountMinor: p.amountMinor,
    currency: p.currency,
    status: p.status,
    createdAt: p.createdAt,
  }));

  // Totals reflect captured payments only (a refunded payment isn't revenue).
  const collectedByCurrency: Record<string, number> = {};
  let creditsSold = 0;
  for (const p of payments) {
    if (p.status !== "CAPTURED") continue;
    collectedByCurrency[p.currency] = (collectedByCurrency[p.currency] ?? 0) + p.amountMinor;
    creditsSold += p.credits;
  }

  return {
    totals: { payments: payments.length, creditsSold, collectedByCurrency },
    payments,
  };
}
