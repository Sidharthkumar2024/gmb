import { afterEach, describe, expect, it, vi } from "vitest";

// The critical guarantee: a partner's transactions are scoped to its CHILD
// tenants only, and totals never mix currencies or count refunds as revenue.

const deps = vi.hoisted(() => ({
  tenantFindMany: vi.fn(),
  paymentFindMany: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      tenant: { findMany: deps.tenantFindMany },
      payment: { findMany: deps.paymentFindMany },
    },
  };
});

import { listPartnerTransactions } from "./partnerBilling.service";

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
    await listPartnerTransactions("partner_1");
    expect(deps.tenantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentTenantId: "partner_1" } }),
    );
    expect(deps.paymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: { in: ["c1", "c2"] } } }),
    );
  });

  it("totals count CAPTURED only, summed per currency", async () => {
    deps.tenantFindMany.mockResolvedValue([{ id: "c1" }]);
    deps.paymentFindMany.mockResolvedValue([
      { id: "p1", tenant: { name: "A" }, provider: "RAZORPAY", providerPaymentId: "x1", credits: 500, amountMinor: 50000, currency: "INR", status: "CAPTURED", createdAt: new Date() },
      { id: "p2", tenant: { name: "B" }, provider: "STRIPE", providerPaymentId: "x2", credits: 100, amountMinor: 1000, currency: "USD", status: "CAPTURED", createdAt: new Date() },
      { id: "p3", tenant: { name: "A" }, provider: "RAZORPAY", providerPaymentId: "x3", credits: 200, amountMinor: 20000, currency: "INR", status: "REFUNDED", createdAt: new Date() },
    ]);
    const out = await listPartnerTransactions("partner_1");
    expect(out.totals.payments).toBe(3); // all rows listed
    expect(out.totals.creditsSold).toBe(600); // refunded row excluded
    expect(out.totals.collectedByCurrency).toEqual({ INR: 50000, USD: 1000 }); // refund not added
  });
});
