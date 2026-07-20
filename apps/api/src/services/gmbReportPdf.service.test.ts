import { describe, expect, it } from "vitest";
import { buildReportPdfLines, wrapText } from "./gmbReportPdf.service";

const report = {
  id: "r1",
  type: "MONTHLY",
  periodStart: "2026-05-01T00:00:00Z",
  periodEnd: "2026-05-31T00:00:00Z",
  summary: "You collected 12 review(s) at an average of 4.5★, with 1 awaiting a reply.",
  actionPlan: [
    { priority: "high", task: "Reply to 1 unanswered review(s)." },
    { priority: "low", task: "Publish at least weekly Google posts to stay active." },
  ],
  data: { trend: { momentum: "improving", reviewsCount: 3, averageRating: 0.2, totalViews: 120, totalActions: 15, top3: 1 } },
  createdAt: "2026-06-01T08:00:00Z",
};

describe("buildReportPdfLines", () => {
  it("renders title, period, summary, trend, and the action plan", () => {
    const text = buildReportPdfLines({ report }).join("\n");
    expect(text).toContain("Google Business performance report");
    expect(text).toContain("Type: MONTHLY · Period: 2026-05-01 to 2026-05-31");
    expect(text).toContain("You collected 12 review(s)");
    expect(text).toContain("Vs last period (improving): +3 reviews · +0.2 rating · +120 views · +15 actions · +1 top-3");
    expect(text).toContain("[HIGH] Reply to 1 unanswered review(s).");
  });

  it("omits trend and plan sections when absent", () => {
    const text = buildReportPdfLines({ report: { ...report, data: {}, actionPlan: null, summary: null } }).join("\n");
    expect(text).not.toContain("Vs last period");
    expect(text).not.toContain("Action plan:");
    expect(text).not.toContain("Summary:");
  });
});

describe("wrapText", () => {
  it("wraps at word boundaries within the width", () => {
    const lines = wrapText("one two three four five six", 10);
    expect(lines.every((l) => l.length <= 10)).toBe(true);
    expect(lines.join(" ")).toBe("one two three four five six");
  });
});
