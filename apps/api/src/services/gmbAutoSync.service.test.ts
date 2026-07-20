// GMB auto-sync worker — sweep resilience (per-location failures don't
// stall the fleet) and lastSyncedAt stamping.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  // Pacing knobs are read at module load — zero them before the import so
  // tests never sleep, and use a tiny quota-abort cap we can hit in a test.
  process.env.GMB_AUTO_SYNC_LOCATION_SPACING_MS = "0";
  process.env.GMB_AUTO_SYNC_QUOTA_BACKOFF_BASE_MS = "0";
  process.env.GMB_AUTO_SYNC_QUOTA_BACKOFF_CAP_MS = "0";
  process.env.GMB_AUTO_SYNC_MAX_QUOTA_HITS = "2";
  return {
    locationFindMany: vi.fn(),
    locationUpdate: vi.fn(),
    syncReviews: vi.fn(),
    syncInsights: vi.fn(),
  };
});

vi.mock("@nexaflow/db", () => ({
  prisma: {
    gmbLocation: {
      findMany: mocks.locationFindMany,
      update: mocks.locationUpdate,
    },
    $queryRaw: vi.fn(),
  },
  GmbLocationStatus: { CONNECTED: "CONNECTED" },
}));
vi.mock("../lib/queue", () => ({
  getQueueConnection: vi.fn(),
  getGmbPostPublisherQueue: vi.fn(),
  trackWorker: vi.fn(),
}));
vi.mock("./gmbGoogle.service", () => ({
  syncGoogleReviewsForLocation: mocks.syncReviews,
  syncGoogleInsightsForLocation: mocks.syncInsights,
}));

import {
  computeQuotaBackoffMs,
  isQuotaError,
  sweepGmbAutoSync,
} from "./gmbAutoSync.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locationUpdate.mockResolvedValue({});
  mocks.syncReviews.mockResolvedValue({ imported: 1, updated: 0 });
  mocks.syncInsights.mockResolvedValue({ mapsViews: 10 });
});

