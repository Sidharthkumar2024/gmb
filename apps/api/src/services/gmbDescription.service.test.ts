import { describe, expect, it } from "vitest";
import { GmbDescriptionStatus, GmbDescriptionTarget } from "@nexaflow/db";
import { analyzeDescription, optimizeDescription, scoreDescription, toSafeDescription } from "./gmbDescription.service";

describe("analyzeDescription", () => {
  it("computes length, word count and keyword presence/density", () => {
    const a = analyzeDescription("We serve the best espresso and espresso drinks", {
      keywords: ["espresso", "latte"],
    });
    expect(a.wordCount).toBe(8);
    const espresso = a.keywords.find((k) => k.keyword === "espresso")!;
    expect(espresso.count).toBe(2);
    expect(espresso.present).toBe(true);
    expect(a.missingKeywords).toEqual(["latte"]);
  });

  it("flags exceeding the character limit", () => {
    const a = analyzeDescription("x".repeat(120), { maxLength: 100 });
    expect(a.withinLimit).toBe(false);
    expect(a.issues.some((i) => i.includes("Exceeds"))).toBe(true);
  });
});

describe("optimizeDescription", () => {
  it("capitalizes, weaves missing keywords, and ends with punctuation", () => {
    const r = optimizeDescription({
      text: "friendly neighbourhood cafe",
      keywords: ["espresso", "pastries"],
      businessName: "Acme Cafe",
    });
    expect(r.optimized.startsWith("Friendly")).toBe(true);
    expect(r.optimized).toContain("Acme Cafe offers espresso, pastries");
    expect(/[.!?]$/.test(r.optimized)).toBe(true);
    expect(r.analysis.missingKeywords).toEqual([]); // keywords now present
    expect(r.changes.length).toBeGreaterThan(0);
  });

  it("enforces the character limit by trimming at a word boundary", () => {
    const r = optimizeDescription({ text: "one two three four five six seven eight", maxLength: 15 });
    expect(r.optimized.length).toBeLessThanOrEqual(15);
    expect(r.optimized.endsWith(" ")).toBe(false);
    expect(r.changes.some((c) => c.includes("Trimmed"))).toBe(true);
  });

  it("uses a friendly lead-in when no business name is given", () => {
    const r = optimizeDescription({ text: "great salon", keywords: ["haircuts"], tone: "friendly" });
    expect(r.optimized).toContain("We happily offer haircuts");
  });
});

describe("toSafeDescription", () => {
  it("exposes fields and keeps analysis, hides tenantId", () => {
    const safe = toSafeDescription({
      id: "d1",
      tenantId: "t1",
      locationId: "loc1",
      target: GmbDescriptionTarget.SERVICE,
      label: "Teeth whitening",
      original: "we whiten teeth",
      optimized: "We whiten teeth.",
      keywords: ["whitening"],
      maxLength: 750,
      analysis: { length: 16 },
      status: GmbDescriptionStatus.DRAFT,
      createdAt: new Date("2026-06-01"),
      updatedAt: new Date("2026-06-01"),
    });
    expect(safe.target).toBe("SERVICE");
    expect(safe.optimized).toBe("We whiten teeth.");
    expect(safe.analysis).toEqual({ length: 16 });
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
  });
});

describe("scoreDescription", () => {
  const keywords = ["espresso", "latte"];

  it("scores 100 for full coverage, healthy length, and no issues", () => {
    const a = analyzeDescription("Our friendly cafe serves the best espresso and a smooth latte every day.", { keywords });
    expect(scoreDescription(a)).toEqual({ score: 100, keywordCoverage: 1, lengthOk: true, issues: 0 });
  });

  it("drops to 55 with one missing keyword (coverage 0.5, length ok, has an issue)", () => {
    const a = analyzeDescription("Our friendly cafe serves the very best espresso every single day here.", { keywords });
    const s = scoreDescription(a);
    expect(s.keywordCoverage).toBe(0.5);
    expect(s.lengthOk).toBe(true);
    expect(s.score).toBe(55); // 0.5*60 + 25 + 0
  });

  it("scores 0 for a too-short description missing its keyword", () => {
    const s = scoreDescription(analyzeDescription("tiny", { keywords: ["espresso"] }));
    expect(s.lengthOk).toBe(false);
    expect(s.score).toBe(0);
  });

  it("treats no tracked keywords as full coverage on that axis", () => {
    const a = analyzeDescription("A clean, professional description that is comfortably over fifty characters long.", {});
    const s = scoreDescription(a);
    expect(s.keywordCoverage).toBe(1);
    expect(s.score).toBe(100);
  });
});
