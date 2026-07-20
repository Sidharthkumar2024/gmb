import { describe, expect, it } from "vitest";
import { assembleDashboard, buildDashboardAlerts, type DashboardParts } from "./gmbDashboard.service";

describe("buildDashboardAlerts", () => {
  it("raises high-priority alerts first and covers each signal", () => {
    const alerts = buildDashboardAlerts({
      reviews: { count: 5, average: 3.5, unanswered: 2 },
      citations: { total: 4, consistent: 2 },
      ranking: { trackedKeywords: 0, top3: 0 },
      posts: { recent: 1 },
      connections: { total: 2, connected: 1 },
      credits: 0,
    });
    const order = alerts.map((a) => a.severity);
    const rank = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < order.length; i++) {
      expect(rank[order[i]]).toBeGreaterThanOrEqual(rank[order[i - 1]]);
    }
    const areas = alerts.map((a) => a.area);
    expect(areas).toContain("credits");
    expect(areas).toContain("reviews");
    expect(areas).toContain("connection");
    expect(areas).toContain("citations");
    expect(areas).toContain("ranking");
    expect(areas).toContain("content");
  });

  it("is quiet for a healthy business", () => {
    const alerts = buildDashboardAlerts({
      reviews: { count: 40, average: 4.7, unanswered: 0 },
      citations: { total: 5, consistent: 5 },
      ranking: { trackedKeywords: 8, top3: 6 },
      posts: { recent: 8 },
      connections: { total: 2, connected: 2 },
      credits: 500,
    });
    expect(alerts).toEqual([]);
  });

  it("does not raise a credits alert when credits are unknown (null)", () => {
    const alerts = buildDashboardAlerts({
      reviews: { count: 40, average: 4.7, unanswered: 0 },
      citations: { total: 5, consistent: 5 },
      ranking: { trackedKeywords: 8, top3: 6 },
      posts: { recent: 8 },
      connections: { total: 1, connected: 1 },
      credits: null,
    });
    expect(alerts.some((a) => a.area === "credits")).toBe(false);
  });
});

describe("assembleDashboard", () => {
  const base: DashboardParts = {
    connections: { total: 1, connected: 1 },
    reviews: { count: 40, average: 4.7, unanswered: 0 },
    ranking: { trackedKeywords: 8, top3: 6, top10: 1, notFound: 1 },
    citations: { total: 5, consistent: 5, consistencyScore: 1 },
    posts: { recent: 8, total: 30 },
    credits: 500,
    advisor: { score: 82, grade: "B", at: new Date("2026-06-09") },
    generatedAt: new Date("2026-06-10"),
  };

  it("uses the latest advisor score as the headline business score", () => {
    const d = assembleDashboard(base);
    expect(d.businessScore).toBe(82);
    expect(d.grade).toBe("B");
    expect(d.alerts).toEqual([]);
    expect(d.posts.total).toBe(30);
  });

  it("returns a null business score when there is no advisor run", () => {
    const d = assembleDashboard({ ...base, advisor: null });
    expect(d.businessScore).toBeNull();
    expect(d.grade).toBeNull();
    expect(d.advisor).toBeNull();
  });
});
