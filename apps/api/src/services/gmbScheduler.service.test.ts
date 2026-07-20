import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  postFindMany: vi.fn(),
  postUpdateMany: vi.fn(),
  locationFindFirst: vi.fn(),
  createGoogleLocalPost: vi.fn(),
  ensureBrandedPostMedia: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      gmbPost: {
        findMany: deps.postFindMany,
        updateMany: deps.postUpdateMany,
      },
      gmbLocation: {
        findFirst: deps.locationFindFirst,
      },
    },
  };
});

vi.mock("./gmbGoogle.service", () => ({
  createGoogleLocalPost: deps.createGoogleLocalPost,
}));

vi.mock("./gmbBrandedImage.service", () => ({
  ensureBrandedPostMedia: deps.ensureBrandedPostMedia,
}));

import { GmbPostStatus } from "@nexaflow/db";
import { publishDuePosts, selectDuePosts } from "./gmbScheduler.service";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("selectDuePosts", () => {
  it("selects only SCHEDULED posts whose scheduledAt is at or before now", () => {
    const posts = [
      { id: "due", status: GmbPostStatus.SCHEDULED, scheduledAt: "2026-06-10T11:00:00Z" },
      { id: "exactly-now", status: GmbPostStatus.SCHEDULED, scheduledAt: NOW },
      { id: "future", status: GmbPostStatus.SCHEDULED, scheduledAt: "2026-06-11T00:00:00Z" },
      { id: "draft", status: GmbPostStatus.DRAFT, scheduledAt: "2026-06-01T00:00:00Z" },
      { id: "no-date", status: GmbPostStatus.SCHEDULED, scheduledAt: null },
      { id: "published", status: GmbPostStatus.PUBLISHED, scheduledAt: "2026-06-01T00:00:00Z" },
    ];
    const due = selectDuePosts(posts, NOW).map((p) => p.id);
    expect(due).toEqual(["due", "exactly-now"]);
  });

  it("returns an empty array when nothing is due", () => {
    const posts = [
      { id: "future", status: GmbPostStatus.SCHEDULED, scheduledAt: "2026-12-01T00:00:00Z" },
    ];
    expect(selectDuePosts(posts, NOW)).toEqual([]);
  });
});

describe("publishDuePosts branded media integration", () => {
  const duePost = {
    id: "post-1",
    summary: "Hello Google",
    mediaUrl: null,
    callToActionType: "BOOK",
    callToActionUrl: "https://example.com/book",
    locationLabel: "Main salon",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    deps.postFindMany.mockResolvedValue([duePost]);
    deps.locationFindFirst.mockResolvedValue({
      id: "location-1",
      placeId: "accounts/1/locations/2",
      secretId: "secret-1",
    });
    deps.ensureBrandedPostMedia.mockResolvedValue(
      "https://media.example.com/gmb/post.png",
    );
    deps.createGoogleLocalPost.mockResolvedValue({ name: "localPosts/1" });
    deps.postUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("persists a branded image before sending it to Google", async () => {
    await expect(publishDuePosts("tenant-1", NOW)).resolves.toMatchObject({
      published: 1,
      live: 1,
      failed: 0,
    });

    expect(deps.ensureBrandedPostMedia).toHaveBeenCalledWith("tenant-1", "post-1");
    expect(deps.createGoogleLocalPost).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        locationId: "location-1",
        mediaUrl: "https://media.example.com/gmb/post.png",
      }),
    );
    expect(deps.postUpdateMany).toHaveBeenCalledWith({
      where: { id: "post-1", tenantId: "tenant-1" },
      data: { status: GmbPostStatus.PUBLISHED, publishedAt: NOW, error: null },
    });
  });

  it("reuses existing media without rasterizing again", async () => {
    deps.postFindMany.mockResolvedValue([
      { ...duePost, mediaUrl: "https://cdn.example.com/manual.png" },
    ]);
    await publishDuePosts("tenant-1", NOW);
    expect(deps.ensureBrandedPostMedia).not.toHaveBeenCalled();
    expect(deps.createGoogleLocalPost).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrl: "https://cdn.example.com/manual.png" }),
    );
  });

  it("marks the owned post failed and never calls Google when rendering fails", async () => {
    deps.ensureBrandedPostMedia.mockRejectedValue(new Error("S3 unavailable"));
    await expect(publishDuePosts("tenant-1", NOW)).resolves.toMatchObject({
      published: 0,
      live: 0,
      failed: 1,
    });
    expect(deps.createGoogleLocalPost).not.toHaveBeenCalled();
    expect(deps.postUpdateMany).toHaveBeenCalledWith({
      where: { id: "post-1", tenantId: "tenant-1" },
      data: { status: GmbPostStatus.FAILED, error: "S3 unavailable" },
    });
  });

  it("keeps unconnected locations local-only without requiring object storage", async () => {
    deps.locationFindFirst.mockResolvedValue(null);
    await expect(publishDuePosts("tenant-1", NOW)).resolves.toMatchObject({
      localOnly: 1,
      live: 0,
    });
    expect(deps.ensureBrandedPostMedia).not.toHaveBeenCalled();
    expect(deps.createGoogleLocalPost).not.toHaveBeenCalled();
  });
});
