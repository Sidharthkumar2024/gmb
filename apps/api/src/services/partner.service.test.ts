import { afterEach, describe, expect, it, vi } from "vitest";

// The security-critical guarantee for partner customer management: a partner can
// only suspend/reactivate or re-plan a customer that is ITS OWN child tenant.
// The ownership check scopes every mutation by { id, parentTenantId }.

const deps = vi.hoisted(() => ({
  tenantFindFirst: vi.fn(),
  tenantUpdate: vi.fn(),
  partnerPlanFindFirst: vi.fn(),
  paymentFindMany: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      tenant: { findFirst: deps.tenantFindFirst, update: deps.tenantUpdate },
      partnerPlan: { findFirst: deps.partnerPlanFindFirst },
      payment: { findMany: deps.paymentFindMany },
    },
  };
});

import {
  setPartnerCustomerStatus,
  setPartnerCustomerPlan,
  getPartnerCustomerDetail,
} from "./partner.service";

afterEach(() => vi.clearAllMocks());

describe("setPartnerCustomerStatus", () => {
  it("scopes the ownership check to the partner's children and updates status", async () => {
    deps.tenantFindFirst.mockResolvedValue({ id: "c1", status: "ACTIVE" });
    deps.tenantUpdate.mockResolvedValue({ id: "c1", status: "SUSPENDED" });
    const out = await setPartnerCustomerStatus("partner_1", "c1", "SUSPENDED");
    expect(deps.tenantFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1", parentTenantId: "partner_1" } }),
    );
    expect(out.status).toBe("SUSPENDED");
  });

  it("404s (and never updates) when the customer isn't the partner's child", async () => {
    deps.tenantFindFirst.mockResolvedValue(null);
    await expect(setPartnerCustomerStatus("partner_1", "other", "SUSPENDED")).rejects.toThrow(/not found/i);
    expect(deps.tenantUpdate).not.toHaveBeenCalled();
  });
});

describe("setPartnerCustomerPlan", () => {
  it("rejects a resale plan that isn't the partner's", async () => {
    deps.tenantFindFirst.mockResolvedValue({ id: "c1", status: "ACTIVE" });
    deps.partnerPlanFindFirst.mockResolvedValue(null);
    await expect(setPartnerCustomerPlan("partner_1", "c1", "pp_other")).rejects.toThrow(/wasn't found/i);
    expect(deps.tenantUpdate).not.toHaveBeenCalled();
  });

  it("maps the resale plan to its base plan when assigning", async () => {
    deps.tenantFindFirst.mockResolvedValue({ id: "c1", status: "ACTIVE" });
    deps.partnerPlanFindFirst.mockResolvedValue({ basePlanId: "base_pro" });
    deps.tenantUpdate.mockResolvedValue({ plan: { name: "Pro" } });
    const out = await setPartnerCustomerPlan("partner_1", "c1", "pp_1");
    expect(deps.tenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: { planId: "base_pro" } }),
    );
    expect(out.planName).toBe("Pro");
  });

  it("clears the plan when passed null", async () => {
    deps.tenantFindFirst.mockResolvedValue({ id: "c1", status: "ACTIVE" });
    deps.tenantUpdate.mockResolvedValue({ plan: null });
    const out = await setPartnerCustomerPlan("partner_1", "c1", null);
    expect(deps.tenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { planId: null } }),
    );
    expect(out.planName).toBeNull();
    expect(deps.partnerPlanFindFirst).not.toHaveBeenCalled();
  });
});

describe("getPartnerCustomerDetail", () => {
  it("404s (and never reads payments) when the customer isn't the partner's child", async () => {
    deps.tenantFindFirst.mockResolvedValue(null);
    await expect(getPartnerCustomerDetail("partner_1", "other")).rejects.toThrow(/not found/i);
    expect(deps.tenantFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "other", parentTenantId: "partner_1" } }),
    );
    expect(deps.paymentFindMany).not.toHaveBeenCalled();
  });

  it("returns detail with balance and CAPTURED-only per-currency totals", async () => {
    deps.tenantFindFirst.mockResolvedValue({
      id: "c1",
      name: "Acme",
      slug: "acme",
      status: "ACTIVE",
      createdAt: new Date(),
      plan: { name: "Pro" },
      wallets: [{ balanceCredits: 500 }],
      _count: { users: 2, gmbLocations: 1 },
    });
    deps.paymentFindMany.mockResolvedValue([
      { id: "p1", provider: "RAZORPAY", credits: 500, amountMinor: 50000, currency: "INR", status: "CAPTURED", createdAt: new Date() },
      { id: "p2", provider: "RAZORPAY", credits: 100, amountMinor: 10000, currency: "INR", status: "REFUNDED", createdAt: new Date() },
    ]);
    const d = await getPartnerCustomerDetail("partner_1", "c1");
    expect(d.creditBalance).toBe(500);
    expect(d.planName).toBe("Pro");
    expect(d.users).toBe(2);
    expect(d.payments).toHaveLength(2); // all listed
    expect(d.collectedByCurrency).toEqual({ INR: 50000 }); // refund excluded
  });
});
