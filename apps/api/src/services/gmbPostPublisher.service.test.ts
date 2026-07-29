import { afterEach, describe, expect, it, vi } from "vitest";

// The scheduled-post sweep must be resilient: it aggregates per-tenant publish
// results, and one tenant's failure is logged and skipped rather than aborting
// the whole sweep.

const deps = vi.hoisted(() => ({ findMany: vi.fn(), publishDuePosts: vi.fn() }));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return { ...actual, prisma: { gmbPost: { findMany: deps.findMany } } };
});

vi.mock("./gmbScheduler.service", () => ({ publishDuePosts: deps.publishDuePosts }));

// Stub the queue lib so importing the worker module has no Redis side effects.
vi.mock("../lib/queue", () => ({
  getQueueConnection: vi.fn(),
  getGmbPostPublisherQueue: vi.fn(),
  QueueNames: { GMB_POST_PUBLISHER: "gmb-post-publisher" },
  trackWorker: vi.fn(),
}));

import { sweepDueGmbPosts } from "./gmbPostPublisher.service";

const zero = { published: 0, live: 0, localOnly: 0, failed: 0 };

afterEach(() => vi.clearAllMocks());

describe("sweepDueGmbPosts", () => {
  it("returns all-zeros when no tenant has due posts", async () => {
    deps.findMany.mockResolvedValue([]);
    expect(await sweepDueGmbPosts()).toEqual({ tenants: 0, ...zero });
    expect(deps.publishDuePosts).not.toHaveBeenCalled();
  });

  it("aggregates publish results across tenants", async () => {
    deps.findMany.mockResolvedValue([{ tenantId: "t1" }, { tenantId: "t2" }]);
    deps.publishDuePosts
      .mockResolvedValueOnce({ published: 2, live: 1, localOnly: 1, failed: 0 })
      .mockResolvedValueOnce({ published: 3, live: 0, localOnly: 2, failed: 1 });
    const r = await sweepDueGmbPosts();
    expect(r).toEqual({ tenants: 2, published: 5, live: 1, localOnly: 3, failed: 1 });
  });

  it("skips a failing tenant and still processes the rest", async () => {
    deps.findMany.mockResolvedValue([{ tenantId: "bad" }, { tenantId: "good" }]);
    deps.publishDuePosts
      .mockRejectedValueOnce(new Error("tenant blew up"))
      .mockResolvedValueOnce({ published: 1, live: 1, localOnly: 0, failed: 0 });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sweepDueGmbPosts();
    // Only the successful tenant is counted; the failure didn't abort the sweep.
    expect(r).toEqual({ tenants: 1, published: 1, live: 1, localOnly: 0, failed: 0 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("queries only SCHEDULED posts due on or before now, one row per tenant", async () => {
    deps.findMany.mockResolvedValue([]);
    const now = new Date("2026-06-01T00:00:00Z");
    await sweepDueGmbPosts(now);
    const arg = deps.findMany.mock.calls[0][0];
    expect(arg.where.scheduledAt).toEqual({ lte: now });
    expect(arg.distinct).toEqual(["tenantId"]);
  });
});
