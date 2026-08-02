import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleApiLogStatus } from "@nexaflow/db";

// Pure health derivation (connection state priority + log aggregation) plus the
// monitor overview that fuses locations with their recent-error counts.

const deps = vi.hoisted(() => ({
  logCreate: vi.fn(),
  logFindMany: vi.fn(),
  logGroupBy: vi.fn(),
  locFindMany: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      googleApiLog: { create: deps.logCreate, findMany: deps.logFindMany, groupBy: deps.logGroupBy },
      gmbLocation: { findMany: deps.locFindMany },
    },
  };
});

import {
  deriveConnectionState,
  getMonitorOverview,
  listLogs,
  recordLog,
  summarizeLogs,
} from "./googleApiMonitor.service";

const NOW = new Date("2026-06-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

afterEach(() => vi.clearAllMocks());

describe("deriveConnectionState", () => {
  it("prioritises DISCONNECTED — no credential wins over errors or a fresh sync", () => {
    expect(
      deriveConnectionState({ hasCredential: false, lastSyncedAt: NOW, recentErrorCount: 5, now: NOW }),
    ).toBe("DISCONNECTED");
  });

  it("reports ERROR when there are recent errors and a credential", () => {
    expect(
      deriveConnectionState({ hasCredential: true, lastSyncedAt: NOW, recentErrorCount: 1, now: NOW }),
    ).toBe("ERROR");
  });

  it("reports STALE when never synced or older than the stale window", () => {
    expect(deriveConnectionState({ hasCredential: true, lastSyncedAt: null, recentErrorCount: 0, now: NOW })).toBe("STALE");
    expect(
      deriveConnectionState({ hasCredential: true, lastSyncedAt: hoursAgo(25), recentErrorCount: 0, now: NOW }),
    ).toBe("STALE");
  });

  it("reports CONNECTED for a recent, error-free, credentialed sync", () => {
    expect(
      deriveConnectionState({ hasCredential: true, lastSyncedAt: hoursAgo(1), recentErrorCount: 0, now: NOW }),
    ).toBe("CONNECTED");
  });

  it("honours a custom stale window", () => {
    expect(
      deriveConnectionState({ hasCredential: true, lastSyncedAt: hoursAgo(2), recentErrorCount: 0, now: NOW, staleHours: 1 }),
    ).toBe("STALE");
  });
});

describe("summarizeLogs", () => {
  it("counts by status, computes the error rate, and tracks the last error time", () => {
    const s = summarizeLogs([
      { status: GoogleApiLogStatus.OK, createdAt: hoursAgo(5) },
      { status: GoogleApiLogStatus.OK, createdAt: hoursAgo(4) },
      { status: GoogleApiLogStatus.ERROR, createdAt: hoursAgo(3) },
      { status: GoogleApiLogStatus.RATE_LIMITED, createdAt: hoursAgo(1) },
    ]);
    expect(s).toMatchObject({ total: 4, ok: 2, errors: 1, rateLimited: 1, errorRate: 0.5 });
    expect(s.lastErrorAt).toEqual(hoursAgo(1)); // latest non-OK
  });

  it("returns zeros and a null lastErrorAt for an empty set", () => {
    expect(summarizeLogs([])).toEqual({ total: 0, ok: 0, errors: 0, rateLimited: 0, errorRate: 0, lastErrorAt: null });
  });
});

describe("recordLog", () => {
  it("defaults status to OK, trims the operation, and nulls optionals", async () => {
    deps.logCreate.mockResolvedValue({
      id: "l1", tenantId: "t1", locationId: null, operation: "sync", status: GoogleApiLogStatus.OK,
      statusCode: null, message: null, rateLimitRemaining: null, durationMs: null, createdAt: NOW,
    });
    await recordLog({ tenantId: "t1", operation: "  sync  " });
    const data = deps.logCreate.mock.calls[0][0].data;
    expect(data.operation).toBe("sync");
    expect(data.status).toBe(GoogleApiLogStatus.OK);
    expect(data.locationId).toBeNull();
  });
});

describe("listLogs", () => {
  it("clamps the limit to [1, 500]", async () => {
    deps.logFindMany.mockResolvedValue([]);
    await listLogs({ limit: 9999 });
    expect(deps.logFindMany.mock.calls[0][0].take).toBe(500);
    await listLogs({ limit: 0 });
    expect(deps.logFindMany.mock.calls[1][0].take).toBe(1);
  });
});

describe("getMonitorOverview", () => {
  it("fuses locations with recent-error counts into per-state totals", async () => {
    deps.locFindMany.mockResolvedValue([
      { id: "loc-ok", name: "OK", tenantId: "t1", secretId: "s1", lastSyncedAt: new Date() },
      { id: "loc-err", name: "Err", tenantId: "t1", secretId: "s2", lastSyncedAt: new Date() },
      { id: "loc-none", name: "None", tenantId: "t1", secretId: null, lastSyncedAt: new Date() },
    ]);
    deps.logGroupBy.mockResolvedValue([{ locationId: "loc-err", _count: { _all: 3 } }]);

    const ov = await getMonitorOverview({ tenantId: "t1" });
    expect(ov.total).toBe(3);
    expect(ov.summary).toMatchObject({ CONNECTED: 1, ERROR: 1, DISCONNECTED: 1 });
    const err = ov.locations.find((l) => l.locationId === "loc-err")!;
    expect(err.state).toBe("ERROR");
    expect(err.recentErrorCount).toBe(3);
  });
});
