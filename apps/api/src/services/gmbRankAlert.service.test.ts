import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ruleFindMany: vi.fn(),
  ruleFindFirst: vi.fn(),
  ruleCount: vi.fn(),
  ruleCreate: vi.fn(),
  ruleUpdate: vi.fn(),
  ruleDelete: vi.fn(),
  keywordFindFirst: vi.fn(),
  keywordFindUnique: vi.fn(),
  snapshotFindMany: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    gmbRankAlertRule: {
      findMany: mocks.ruleFindMany,
      findFirst: mocks.ruleFindFirst,
      count: mocks.ruleCount,
      create: mocks.ruleCreate,
      update: mocks.ruleUpdate,
      delete: mocks.ruleDelete,
    },
    gmbTrackedKeyword: {
      findFirst: mocks.keywordFindFirst,
      findUnique: mocks.keywordFindUnique,
    },
    gmbRankSnapshot: { findMany: mocks.snapshotFindMany },
  },
}));

vi.mock("./email.service", () => ({
  sendEmail: mocks.sendEmail,
}));

import {
  createRankAlertRule,
  deleteRankAlertRule,
  evaluateRankAlerts,
  shouldTriggerRankAlert,
} from "./gmbRankAlert.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shouldTriggerRankAlert (pure crossing semantics)", () => {
  const T = 10;

  it("fires when the rank crosses from OK to worse than the threshold", () => {
    expect(
      shouldTriggerRankAlert({ previousRank: 5, currentRank: 14, thresholdRank: T }),
    ).toBe(true);
  });

  it("fires when the business drops out of the results entirely (null)", () => {
    expect(
      shouldTriggerRankAlert({ previousRank: 8, currentRank: null, thresholdRank: T }),
    ).toBe(true);
  });

  it("does NOT fire while the rank stays bad (no repeat alerts)", () => {
    expect(
      shouldTriggerRankAlert({ previousRank: 15, currentRank: 20, thresholdRank: T }),
    ).toBe(false);
  });

  it("does NOT fire on the first-ever check (no baseline to drop from)", () => {
    expect(
      shouldTriggerRankAlert({ previousRank: undefined, currentRank: 40, thresholdRank: T }),
    ).toBe(false);
  });

  it("does NOT fire when the rank is still within the threshold", () => {
    expect(
      shouldTriggerRankAlert({ previousRank: 3, currentRank: 10, thresholdRank: T }),
    ).toBe(false);
  });

  it("does NOT fire when previous was already not-found (null → null)", () => {
    expect(
      shouldTriggerRankAlert({ previousRank: null, currentRank: null, thresholdRank: T }),
    ).toBe(false);
  });

  it("re-arms after recovery: ok → bad fires again after a good check in between", () => {
    // drop
    expect(shouldTriggerRankAlert({ previousRank: 4, currentRank: 30, thresholdRank: T })).toBe(true);
    // recovered check — no fire
    expect(shouldTriggerRankAlert({ previousRank: 30, currentRank: 6, thresholdRank: T })).toBe(false);
    // second drop fires again
    expect(shouldTriggerRankAlert({ previousRank: 6, currentRank: 25, thresholdRank: T })).toBe(true);
  });

  it("fails safe on a nonsensical threshold", () => {
    expect(shouldTriggerRankAlert({ previousRank: 1, currentRank: null, thresholdRank: 0 })).toBe(false);
  });
});

describe("createRankAlertRule", () => {
  it("rejects a keyword that belongs to another tenant (404)", async () => {
    mocks.keywordFindFirst.mockResolvedValue(null);
    await expect(
      createRankAlertRule("t1", { keywordId: "kw_other", thresholdRank: 10 }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.ruleCreate).not.toHaveBeenCalled();
  });

  it("creates a tenant-scoped rule for an owned keyword", async () => {
    mocks.keywordFindFirst.mockResolvedValue({ id: "kw1" });
    mocks.ruleCount.mockResolvedValue(0);
    mocks.ruleCreate.mockResolvedValue({ id: "r1", keywordId: "kw1", thresholdRank: 10 });
    const rule = await createRankAlertRule("t1", { keywordId: "kw1", thresholdRank: 10 });
    expect(rule.id).toBe("r1");
    expect(mocks.keywordFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "kw1", tenantId: "t1" } }),
    );
    expect(mocks.ruleCreate.mock.calls[0][0].data.tenantId).toBe("t1");
  });

  it("enforces the per-tenant rule cap", async () => {
    mocks.keywordFindFirst.mockResolvedValue({ id: "kw1" });
    mocks.ruleCount.mockResolvedValue(100);
    await expect(
      createRankAlertRule("t1", { keywordId: "kw1", thresholdRank: 10 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("deleteRankAlertRule", () => {
  it("404s on a rule owned by another tenant", async () => {
    mocks.ruleFindFirst.mockResolvedValue(null);
    await expect(deleteRankAlertRule("t1", "r_other")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mocks.ruleDelete).not.toHaveBeenCalled();
  });
});

describe("evaluateRankAlerts", () => {
  it("stamps lastTriggered and emails on an OK→BAD crossing", async () => {
    mocks.ruleFindMany.mockResolvedValue([
      { id: "r1", thresholdRank: 10, notifyEmail: "owner@biz.test" },
    ]);
    mocks.snapshotFindMany.mockResolvedValue([{ rank: 4 }]); // previous was OK
    mocks.keywordFindUnique.mockResolvedValue({ keyword: "salon indiranagar" });
    mocks.ruleUpdate.mockResolvedValue({});

    await evaluateRankAlerts("t1", "kw1", 22);

    expect(mocks.ruleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r1" },
        data: expect.objectContaining({ lastTriggeredRank: 22 }),
      }),
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@biz.test" }),
    );
  });

  it("does nothing when the rank stays within the threshold", async () => {
    mocks.ruleFindMany.mockResolvedValue([
      { id: "r1", thresholdRank: 10, notifyEmail: null },
    ]);
    mocks.snapshotFindMany.mockResolvedValue([{ rank: 4 }]);

    await evaluateRankAlerts("t1", "kw1", 7);

    expect(mocks.ruleUpdate).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("skips the previous-snapshot lookup entirely when no active rules exist", async () => {
    mocks.ruleFindMany.mockResolvedValue([]);
    await evaluateRankAlerts("t1", "kw1", null);
    expect(mocks.snapshotFindMany).not.toHaveBeenCalled();
  });

  it("still records the trigger when the email send fails", async () => {
    mocks.ruleFindMany.mockResolvedValue([
      { id: "r1", thresholdRank: 5, notifyEmail: "owner@biz.test" },
    ]);
    mocks.snapshotFindMany.mockResolvedValue([{ rank: 2 }]);
    mocks.keywordFindUnique.mockResolvedValue({ keyword: "spa" });
    mocks.ruleUpdate.mockResolvedValue({});
    mocks.sendEmail.mockRejectedValue(new Error("smtp down"));

    await expect(evaluateRankAlerts("t1", "kw1", null)).resolves.toBeUndefined();
    expect(mocks.ruleUpdate).toHaveBeenCalled();
  });

  it("never throws even if the rule query itself fails", async () => {
    mocks.ruleFindMany.mockRejectedValue(new Error("db down"));
    await expect(evaluateRankAlerts("t1", "kw1", 50)).resolves.toBeUndefined();
  });
});
