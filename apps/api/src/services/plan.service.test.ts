import { afterEach, describe, expect, it, vi } from "vitest";

// Plan entitlement limits must actually block over-quota creation (null = unlimited).

const deps = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  keywordCount: vi.fn(),
  userCount: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      tenant: { findUnique: deps.tenantFindUnique },
      gmbTrackedKeyword: { count: deps.keywordCount },
      user: { count: deps.userCount },
    },
  };
});

import { assertWithinKeywordLimit, assertWithinUserLimit } from "./plan.service";

afterEach(() => vi.clearAllMocks());

describe("assertWithinKeywordLimit", () => {
  it("is unlimited (no count query) when the plan or maxKeywords is null", async () => {
    deps.tenantFindUnique.mockResolvedValue({ plan: null });
    await expect(assertWithinKeywordLimit("t1")).resolves.toBeUndefined();
    deps.tenantFindUnique.mockResolvedValue({ plan: { name: "Pro", maxKeywords: null } });
    await expect(assertWithinKeywordLimit("t1")).resolves.toBeUndefined();
    expect(deps.keywordCount).not.toHaveBeenCalled();
  });

  it("allows adding when under the limit", async () => {
    deps.tenantFindUnique.mockResolvedValue({ plan: { name: "Starter", maxKeywords: 10 } });
    deps.keywordCount.mockResolvedValue(9);
    await expect(assertWithinKeywordLimit("t1")).resolves.toBeUndefined();
  });

  it("blocks with 403 at or over the limit", async () => {
    deps.tenantFindUnique.mockResolvedValue({ plan: { name: "Starter", maxKeywords: 10 } });
    deps.keywordCount.mockResolvedValue(10);
    await expect(assertWithinKeywordLimit("t1")).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("assertWithinUserLimit", () => {
  it("is unlimited when maxUsers is null", async () => {
    deps.tenantFindUnique.mockResolvedValue({ plan: { name: "Pro", maxUsers: null } });
    await expect(assertWithinUserLimit("t1")).resolves.toBeUndefined();
    expect(deps.userCount).not.toHaveBeenCalled();
  });

  it("blocks with 403 at or over the limit", async () => {
    deps.tenantFindUnique.mockResolvedValue({ plan: { name: "Team", maxUsers: 3 } });
    deps.userCount.mockResolvedValue(3);
    await expect(assertWithinUserLimit("t1")).rejects.toMatchObject({ statusCode: 403 });
  });
});
