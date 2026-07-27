import { afterEach, describe, expect, it, vi } from "vitest";

// The security-critical guarantee for partner customer management: a partner can
// only suspend/reactivate or re-plan a customer that is ITS OWN child tenant.
// The ownership check scopes every mutation by { id, parentTenantId }.

const deps = vi.hoisted(() => ({
  tenantFindFirst: vi.fn(),
  tenantUpdate: vi.fn(),
  partnerPlanFindFirst: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      tenant: { findFirst: deps.tenantFindFirst, update: deps.tenantUpdate },
      partnerPlan: { findFirst: deps.partnerPlanFindFirst },
    },
  };
});

import { setPartnerCustomerStatus, setPartnerCustomerPlan } from "./partner.service";

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
