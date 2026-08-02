import { prisma, TenantStatus, PaymentStatus, type PaymentProvider } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { refundPayment } from "./payment.service";

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

  // Totals are ALL-TIME DB aggregates, not derived from the capped display list
  // above — a partner with more than `limit` payments still sees true totals.
  // Collected/credits count CAPTURED only (a refunded payment isn't revenue).
  const [totalCount, byCurrency] = await Promise.all([
    prisma.payment.count({ where: { tenantId: { in: ids } } }),
    prisma.payment.groupBy({
      by: ["currency"],
      where: { tenantId: { in: ids }, status: PaymentStatus.CAPTURED },
      _sum: { amountMinor: true, credits: true },
    }),
  ]);
  const collectedByCurrency: Record<string, number> = {};
  let creditsSold = 0;
  for (const g of byCurrency) {
    collectedByCurrency[g.currency] = g._sum.amountMinor ?? 0;
    creditsSold += g._sum.credits ?? 0;
  }

  return {
    totals: { payments: totalCount, creditsSold, collectedByCurrency },
    payments,
  };
}

/**
 * Refund one of the partner's own customers' payments. Ownership-scoped: the
 * payment's tenant must be a CHILD of this partner, so a partner can never
 * refund another partner's or the platform's payment. Delegates to the shared
 * refundPayment, which issues the gateway refund with the partner's historical
 * provider credentials before reversing credits.
 */
export async function refundPartnerPayment(partnerTenantId: string, paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { tenant: { select: { parentTenantId: true } } },
  });
  if (!payment || payment.tenant.parentTenantId !== partnerTenantId) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Payment not found.");
  }
  return refundPayment(paymentId);
}

// --- Monthly billing statement ----------------------------------------------
// Adgrowly bills the partner wholesale for each ACTIVE customer on a plan; the
// partner collects retail from those customers. Both sides are real:
//   - wholesale due  = Σ active children's plan price (the platform's charge)
//   - collected      = Σ CAPTURED payments from children this calendar month
//   - margin         = collected − wholesale due, PER CURRENCY (never mixed)
// Nothing is stored yet — this is the live derivation. A monthly job that
// snapshots it into a PartnerInvoice record is the follow-up (5d part 2).

export interface StatementLine {
  customerId: string;
  customerName: string;
  planName: string | null;
  wholesaleMinor: number; // what Adgrowly charges the partner for this customer
  currency: string;
  collectedThisMonthMinor: number; // what the customer paid the partner this month
}

export interface PartnerStatement {
  period: { year: number; month: number; label: string }; // current calendar month (UTC)
  lines: StatementLine[];
  totals: {
    activeCustomers: number;
    wholesaleDueByCurrency: Record<string, number>;
    collectedByCurrency: Record<string, number>;
    marginByCurrency: Record<string, number>;
  };
  // True when every figure shares one currency, so a single headline margin is
  // meaningful; false when currencies are mixed (UI then shows per-currency).
  singleCurrency: string | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export async function getPartnerStatement(
  partnerTenantId: string,
  period?: { year: number; month0: number }, // month0 = 0-based; omit for current month
): Promise<PartnerStatement> {
  const now = new Date();
  const year = period?.year ?? now.getUTCFullYear();
  const month = period?.month0 ?? now.getUTCMonth(); // 0-based
  const monthStart = new Date(Date.UTC(year, month, 1));
  const nextMonth = new Date(Date.UTC(year, month + 1, 1));

  const children = await prisma.tenant.findMany({
    where: { parentTenantId: partnerTenantId, status: TenantStatus.ACTIVE },
    include: { plan: { select: { name: true, priceCents: true, currency: true } } },
  });

  // Payments captured by these children this month, grouped by child.
  const ids = children.map((c) => c.id);
  const monthPayments = ids.length
    ? await prisma.payment.findMany({
        where: {
          tenantId: { in: ids },
          status: PaymentStatus.CAPTURED,
          createdAt: { gte: monthStart, lt: nextMonth },
        },
        select: { tenantId: true, amountMinor: true, currency: true },
      })
    : [];

  const collectedPerChild = new Map<string, { minor: number; currency: string }>();
  for (const p of monthPayments) {
    // A child pays in one currency in practice; if mixed, the last wins for the
    // per-line display but totals below sum each currency independently.
    const prev = collectedPerChild.get(p.tenantId);
    collectedPerChild.set(p.tenantId, {
      minor: (prev?.minor ?? 0) + p.amountMinor,
      currency: p.currency,
    });
  }

  const wholesaleDueByCurrency: Record<string, number> = {};
  const collectedByCurrency: Record<string, number> = {};
  const lines: StatementLine[] = [];

  for (const c of children) {
    const wholesaleMinor = c.plan?.priceCents ?? 0;
    const currency = c.plan?.currency ?? "USD";
    const collected = collectedPerChild.get(c.id);
    if (c.plan) {
      wholesaleDueByCurrency[currency] = (wholesaleDueByCurrency[currency] ?? 0) + wholesaleMinor;
    }
    if (collected) {
      collectedByCurrency[collected.currency] =
        (collectedByCurrency[collected.currency] ?? 0) + collected.minor;
    }
    lines.push({
      customerId: c.id,
      customerName: c.name,
      planName: c.plan?.name ?? null,
      wholesaleMinor,
      currency,
      collectedThisMonthMinor: collected?.minor ?? 0,
    });
  }

  const marginByCurrency: Record<string, number> = {};
  for (const cur of new Set([
    ...Object.keys(wholesaleDueByCurrency),
    ...Object.keys(collectedByCurrency),
  ])) {
    marginByCurrency[cur] = (collectedByCurrency[cur] ?? 0) - (wholesaleDueByCurrency[cur] ?? 0);
  }

  const currencies = Object.keys(marginByCurrency);
  const singleCurrency = currencies.length === 1 ? currencies[0] : null;

  return {
    period: { year, month: month + 1, label: `${MONTHS[month]} ${year}` },
    lines,
    totals: {
      activeCustomers: children.length,
      wholesaleDueByCurrency,
      collectedByCurrency,
      marginByCurrency,
    },
    singleCurrency,
  };
}
