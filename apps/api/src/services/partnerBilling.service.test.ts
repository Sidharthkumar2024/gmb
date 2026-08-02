import { afterEach, describe, expect, it, vi } from "vitest";

// The critical guarantee: a partner's transactions are scoped to its CHILD
// tenants only, and totals never mix currencies or count refunds as revenue.

const deps = vi.hoisted(() => ({
  tenantFindMany: vi.fn(),
  paymentFindMany: vi.fn(),
  paymentFindUnique: vi.fn(),
  paymentCount: vi.fn(),
  paymentGroupBy: vi.fn(),
  refundPayment: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      tenant: { findMany: deps.tenantFindMany },
      payment: {
        findMany: deps.paymentFindMany,
        findUnique: deps.paymentFindUnique,
        count: deps.paymentCount,
        groupBy: deps.paymentGroupBy,
      },
    },
  };
});
vi.mock("./payment.service", () => ({ refundPayment: deps.refundPayment }));

import {
  listPartnerTransactions,
  getPartnerStatement,
  refundPartnerPayment,
} from "./partnerBilling.service";

afterEach(() => vi.clearAllMocks());

describe("listPartnerTransactions", () => {
  it("returns empty and never queries payments when the partner has no customers", async () => {
    deps.tenantFindMany.mockResolvedValue([]);
    const out = await listPartnerTransactions("partner_1");
    expect(out.payments).toEqual([]);
    expect(out.totals).toEqual({ payments: 0, creditsSold: 0, collectedByCurrency: {} });
    expect(deps.paymentFindMany).not.toHaveBeenCalled();
  });

  it("scopes payments to the partner's child tenant ids", async () => {
    deps.tenantFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    deps.paymentFindMany.mockResolvedValue([]);
    deps.paymentCount.mockResolvedValue(0);
    deps.paymentGroupBy.mockResolvedValue([]);
    await listPartnerTransactions("partner_1");
    expect(deps.tenantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentTenantId: "partner_1" } }),
    );
    expect(deps.paymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: { in: ["c1", "c2"] } } }),
    );
    // Totals aggregate over ALL the children's payments, scoped to the same ids.
    expect(deps.paymentGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: { in: ["c1", "c2"] }, status: "CAPTURED" },
      }),
    );
  });

  it("totals are all-time DB aggregates (count + groupBy), not the capped list", async () => {
    deps.tenantFindMany.mockResolvedValue([{ id: "c1" }]);
    // The display list is capped; totals must NOT be derived from it.
    deps.paymentFindMany.mockResolvedValue([
      { id: "p1", tenant: { name: "A" }, provider: "RAZORPAY", providerPaymentId: "x1", credits: 500, amountMinor: 50000, currency: "INR", status: "CAPTURED", createdAt: new Date() },
    ]);
    // All-time: 640 payments total; captured sums per currency come from groupBy.
    deps.paymentCount.mockResolvedValue(640);
    deps.paymentGroupBy.mockResolvedValue([
      { currency: "INR", _sum: { amountMinor: 5_000_000, credits: 50_000 } },
      { currency: "USD", _sum: { amountMinor: 12_000, credits: 1_200 } },
    ]);
    const out = await listPartnerTransactions("partner_1");
    expect(out.payments).toHaveLength(1); // display list stays capped
    expect(out.totals.payments).toBe(640); // count(), not list length
    expect(out.totals.creditsSold).toBe(51_200); // 50000 + 1200 from groupBy
    expect(out.totals.collectedByCurrency).toEqual({ INR: 5_000_000, USD: 12_000 });
  });
});

describe("getPartnerStatement", () => {
  it("bills wholesale per active child on a plan and derives margin per currency", async () => {
    deps.tenantFindMany.mockResolvedValue([
      { id: "c1", name: "Alpha", plan: { name: "Pro", priceCents: 4900, currency: "USD" } },
      { id: "c2", name: "Beta", plan: { name: "Starter", priceCents: 1500, currency: "USD" } },
      { id: "c3", name: "Gamma", plan: null }, // no plan → no wholesale
    ]);
    deps.paymentFindMany.mockResolvedValue([
      { tenantId: "c1", amountMinor: 9900, currency: "USD" },
      { tenantId: "c1", amountMinor: 100, currency: "USD" }, // two payments this month
      { tenantId: "c2", amountMinor: 2000, currency: "USD" },
    ]);
    const s = await getPartnerStatement("partner_1");

    // Only ACTIVE children queried
    expect(deps.tenantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentTenantId: "partner_1", status: "ACTIVE" } }),
    );
    // Wholesale = 4900 + 1500 (Gamma has no plan)
    expect(s.totals.wholesaleDueByCurrency).toEqual({ USD: 6400 });
    // Collected = 9900 + 100 + 2000
    expect(s.totals.collectedByCurrency).toEqual({ USD: 12000 });
    // Margin = 12000 − 6400
    expect(s.totals.marginByCurrency).toEqual({ USD: 5600 });
    expect(s.singleCurrency).toBe("USD");
    expect(s.totals.activeCustomers).toBe(3);
    // Per-line: c1 collected 10000 aggregated
    expect(s.lines.find((l) => l.customerId === "c1")?.collectedThisMonthMinor).toBe(10000);
  });

  it("returns null singleCurrency when currencies are mixed", async () => {
    deps.tenantFindMany.mockResolvedValue([
      { id: "c1", name: "A", plan: { name: "P", priceCents: 4900, currency: "USD" } },
      { id: "c2", name: "B", plan: { name: "Q", priceCents: 50000, currency: "INR" } },
    ]);
    deps.paymentFindMany.mockResolvedValue([]);
    const s = await getPartnerStatement("partner_1");
    expect(s.singleCurrency).toBeNull();
    expect(s.totals.wholesaleDueByCurrency).toEqual({ USD: 4900, INR: 50000 });
  });
});

describe("refundPartnerPayment", () => {
  it("refunds a payment made by one of the partner's own customers", async () => {
    deps.paymentFindUnique.mockResolvedValue({ tenant: { parentTenantId: "partner_1" } });
    deps.refundPayment.mockResolvedValue({ id: "pay_1", status: "REFUNDED" });
    const out = await refundPartnerPayment("partner_1", "pay_1");
    expect(deps.refundPayment).toHaveBeenCalledWith("pay_1");
    expect(out.status).toBe("REFUNDED");
  });

  it("404s (and never refunds) when the payment isn't the partner's customer's", async () => {
    deps.paymentFindUnique.mockResolvedValue({ tenant: { parentTenantId: "other_partner" } });
    await expect(refundPartnerPayment("partner_1", "pay_x")).rejects.toThrow(/not found/i);
    expect(deps.refundPayment).not.toHaveBeenCalled();
  });

  it("404s when the payment doesn't exist", async () => {
    deps.paymentFindUnique.mockResolvedValue(null);
    await expect(refundPartnerPayment("partner_1", "nope")).rejects.toThrow(/not found/i);
    expect(deps.refundPayment).not.toHaveBeenCalled();
  });
});
