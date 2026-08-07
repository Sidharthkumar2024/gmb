import { afterEach, describe, expect, it, vi } from "vitest";

// Tax-invoice invariants (compliance-critical): the gateway amount is
// tax-INCLUSIVE, so subtotal + tax must always equal exactly what the customer
// paid (never an over-charge); invoice numbers are financial-year prefixed and
// zero-padded from a DB sequence; the snapshot is created once (idempotent);
// and GSTIN input is validated.

const deps = vi.hoisted(() => ({
  taxFindUnique: vi.fn(),
  taxCreate: vi.fn(),
  paymentFindUnique: vi.fn(),
  profileFindUnique: vi.fn(),
  profileUpsert: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      taxInvoice: { findUnique: deps.taxFindUnique, create: deps.taxCreate },
      payment: { findUnique: deps.paymentFindUnique },
      billingProfile: { findUnique: deps.profileFindUnique, upsert: deps.profileUpsert },
      $queryRaw: deps.queryRaw,
    },
  };
});

import { ensureTaxInvoice, saveBillingProfile } from "./invoice.service";

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay_1",
    tenantId: "t1",
    amountMinor: 11800, // ₹118.00 paid
    currency: "INR",
    credits: 1000,
    provider: "RAZORPAY",
    providerPaymentId: "rzp_1",
    createdAt: new Date("2026-08-02T00:00:00Z"), // FY 2026-27 (Apr–Mar)
    tenant: { name: "Acme" },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("ensureTaxInvoice — GST split + numbering", () => {
  it("splits a tax-inclusive amount so subtotal + tax === amount (no over-charge)", async () => {
    vi.stubEnv("INVOICE_SELLER_GSTIN", "29ABCDE1234F1Z5");
    vi.stubEnv("INVOICE_GST_RATE_BPS", "1800"); // 18%
    deps.taxFindUnique.mockResolvedValue(null);
    deps.paymentFindUnique.mockResolvedValue(payment());
    deps.profileFindUnique.mockResolvedValue(null);
    deps.queryRaw.mockResolvedValue([{ nextval: 42n }]);
    deps.taxCreate.mockImplementation(async ({ data }: { data: Record<string, number> }) => data);

    await ensureTaxInvoice("pay_1");
    const data = deps.taxCreate.mock.calls[0][0].data;
    expect(data.subtotalMinor).toBe(10000); // ₹100.00 base
    expect(data.taxMinor).toBe(1800); // ₹18.00 GST
    expect(data.totalMinor).toBe(11800);
    expect(data.subtotalMinor + data.taxMinor).toBe(11800); // === amount paid
    expect(data.taxRateBps).toBe(1800);
  });

  it("uses a financial-year-prefixed, zero-padded number from the DB sequence", async () => {
    vi.stubEnv("INVOICE_SELLER_GSTIN", "29ABCDE1234F1Z5");
    deps.taxFindUnique.mockResolvedValue(null);
    deps.paymentFindUnique.mockResolvedValue(payment());
    deps.profileFindUnique.mockResolvedValue(null);
    deps.queryRaw.mockResolvedValue([{ nextval: 42n }]);
    deps.taxCreate.mockImplementation(async ({ data }: { data: { number: string } }) => data);

    await ensureTaxInvoice("pay_1");
    expect(deps.taxCreate.mock.calls[0][0].data.number).toBe("INV-2026-27-000042");
  });

  it("charges no tax when no seller GSTIN is configured (subtotal === amount)", async () => {
    // no INVOICE_SELLER_GSTIN in env → rate 0
    deps.taxFindUnique.mockResolvedValue(null);
    deps.paymentFindUnique.mockResolvedValue(payment());
    deps.profileFindUnique.mockResolvedValue(null);
    deps.queryRaw.mockResolvedValue([{ nextval: 1n }]);
    deps.taxCreate.mockImplementation(async ({ data }: { data: Record<string, number> }) => data);

    await ensureTaxInvoice("pay_1");
    const data = deps.taxCreate.mock.calls[0][0].data;
    expect(data.subtotalMinor).toBe(11800);
    expect(data.taxMinor).toBe(0);
    expect(data.taxRateBps).toBe(0);
  });

  it("is idempotent — returns the existing snapshot without creating another", async () => {
    deps.taxFindUnique.mockResolvedValue({ id: "inv_existing", number: "INV-2026-27-000001" });
    const result = await ensureTaxInvoice("pay_1");
    expect(result).toMatchObject({ id: "inv_existing" });
    expect(deps.taxCreate).not.toHaveBeenCalled();
    expect(deps.paymentFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when the payment does not exist", async () => {
    deps.taxFindUnique.mockResolvedValue(null);
    deps.paymentFindUnique.mockResolvedValue(null);
    expect(await ensureTaxInvoice("missing")).toBeNull();
  });
});

describe("saveBillingProfile — GSTIN validation", () => {
  it("rejects a malformed GSTIN (400) and does not persist", async () => {
    await expect(
      saveBillingProfile("t1", { gstin: "not-a-gstin" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.profileUpsert).not.toHaveBeenCalled();
  });

  it("uppercases and stores a valid GSTIN", async () => {
    deps.profileUpsert.mockImplementation(async (args: { create: Record<string, unknown> }) => args.create);
    await saveBillingProfile("t1", { gstin: "29abcde1234f1z5", legalName: "  Acme Ltd  " });
    const create = deps.profileUpsert.mock.calls[0][0].create;
    expect(create.gstin).toBe("29ABCDE1234F1Z5");
    expect(create.legalName).toBe("Acme Ltd"); // trimmed
  });
});
