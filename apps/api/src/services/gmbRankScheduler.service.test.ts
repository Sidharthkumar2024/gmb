import { describe, expect, it } from "vitest";
import { isRankScheduleDue } from "./gmbRankScheduler.service";

describe("isRankScheduleDue", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");

  it("runs a schedule that has never captured a rank", () => {
    expect(isRankScheduleDue(now, 24, null)).toBe(true);
  });

  it("waits until the configured cadence has elapsed", () => {
    expect(isRankScheduleDue(now, 24, new Date("2026-08-01T12:00:01.000Z"))).toBe(false);
    expect(isRankScheduleDue(now, 24, new Date("2026-08-01T12:00:00.000Z"))).toBe(true);
  });

  it("supports shorter opt-in cadences", () => {
    expect(isRankScheduleDue(now, 6, new Date("2026-08-02T06:00:00.000Z"))).toBe(true);
  });
});
