import { afterEach, describe, expect, it, vi } from "vitest";

// Mocked-Prisma unit tests for partner resale plans. The two things that must
// hold: margin is derived (retail − wholesale, not stored), and every mutation
// is scoped to the caller's partner tenant (a partner can't touch another's).

const deps = vi.hoisted(() => ({
  planFindMany: vi.fn(),
  planFindUnique: vi.fn(),
  partnerPlanFindMany: vi.fn(),
  partnerPlanFindFirst: vi.fn(),
  partnerPlanCreate: vi.fn(),
  partnerPlanUpdate: vi.fn(),
  partnerPlanDelete: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      plan: { findMany: deps.planFindMany, findUnique: deps.planFindUnique },
      partnerPlan: {
        findMany: deps.partnerPlanFindMany,
        findFirst: deps.partnerPlanFindFirst,
        create: deps.partnerPlanCreate,
        update: deps.partnerPlanUpdate,
        delete: deps.partnerPlanDelete,
      },
    },
  };
});

import {
  listPartnerPlans,
  createPartnerPlan,
  updatePartnerPlan,
  deletePartnerPlan,
} from "./partnerPlan.service";

const activeBase = {
  id: "plan_starter",
  name: "Starter",
  priceCents: 1500,
  currency: "USD",
  monthlyCredits: 100,
  status: "ACTIVE",
};

const storedPlan = {
  id: "pp_1",
  name: "Local Growth",
  status: "ACTIVE",
  retailCents: 2500,
  currency: "USD",
  sortOrder: 100,
  createdAt: new Date("2026-07-01"),
  basePlan: activeBase,
};

afterEach(() => vi.clearAllMocks());

describe("listPartnerPlans", () => {
  it("derives margin = retail − wholesale from the base plan's current price", async () => {
    deps.partnerPlanFindMany.mockResolvedValue([storedPlan]);
    const [view] = await listPartnerPlans("partner_1");
    expect(view.marginCents).toBe(1000); // 2500 − 1500
    expect(view.basePlan.wholesaleCents).toBe(1500);
    // scoped to the partner
    expect(deps.partnerPlanFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerTenantId: "partner_1" } }),
    );
  });
});

describe("createPartnerPlan", () => {
  it("rejects a base plan that isn't active", async () => {
    deps.planFindUnique.mockResolvedValue({ ...activeBase, status: "ARCHIVED" });
    await expect(
      createPartnerPlan("partner_1", { name: "X", basePlanId: "plan_starter", retailCents: 2500 }),
    ).rejects.toThrow(/active platform plan/i);
    expect(deps.partnerPlanCreate).not.toHaveBeenCalled();
  });

  it("inherits currency from the base plan", async () => {
    deps.planFindUnique.mockResolvedValue({ ...activeBase, currency: "INR" });
    deps.partnerPlanCreate.mockResolvedValue({ ...storedPlan, currency: "INR", basePlan: { ...activeBase, currency: "INR" } });
    await createPartnerPlan("partner_1", { name: "X", basePlanId: "plan_starter", retailCents: 2500 });
    expect(deps.partnerPlanCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: "INR", partnerTenantId: "partner_1" }) }),
    );
  });
});

describe("ownership scoping", () => {
  it("update throws NOT_FOUND when the plan isn't the partner's", async () => {
    deps.partnerPlanFindFirst.mockResolvedValue(null);
    await expect(
      updatePartnerPlan("partner_1", "pp_other", { name: "X", basePlanId: "plan_starter", retailCents: 1 }),
    ).rejects.toThrow(/not found/i);
    expect(deps.partnerPlanFindFirst).toHaveBeenCalledWith({
      where: { id: "pp_other", partnerTenantId: "partner_1" },
    });
    expect(deps.partnerPlanUpdate).not.toHaveBeenCalled();
  });

  it("delete throws NOT_FOUND when the plan isn't the partner's", async () => {
    deps.partnerPlanFindFirst.mockResolvedValue(null);
    await expect(deletePartnerPlan("partner_1", "pp_other")).rejects.toThrow(/not found/i);
    expect(deps.partnerPlanDelete).not.toHaveBeenCalled();
  });
});
