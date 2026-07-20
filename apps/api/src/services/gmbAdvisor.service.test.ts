import { describe, expect, it } from "vitest";
import {
  buildAdvisorNote,
  buildAdvisorTasks,
  gradeFromScore,
  type ProfileSignals,
  rankFocusAreas,
  scoreProfile,
  toSafeAdvisor,
} from "./gmbAdvisor.service";

const strong: ProfileSignals = {
  profile: { hasPlaceId: true, hasPhone: true, hasWebsite: true, hasCategory: true, hasAddress: true },
  reviews: { count: 40, average: 4.8, unanswered: 0 },
  ranking: { trackedKeywords: 5, top3: 5, top10: 0 },
  citations: { total: 6, consistent: 6 },
  posts: { recent: 6 },
};

const weak: ProfileSignals = {
  profile: { hasPlaceId: false, hasPhone: false, hasWebsite: false, hasCategory: true, hasAddress: true },
  reviews: { count: 3, average: 3.2, unanswered: 2 },
  ranking: { trackedKeywords: 0, top3: 0, top10: 0 },
  citations: { total: 0, consistent: 0 },
  posts: { recent: 0 },
};

describe("gradeFromScore", () => {
  it("maps score bands to letter grades", () => {
    expect(gradeFromScore(90)).toBe("A");
    expect(gradeFromScore(72)).toBe("B");
    expect(gradeFromScore(60)).toBe("C");
    expect(gradeFromScore(45)).toBe("D");
    expect(gradeFromScore(20)).toBe("F");
  });
});

describe("scoreProfile", () => {
  it("scores a strong profile near the top with grade A", () => {
    const r = scoreProfile(strong);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.grade).toBe("A");
    const weights = r.breakdown.reduce((s, b) => s + b.weight, 0);
    expect(weights).toBe(100);
  });

  it("scores a weak profile low and never below zero", () => {
    const r = scoreProfile(weak);
    expect(r.score).toBeLessThan(55);
    expect(r.score).toBeGreaterThanOrEqual(0);
    // zero-signal areas contribute zero points
    expect(r.breakdown.find((b) => b.area === "ranking")!.points).toBe(0);
    expect(r.breakdown.find((b) => b.area === "citations")!.points).toBe(0);
  });
});

describe("rankFocusAreas", () => {
  it("ranks the biggest point gaps first for a weak profile", () => {
    const focus = rankFocusAreas(scoreProfile(weak));
    expect(focus.length).toBeGreaterThan(0);
    // every entry has a real gap, sorted descending
    for (let i = 1; i < focus.length; i++) {
      expect(focus[i].gap).toBeLessThanOrEqual(focus[i - 1].gap);
    }
    // ranking has 0 points of weight 20 → the single biggest opportunity
    expect(focus[0]).toMatchObject({ area: "ranking", gap: 20, gapPercent: 100 });
  });

  it("returns no focus areas for a fully-optimized profile", () => {
    expect(rankFocusAreas(scoreProfile(strong))).toEqual([]);
  });
});

describe("buildAdvisorNote", () => {
  it("names the top focus areas with their recoverable points for a weak profile", () => {
    const profile = scoreProfile(weak);
    const note = buildAdvisorNote(profile, rankFocusAreas(profile));
    expect(note).toContain(`${profile.score}/100`);
    expect(note).toContain("ranking (+20 pts available)");
    expect(note).toContain("start with the high-priority tasks");
  });

  it("encourages holding position when fully optimized", () => {
    const profile = scoreProfile(strong);
    const note = buildAdvisorNote(profile, rankFocusAreas(profile));
    expect(note).toContain("excellent shape");
    expect(note).toContain("hold your position");
  });
});

describe("buildAdvisorTasks", () => {
  it("emits high-priority tasks first and covers the main gaps", () => {
    const tasks = buildAdvisorTasks(weak);
    // sorted: all highs precede mediums precede lows
    const order = tasks.map((t) => t.priority);
    const rank = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < order.length; i++) {
      expect(rank[order[i]]).toBeGreaterThanOrEqual(rank[order[i - 1]]);
    }
    const text = tasks.map((t) => t.task).join(" | ");
    expect(text).toContain("Complete your profile");
    expect(text).toContain("Reply to 2 unanswered");
    expect(tasks.some((t) => t.area === "ranking")).toBe(true);
    expect(tasks.some((t) => t.area === "citations")).toBe(true);
  });

  it("returns no tasks for a fully optimized profile", () => {
    expect(buildAdvisorTasks(strong)).toEqual([]);
  });
});

describe("toSafeAdvisor", () => {
  it("exposes score/grade/tasks, hides tenantId", () => {
    const safe = toSafeAdvisor({
      id: "a1",
      tenantId: "t1",
      locationId: "loc1",
      score: 72,
      grade: "B",
      signals: {},
      breakdown: [],
      tasks: [],
      createdAt: new Date("2026-06-01"),
    });
    expect(safe.score).toBe(72);
    expect(safe.grade).toBe("B");
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
  });
});