describe("sweepGmbAutoSync", () => {
  it("syncs reviews + insights for every connected location", async () => {
    mocks.locationFindMany.mockResolvedValue([
      { id: "loc-1", tenantId: "t1" },
      { id: "loc-2", tenantId: "t2" },
    ]);

    const summary = await sweepGmbAutoSync();

    expect(summary).toEqual({
      locations: 2,
      reviewsSynced: 2,
      insightsSynced: 2,
      failed: 0,
      quotaHits: 0,
      aborted: false,
    });
    expect(mocks.syncReviews).toHaveBeenCalledWith("t1", "loc-1");
    expect(mocks.syncInsights).toHaveBeenCalledWith("t2", "loc-2");
    // Success stamps lastSyncedAt.
    expect(mocks.locationUpdate).toHaveBeenCalledTimes(2);
  });

  it("continues past a failing location", async () => {
    mocks.locationFindMany.mockResolvedValue([
      { id: "loc-bad", tenantId: "t1" },
      { id: "loc-good", tenantId: "t1" },
    ]);
    mocks.syncReviews
      .mockRejectedValueOnce(new Error("invalid_grant"))
      .mockResolvedValueOnce({ imported: 0, updated: 3 });
    mocks.syncInsights
      .mockRejectedValueOnce(new Error("invalid_grant"))
      .mockResolvedValueOnce({ mapsViews: 5 });

    const summary = await sweepGmbAutoSync();

    expect(summary.failed).toBe(1);
    expect(summary.reviewsSynced).toBe(1);
    expect(summary.insightsSynced).toBe(1);
    // Only the good location gets stamped.
    expect(mocks.locationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.locationUpdate.mock.calls[0][0].where).toEqual({
      id: "loc-good",
    });
  });

  it("only targets connected locations with credentials", async () => {
    mocks.locationFindMany.mockResolvedValue([]);
    await sweepGmbAutoSync();
    expect(mocks.locationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "CONNECTED",
          secretId: { not: null },
          placeId: { not: null },
        },
      }),
    );
  });

  it("counts quota hits and aborts the sweep once quota keeps failing", async () => {
    // MAX_QUOTA_HITS is 2 in this test env. Four locations, all 429ing —
    // the sweep must stop after the second consecutive quota hit and never
    // touch locations 3-4.
    mocks.locationFindMany.mockResolvedValue([
      { id: "loc-1", tenantId: "t1" },
      { id: "loc-2", tenantId: "t1" },
      { id: "loc-3", tenantId: "t1" },
      { id: "loc-4", tenantId: "t1" },
    ]);
    mocks.syncReviews.mockRejectedValue(new Error("429 RESOURCE_EXHAUSTED"));
    mocks.syncInsights.mockRejectedValue(new Error("429 RESOURCE_EXHAUSTED"));

    const summary = await sweepGmbAutoSync();

    expect(summary.aborted).toBe(true);
    expect(summary.quotaHits).toBe(2);
    // Two locations attempted (2 sync calls each), then abort.
    expect(mocks.syncReviews).toHaveBeenCalledTimes(2);
  });

  it("a non-quota failure resets the consecutive counter (no abort)", async () => {
    mocks.locationFindMany.mockResolvedValue([
      { id: "loc-1", tenantId: "t1" },
      { id: "loc-2", tenantId: "t1" },
      { id: "loc-3", tenantId: "t1" },
    ]);
    // loc-1 quota-fails, loc-2 fails with a credential error, loc-3 quota-fails
    // again — never two CONSECUTIVE quota hits, so the sweep completes.
    mocks.syncReviews
      .mockRejectedValueOnce(new Error("429 RESOURCE_EXHAUSTED"))
      .mockRejectedValueOnce(new Error("invalid_grant"))
      .mockRejectedValueOnce(new Error("quota exceeded"));
    mocks.syncInsights
      .mockRejectedValueOnce(new Error("429 RESOURCE_EXHAUSTED"))
      .mockRejectedValueOnce(new Error("invalid_grant"))
      .mockRejectedValueOnce(new Error("quota exceeded"));

    const summary = await sweepGmbAutoSync();

    expect(summary.aborted).toBe(false);
    expect(summary.quotaHits).toBe(2);
    expect(summary.failed).toBe(3);
    expect(mocks.syncReviews).toHaveBeenCalledTimes(3);
  });
});

describe("isQuotaError", () => {
  it.each([
    ["Google API 429 Too Many Requests", true],
    ["RESOURCE_EXHAUSTED: Quota exceeded", true],
    ["rate limit reached", true],
    ["Quota exceeded for quota metric", true],
    ["invalid_grant", false],
    ["fetch failed", false],
  ])("%s → %s", (msg, expected) => {
    expect(isQuotaError(new Error(msg))).toBe(expected);
  });

  it("handles non-Error values safely", () => {
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError("429")).toBe(true);
  });
});

describe("computeQuotaBackoffMs", () => {
  const noJitter = { baseMs: 1000, capMs: 8000, jitter: () => 0.5 }; // 0.5 → ×1.0

  it("doubles per consecutive hit", () => {
    expect(computeQuotaBackoffMs(1, noJitter)).toBe(1000);
    expect(computeQuotaBackoffMs(2, noJitter)).toBe(2000);
    expect(computeQuotaBackoffMs(3, noJitter)).toBe(4000);
  });

  it("caps at capMs", () => {
    expect(computeQuotaBackoffMs(10, noJitter)).toBe(8000);
  });

  it("applies ±20% jitter", () => {
    expect(computeQuotaBackoffMs(1, { ...noJitter, jitter: () => 0 })).toBe(800);
    expect(computeQuotaBackoffMs(1, { ...noJitter, jitter: () => 1 })).toBe(1200);
  });
});
