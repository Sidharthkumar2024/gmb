import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configFindMany: vi.fn(),
  configUpdate: vi.fn(),
  draftAutopilotPosts: vi.fn(),
  draftPendingReviewReplies: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    gmbAutopilotConfig: { findMany: mocks.configFindMany, update: mocks.configUpdate },
  },
}));
vi.mock("./gmbAutopilot.service", () => ({
  draftAutopilotPosts: mocks.draftAutopilotPosts,
  draftPendingReviewReplies: mocks.draftPendingReviewReplies,
}));
// The worker imports bullmq + queue; stub the queue module so importing the
// service under test doesn't spin up Redis.
vi.mock("../lib/queue", () => ({
  getQueueConnection: () => ({}),
  getGmbAutopilotQueue: () => ({}),
  QueueNames: { GMB_AUTOPILOT: "gmb-autopilot" },
  trackWorker: () => undefined,
}));

import {
  isAutopilotDue,
  computeNextRunAt,
  sweepGmbAutopilot,
} from "./gmbAutopilotScheduler.service";

const NOW = new Date("2026-07-11T12:00:00.000Z");

describe("isAutopilotDue", () => {
  it("is due when never run", () => {
    expect(isAutopilotDue(NOW, 168, null)).toBe(true);
  });
  it("is not due before the cadence elapses", () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(isAutopilotDue(NOW, 24, oneHourAgo)).toBe(false);
  });
  it("is due once the cadence elapses", () => {
    const twoDaysAgo = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
    expect(isAutopilotDue(NOW, 24, twoDaysAgo)).toBe(true);
  });
});

describe("computeNextRunAt", () => {
  it("has no next run when disabled", () => {
    expect(computeNextRunAt(false, 24, null, NOW)).toBeNull();
    expect(computeNextRunAt(false, 24, new Date(NOW.getTime() - 1000), NOW)).toBeNull();
  });
  it("is due now when enabled but never run", () => {
    expect(computeNextRunAt(true, 168, null, NOW)).toEqual(NOW);
  });
  it("schedules one cadence after the last run when that is still future", () => {
    const sixHoursAgo = new Date(NOW.getTime() - 6 * 60 * 60 * 1000);
    // cadence 24h → next = lastRun + 24h = 18h from NOW
    expect(computeNextRunAt(true, 24, sixHoursAgo, NOW)).toEqual(
      new Date(sixHoursAgo.getTime() + 24 * 60 * 60 * 1000),
    );
  });
  it("clamps an overdue next run to now", () => {
    const twoDaysAgo = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
    expect(computeNextRunAt(true, 24, twoDaysAgo, NOW)).toEqual(NOW);
  });
});

describe("sweepGmbAutopilot", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => (m as ReturnType<typeof vi.fn>).mockReset());
    mocks.draftAutopilotPosts.mockResolvedValue([{ id: "p1" }, { id: "p2" }, { id: "p3" }]);
    mocks.draftPendingReviewReplies.mockResolvedValue({ drafted: 2, scanned: 2 });
    mocks.configUpdate.mockResolvedValue({});
  });

  it("drafts posts + replies for a due tenant and stamps lastRunAt", async () => {
    mocks.configFindMany.mockResolvedValue([
      { tenantId: "t1", businessName: "Acme", niche: "salon", tone: "friendly", postsPerRun: 3, cadenceHours: 24, autoDraftReplies: true, replyTone: "warm", lastRunAt: null },
    ]);
    const s = await sweepGmbAutopilot(NOW);
    expect(s).toEqual({ due: 1, postsDrafted: 3, repliesDrafted: 2, failed: 0 });
    expect(mocks.draftAutopilotPosts).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ businessName: "Acme", niche: "salon", count: 3 }),
    );
    expect(mocks.configUpdate).toHaveBeenCalledWith({ where: { tenantId: "t1" }, data: { lastRunAt: NOW } });
  });

  it("skips tenants whose cadence hasn't elapsed", async () => {
    mocks.configFindMany.mockResolvedValue([
      { tenantId: "t1", businessName: "Acme", niche: "general", tone: "friendly", postsPerRun: 3, cadenceHours: 168, autoDraftReplies: false, replyTone: "warm", lastRunAt: new Date(NOW.getTime() - 60 * 60 * 1000) },
    ]);
    const s = await sweepGmbAutopilot(NOW);
    expect(s.due).toBe(0);
    expect(mocks.draftAutopilotPosts).not.toHaveBeenCalled();
    expect(mocks.configUpdate).not.toHaveBeenCalled();
  });

  it("skips review drafting when autoDraftReplies is off", async () => {
    mocks.configFindMany.mockResolvedValue([
      { tenantId: "t1", businessName: "Acme", niche: "general", tone: "friendly", postsPerRun: 2, cadenceHours: 24, autoDraftReplies: false, replyTone: "warm", lastRunAt: null },
    ]);
    const s = await sweepGmbAutopilot(NOW);
    expect(s.repliesDrafted).toBe(0);
    expect(mocks.draftPendingReviewReplies).not.toHaveBeenCalled();
  });

  it("counts a tenant failure without aborting the sweep", async () => {
    mocks.configFindMany.mockResolvedValue([
      { tenantId: "t1", businessName: "A", niche: "general", tone: "friendly", postsPerRun: 2, cadenceHours: 24, autoDraftReplies: false, replyTone: "warm", lastRunAt: null },
      { tenantId: "t2", businessName: "B", niche: "general", tone: "friendly", postsPerRun: 2, cadenceHours: 24, autoDraftReplies: false, replyTone: "warm", lastRunAt: null },
    ]);
    mocks.draftAutopilotPosts.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([{ id: "p" }]);
    const s = await sweepGmbAutopilot(NOW);
    expect(s.due).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.postsDrafted).toBe(1);
  });
});
