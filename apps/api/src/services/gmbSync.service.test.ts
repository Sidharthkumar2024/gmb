import { describe, expect, it } from "vitest";
import { isSyncDue, mergeLocationStats } from "./gmbSync.service";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("isSyncDue", () => {
  it("is due when never synced", () => {
    expect(isSyncDue(null, 24, NOW)).toBe(true);
  });
  it("is due when older than the interval", () => {
    expect(isSyncDue("2026-06-08T12:00:00Z", 24, NOW)).toBe(true); // 48h ago
  });
  it("is not due when synced within the interval", () => {
    expect(isSyncDue("2026-06-10T06:00:00Z", 24, NOW)).toBe(false); // 6h ago
  });
});

describe("mergeLocationStats", () => {
  const current = { rating: 4.2, reviewCount: 80, verificationState: "VERIFIED" };

  it("keeps current values when nothing is supplied", () => {
    expect(mergeLocationStats(current, {})).toEqual(current);
  });

  it("overrides only provided fields and clamps reviewCount", () => {
    expect(mergeLocationStats(current, { rating: 4.6, reviewCount: 95.9 })).toEqual({
      rating: 4.6,
      reviewCount: 95,
      verificationState: "VERIFIED",
    });
  });

  it("allows clearing rating to null explicitly", () => {
    expect(mergeLocationStats(current, { rating: null }).rating).toBeNull();
  });
});
