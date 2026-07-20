import { describe, expect, it } from "vitest";
import { GmbReportType } from "@nexaflow/db";
import { buildActionPlan, buildReportNarrative, buildReportWhatsAppText, compareReportSnapshots, snapshotFromReportData, toSafeReport, type ReportSnapshot } from "./gmbReport.service";

const healthy: ReportSnapshot = {
  reviews: { count: 20, average: 4.6, unanswered: 0 },
  insights: { totalViews: 1000, totalActions: 200, actionRate: 0.2 },
  ranking: { trackedKeywords: 5, top3: 5, top10: 5, notFound: 0 },
  citations: { total: 6, consistent: 6 },
  posts: { created: 8 },
};

const struggling: ReportSnapshot = {
  reviews: { count: 10, average: 3.2, unanswered: 4 },
  insights: { totalViews: 300, totalActions: 9, actionRate: 0.03 },
  ranking: { trackedKeywords: 4, top3: 1, top10: 2, notFound: 1 },
  citations: { total: 5, consistent: 2 },
  posts: { created: 1 },
};

describe("buildReportNarrative", () => {
  it("weaves the headline metrics into a sentence", () => {
    const text = buildReportNarrative(healthy);
    expect(text).toContain("20 review(s)");
    expect(text).toContain("4.6★");
    expect(text).toContain("1000 views");
    expect(text).toContain("20% action rate");
    expect(text).toContain("6/6 citation(s)");
  });
});

describe("buildActionPlan", () => {
  it("returns no action items for a healthy profile", () => {
    // healthy has 0 unanswered, rating >= 4, all keywords top3, citations consistent, 8 posts
    expect(buildActionPlan(healthy)).toEqual([]);
  });

  it("prioritizes fixes for a struggling profile", () => {
    const plan = buildActionPlan(struggling);
    const areas = plan.map((p) => p.area);
    expect(areas).toContain("reputation"); // unanswered + low rating
    expect(areas).toContain("ranking"); // not all in top 3
    expect(areas).toContain("citations"); // 3 inconsistent
    expect(areas).toContain("content"); // < 4 posts
    // unanswered reviews + low rating are both high priority
    expect(plan.filter((p) => p.priority === "high").length).toBeGreaterThanOrEqual(2);
    expect(plan.find((p) => p.area === "citations")?.task).toContain("3");
  });
});

describe("toSafeReport", () => {
  it("exposes report fields but hides tenantId / generatedByUserId", () => {
    const safe = toSafeReport({
      id: "r1",
      tenantId: "t1",
      locationId: "loc1",
      type: GmbReportType.MONTHLY,
      periodStart: new Date("2026-05-01"),
      periodEnd: new Date("2026-05-31"),
      data: { posts: { created: 3 } },
      summary: "All good",
      actionPlan: [],
      createdAt: new Date("2026-06-01"),
    });
    expect(safe.type).toBe("MONTHLY");
    expect(safe.summary).toBe("All good");
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
    expect((safe as Record<string, unknown>).generatedByUserId).toBeUndefined();
  });
});

describe("compareReportSnapshots", () => {
  it("computes positive deltas and 'improving' momentum (struggling → healthy)", () => {
    const t = compareReportSnapshots(healthy, struggling);
    expect(t.reviewsCount).toBe(10); // 20 - 10
    expect(t.averageRating).toBe(1.4); // 4.6 - 3.2, 1dp
    expect(t.totalViews).toBe(700);
    expect(t.top3).toBe(4);
    expect(t.momentum).toBe("improving");
  });

  it("computes negative deltas and 'declining' momentum (healthy → struggling)", () => {
    const t = compareReportSnapshots(struggling, healthy);
    expect(t.reviewsCount).toBe(-10);
    expect(t.averageRating).toBe(-1.4);
    expect(t.momentum).toBe("declining");
  });

  it("reports 'steady' when nothing changed", () => {
    const t = compareReportSnapshots(healthy, healthy);
    expect([t.reviewsCount, t.averageRating, t.totalViews, t.totalActions, t.top3, t.postsCreated]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(t.momentum).toBe("steady");
  });
});

describe("snapshotFromReportData", () => {
  it("round-trips a stored report data blob back into a snapshot", () => {
    const data = { reviews: healthy.reviews, insights: healthy.insights, ranking: healthy.ranking, citations: healthy.citations, posts: healthy.posts };
    expect(snapshotFromReportData(data)).toEqual(healthy);
  });

  it("returns null when sections are missing or the blob is not an object", () => {
    expect(snapshotFromReportData({ reviews: {}, insights: {} })).toBeNull();
    expect(snapshotFromReportData(null)).toBeNull();
    expect(snapshotFromReportData("nope")).toBeNull();
  });

  it("defaults missing numbers to 0 (defensive against partial blobs)", () => {
    const snap = snapshotFromReportData({ reviews: {}, insights: {}, ranking: {}, citations: {}, posts: {} });
    expect(snap?.reviews.count).toBe(0);
    expect(snap?.insights.totalViews).toBe(0);
  });
});

describe("buildReportWhatsAppText", () => {
  it("renders title, period, summary, trend and up to 3 action items", () => {
    const text = buildReportWhatsAppText({
      type: "MONTHLY",
      periodStart: "2026-05-01T00:00:00Z",
      periodEnd: "2026-05-31T00:00:00Z",
      summary: "You collected 12 review(s) at an average of 4.5★.",
      data: { trend: { momentum: "improving", reviewsCount: 3, averageRating: 0.2, totalViews: 120, totalActions: 15, top3: 1, consistentCitations: 0, postsCreated: 2 } },
      actionPlan: [
        { priority: "high", task: "Reply to 1 unanswered review(s)." },
        { priority: "medium", task: "Add directory citations." },
        { priority: "low", task: "Publish weekly posts." },
        { priority: "low", task: "A fourth task that must be cut." },
      ],
    });
    expect(text).toContain("NexaFlow AI — Google Business report (MONTHLY)");
    expect(text).toContain("Period: 2026-05-01 → 2026-05-31");
    expect(text).toContain("Vs last period (improving): +3 reviews · +120 views · +15 actions");
    expect(text).toContain("• Reply to 1 unanswered review(s).");
    expect(text).not.toContain("fourth task");
  });

  it("omits trend and actions when absent", () => {
    const text = buildReportWhatsAppText({
      type: "WEEKLY",
      periodStart: "2026-06-01T00:00:00Z",
      periodEnd: "2026-06-07T00:00:00Z",
      summary: null,
      data: {},
      actionPlan: null,
    });
    expect(text).not.toContain("Vs last period");
    expect(text).not.toContain("Next actions:");
    expect(text).toContain("Google Business report (WEEKLY)");
  });

  it("uses the white-label issuer in the title when provided", () => {
    const text = buildReportWhatsAppText(
      { type: "MONTHLY", periodStart: "2026-05-01T00:00:00Z", periodEnd: "2026-05-31T00:00:00Z", summary: null, data: {}, actionPlan: null },
      "Hexbytes Agency",
    );
    expect(text).toContain("Hexbytes Agency — Google Business report (MONTHLY)");
    expect(text).not.toContain("NexaFlow AI");
  });
});
