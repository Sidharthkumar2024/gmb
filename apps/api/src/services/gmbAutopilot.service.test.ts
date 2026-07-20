import { beforeEach, describe, expect, it, vi } from "vitest";
import { GmbPostStatus, GmbPostType } from "@nexaflow/db";

const mocks = vi.hoisted(() => ({
  postCreate: vi.fn(),
  postFindFirst: vi.fn(),
  postUpdate: vi.fn(),
  reviewFindMany: vi.fn(),
  reviewUpdate: vi.fn(),
  locationFindFirst: vi.fn(),
  draftGmbCaption: vi.fn(),
  draftReviewReplyWithAi: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      gmbPost: { create: mocks.postCreate, findFirst: mocks.postFindFirst, update: mocks.postUpdate },
      gmbReview: { findMany: mocks.reviewFindMany, update: mocks.reviewUpdate },
      gmbLocation: { findFirst: mocks.locationFindFirst },
    },
  };
});
vi.mock("./gmb.service", () => ({
  draftGmbCaption: mocks.draftGmbCaption,
  toSafeGmbPost: (row: unknown) => row,
}));
vi.mock("./gmbReview.service", () => ({ draftReviewReplyWithAi: mocks.draftReviewReplyWithAi }));

import { draftAutopilotPosts, approvePost, draftPendingReviewReplies } from "./gmbAutopilot.service";

beforeEach(() => {
  Object.values(mocks).forEach((m) => (m as ReturnType<typeof vi.fn>).mockReset());
  mocks.draftGmbCaption.mockImplementation(async (_t: string, input: { type: GmbPostType }) => ({
    type: input.type,
    summary: `caption for ${input.type}`,
    callToActionType: "LEARN_MORE",
    source: "template",
  }));
  mocks.postCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "p", ...data }));
});

describe("draftAutopilotPosts", () => {
  it("drafts `count` posts, all PENDING_APPROVAL", async () => {
    const posts = await draftAutopilotPosts("t1", { businessName: "Acme", count: 3 });
    expect(posts).toHaveLength(3);
    expect(mocks.postCreate).toHaveBeenCalledTimes(3);
    for (const call of mocks.postCreate.mock.calls) {
      expect(call[0].data.status).toBe(GmbPostStatus.PENDING_APPROVAL);
    }
  });

  it("varies post types across the batch (not all the same)", async () => {
    await draftAutopilotPosts("t1", { businessName: "Acme", count: 5 });
    const types = mocks.postCreate.mock.calls.map((c) => c[0].data.type);
    expect(new Set(types).size).toBeGreaterThan(1);
  });

  it("clamps count to a sane range", async () => {
    const posts = await draftAutopilotPosts("t1", { businessName: "Acme", count: 999 });
    expect(posts.length).toBeLessThanOrEqual(14);
  });
});

describe("approvePost", () => {
  it("schedules when a time is given", async () => {
    mocks.postFindFirst.mockResolvedValue({ id: "p1", status: GmbPostStatus.PENDING_APPROVAL });
    mocks.postUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "p1", ...data }));
    await approvePost("t1", "p1", { scheduledAt: "2026-08-01T10:00:00.000Z" });
    expect(mocks.postUpdate.mock.calls[0][0].data.status).toBe(GmbPostStatus.SCHEDULED);
  });

  it("moves to DRAFT when no time is given", async () => {
    mocks.postFindFirst.mockResolvedValue({ id: "p1", status: GmbPostStatus.PENDING_APPROVAL });
    mocks.postUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "p1", ...data }));
    await approvePost("t1", "p1", {});
    expect(mocks.postUpdate.mock.calls[0][0].data.status).toBe(GmbPostStatus.DRAFT);
  });

  it("rejects approving an already-published post", async () => {
    mocks.postFindFirst.mockResolvedValue({ id: "p1", status: GmbPostStatus.PUBLISHED });
    await expect(approvePost("t1", "p1", {})).rejects.toThrow(/pending or draft/i);
  });
});

describe("draftPendingReviewReplies", () => {
  it("drafts a reply per un-answered review, keeping it NEW (awaiting approval)", async () => {
    mocks.reviewFindMany.mockResolvedValue([
      { id: "r1", locationId: "loc1", rating: 5, authorName: "A", comment: "great" },
      { id: "r2", locationId: "loc1", rating: 2, authorName: "B", comment: "meh" },
    ]);
    mocks.locationFindFirst.mockResolvedValue({ name: "Acme Salon" });
    mocks.draftReviewReplyWithAi.mockResolvedValue({ reply: "Thanks!", sentiment: "positive", source: "template" });

    const result = await draftPendingReviewReplies("t1", {});
    expect(result).toEqual({ drafted: 2, scanned: 2 });
    // Only replyText is written — status is NOT flipped to REPLIED here.
    for (const call of mocks.reviewUpdate.mock.calls) {
      expect(call[0].data).toEqual({ replyText: "Thanks!" });
    }
    // Location name is cached — one lookup for two same-location reviews.
    expect(mocks.locationFindFirst).toHaveBeenCalledTimes(1);
  });
});
