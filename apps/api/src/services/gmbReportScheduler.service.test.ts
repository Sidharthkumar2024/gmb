import { describe, expect, it } from "vitest";
import { GmbReportType } from "@nexaflow/db";
import { isReportDue, reportPeriod } from "./gmbReportScheduler.service";

const at = (iso: string) => new Date(iso);

describe("isReportDue", () => {
  it("is always due with no prior run", () => {
    expect(isReportDue(at("2026-06-13T00:00:00Z"), GmbReportType.MONTHLY, null)).toBe(true);
    expect(isReportDue(at("2026-06-13T00:00:00Z"), GmbReportType.WEEKLY, null)).toBe(true);
  });

  it("MONTHLY: due once per calendar month", () => {
    // last run in May, now in June → due
    expect(isReportDue(at("2026-06-01T06:00:00Z"), GmbReportType.MONTHLY, at("2026-05-31T23:00:00Z"))).toBe(true);
    // last run already in June → not due
    expect(isReportDue(at("2026-06-20T06:00:00Z"), GmbReportType.MONTHLY, at("2026-06-01T06:00:00Z"))).toBe(false);
    // same month different year boundary
    expect(isReportDue(at("2027-06-01T00:00:00Z"), GmbReportType.MONTHLY, at("2026-06-15T00:00:00Z"))).toBe(true);
  });

  it("WEEKLY: due when 7+ days since last run", () => {
    expect(isReportDue(at("2026-06-13T00:00:00Z"), GmbReportType.WEEKLY, at("2026-06-06T00:00:00Z"))).toBe(true);
    expect(isReportDue(at("2026-06-12T00:00:00Z"), GmbReportType.WEEKLY, at("2026-06-06T00:00:00Z"))).toBe(false);
  });
});

describe("reportPeriod", () => {
  it("MONTHLY returns the previous calendar month (UTC)", () => {
    const { periodStart, periodEnd } = reportPeriod(at("2026-06-13T10:00:00Z"), GmbReportType.MONTHLY);
    expect(periodStart).toBe("2026-05-01T00:00:00.000Z");
    expect(periodEnd).toBe("2026-05-31T23:59:59.999Z");
  });

  it("MONTHLY handles the January→previous-December rollover", () => {
    const { periodStart, periodEnd } = reportPeriod(at("2026-01-05T10:00:00Z"), GmbReportType.MONTHLY);
    expect(periodStart).toBe("2025-12-01T00:00:00.000Z");
    expect(periodEnd).toBe("2025-12-31T23:59:59.999Z");
  });

  it("WEEKLY returns a trailing 7-day window", () => {
    const now = at("2026-06-13T10:00:00Z");
    const { periodStart, periodEnd } = reportPeriod(now, GmbReportType.WEEKLY);
    expect(periodEnd).toBe(now.toISOString());
    expect(periodStart).toBe(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
  });
});
