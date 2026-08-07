import { prisma, PaymentStatus, type PaymentProvider } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitAmountMinor: number;
  amountMinor: number;
}

export interface Invoice {
  id: string;
  number: string;
  status: "PAID" | "REFUNDED";
  issuedAt: Date;
  currency: string;
  seller: { name: string; product: string; supportEmail: string; address: string | null; gstin: string | null };
  buyer: { tenantId: string; name: string; address: string | null; gstin: string | null; placeOfSupply: string | null };
  payment: { provider: PaymentProvider; providerPaymentId: string };
  lines: InvoiceLine[];
  subtotalMinor: number;
  taxMinor: number;
  taxRateBps: number;
  totalMinor: number;
}

function financialYear(date: Date): string {
  // India's fiscal year runs 1 Apr – 31 Mar in IST (UTC+5:30, no DST). Compute
  // the boundary in IST, not UTC: a payment captured between 18:30 and 24:00 UTC
  // already falls on the next IST day, so a UTC-based FY would misfile invoices
  // in that window around the 31 Mar / 1 Apr boundary into the wrong year.
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function seller() {
  return {
    name: process.env.INVOICE_SELLER_NAME ?? "Adgrowly",
    product: process.env.INVOICE_PRODUCT_NAME ?? "GMB Suite",
    supportEmail: process.env.INVOICE_SELLER_EMAIL ?? "billing@adgrowly.ca",
    address: process.env.INVOICE_SELLER_ADDRESS?.trim() || null,
    gstin: process.env.INVOICE_SELLER_GSTIN?.trim().toUpperCase() || null,
  };
}

function taxRateBps(): number {
  if (!process.env.INVOICE_SELLER_GSTIN) return 0;
  const value = Number(process.env.INVOICE_GST_RATE_BPS ?? 1800);
  return Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : 0;
}

/** Create the immutable accounting snapshot exactly once for a Payment. */
export async function ensureTaxInvoice(paymentId: string) {
  const existing = await prisma.taxInvoice.findUnique({ where: { paymentId } });
  if (existing) return existing;
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { tenant: { select: { name: true } } },
  });
  if (!payment) return null;
  const profile = await prisma.billingProfile.findUnique({ where: { tenantId: payment.tenantId } });
  const rate = taxRateBps();
  // Gateway amount is treated as tax-inclusive: enabling GST changes the
  // breakdown, never silently charges the customer more than they paid.
  const subtotalMinor = rate > 0
    ? Math.round((payment.amountMinor * 10_000) / (10_000 + rate))
    : payment.amountMinor;
  const taxMinor = payment.amountMinor - subtotalMinor;
  const seq = await prisma.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('"TaxInvoice_number_seq"')`;
  const number = `INV-${financialYear(payment.createdAt)}-${String(seq[0]?.nextval ?? 0).padStart(6, "0")}`;
  const issuer = seller();
  try {
    return await prisma.taxInvoice.create({
      data: {
        paymentId: payment.id,
        tenantId: payment.tenantId,
        number,
        subtotalMinor,
        taxMinor,
        totalMinor: payment.amountMinor,
        taxRateBps: rate,
        currency: payment.currency,
        sellerName: issuer.name,
        sellerAddress: issuer.address,
        sellerGstin: issuer.gstin,
        sellerEmail: issuer.supportEmail,
        buyerName: profile?.legalName?.trim() || payment.tenant.name,
        buyerAddress: profile?.billingAddress ?? null,
        buyerGstin: profile?.gstin?.toUpperCase() ?? null,
        placeOfSupply: profile?.placeOfSupply ?? null,
        issuedAt: payment.createdAt,
      },
    });
  } catch (error) {
    // Concurrent webhook/list backfill: the payment unique wins; return it.
    const raced = await prisma.taxInvoice.findUnique({ where: { paymentId } });
    if (raced) return raced;
    throw error;
  }
}

type PaymentWithTenant = Awaited<ReturnType<typeof paymentById>>;
async function paymentById(id: string) {
  return prisma.payment.findUnique({
    where: { id },
    include: { tenant: { select: { name: true } }, taxInvoice: true },
  });
}

async function toInvoice(payment: NonNullable<PaymentWithTenant>): Promise<Invoice> {
  const tax = payment.taxInvoice ?? await ensureTaxInvoice(payment.id);
  if (!tax) throw new Error("Invoice payment disappeared during rendering.");
  const unit = payment.credits > 0 ? Math.round(tax.subtotalMinor / payment.credits) : tax.subtotalMinor;
  return {
    id: payment.id,
    number: tax.number,
    status: payment.status === PaymentStatus.REFUNDED ? "REFUNDED" : "PAID",
    issuedAt: tax.issuedAt,
    currency: tax.currency,
    seller: {
      name: tax.sellerName,
      product: process.env.INVOICE_PRODUCT_NAME ?? "GMB Suite",
      supportEmail: tax.sellerEmail ?? "billing@adgrowly.ca",
      address: tax.sellerAddress,
      gstin: tax.sellerGstin,
    },
    buyer: {
      tenantId: payment.tenantId,
      name: tax.buyerName,
      address: tax.buyerAddress,
      gstin: tax.buyerGstin,
      placeOfSupply: tax.placeOfSupply,
    },
    payment: { provider: payment.provider, providerPaymentId: payment.providerPaymentId },
    lines: [{
      description: `${payment.credits.toLocaleString()} ${process.env.INVOICE_PRODUCT_NAME ?? "GMB Suite"} credits`,
      quantity: payment.credits,
      unitAmountMinor: unit,
      amountMinor: tax.subtotalMinor,
    }],
    subtotalMinor: tax.subtotalMinor,
    taxMinor: tax.taxMinor,
    taxRateBps: tax.taxRateBps,
    totalMinor: tax.totalMinor,
  };
}

export async function listInvoices(limit = 200): Promise<Invoice[]> {
  const rows = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { tenant: { select: { name: true } }, taxInvoice: true },
  });
  return Promise.all(rows.map(toInvoice));
}

export async function paginateInvoices(input: {
  page: number;
  pageSize: number;
  status?: PaymentStatus;
  search?: string;
}) {
  const where = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.search
      ? { OR: [
          { providerPaymentId: { contains: input.search, mode: "insensitive" as const } },
          { tenant: { name: { contains: input.search, mode: "insensitive" as const } } },
        ] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: { tenant: { select: { name: true } }, taxInvoice: true },
    }),
    prisma.payment.count({ where }),
  ]);
  return {
    items: await Promise.all(rows.map(toInvoice)),
    pagination: { page: input.page, pageSize: input.pageSize, total, pages: Math.max(1, Math.ceil(total / input.pageSize)) },
  };
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const payment = await paymentById(id);
  return payment ? toInvoice(payment) : null;
}

export async function listCustomerInvoices(tenantId: string, limit = 200): Promise<Invoice[]> {
  const rows = await prisma.payment.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { tenant: { select: { name: true } }, taxInvoice: true },
  });
  return Promise.all(rows.map(toInvoice));
}

export async function getCustomerInvoice(tenantId: string, id: string): Promise<Invoice | null> {
  const payment = await prisma.payment.findFirst({
    where: { id, tenantId },
    include: { tenant: { select: { name: true } }, taxInvoice: true },
  });
  return payment ? toInvoice(payment) : null;
}

export async function getBillingProfile(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  const row = await prisma.billingProfile.findUnique({ where: { tenantId } });
  return {
    legalName: row?.legalName ?? tenant?.name ?? null,
    billingAddress: row?.billingAddress ?? null,
    gstin: row?.gstin ?? null,
    placeOfSupply: row?.placeOfSupply ?? null,
  };
}

export async function saveBillingProfile(tenantId: string, input: {
  legalName?: string | null;
  billingAddress?: string | null;
  gstin?: string | null;
  placeOfSupply?: string | null;
}) {
  const clean = (value: string | null | undefined) => value?.trim() || null;
  const gstin = clean(input.gstin)?.toUpperCase() ?? null;
  if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Enter a valid 15-character GSTIN.");
  }
  const row = await prisma.billingProfile.upsert({
    where: { tenantId },
    create: {
      tenantId,
      legalName: clean(input.legalName),
      billingAddress: clean(input.billingAddress),
      gstin,
      placeOfSupply: clean(input.placeOfSupply),
    },
    update: {
      legalName: clean(input.legalName),
      billingAddress: clean(input.billingAddress),
      gstin,
      placeOfSupply: clean(input.placeOfSupply),
    },
  });
  return row;
}
