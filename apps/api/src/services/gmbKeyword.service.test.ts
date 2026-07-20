import { describe, expect, it } from "vitest";
import { clusterKeywordIdeas, generateKeywordIdeas, sanitizeAiIdeas, toSafeIdeaSet } from "./gmbKeyword.service";

describe("generateKeywordIdeas", () => {
  it("produces local-intent combinations and ranks city+service highest", () => {
    const ideas = generateKeywordIdeas({
      category: "Cafe",
      city: "Pune",
      services: ["espresso", "cold brew"],
    });
    const kws = ideas.map((i) => i.keyword);
    expect(kws).toContain("espresso in Pune");
    expect(kws).toContain("best espresso in Pune");
    expect(kws).toContain("espresso near me");
    // city+service combo outranks the bare service term
    const inCity = ideas.find((i) => i.keyword === "espresso in Pune")!;
    const bare = ideas.find((i) => i.keyword === "espresso")!;
    expect(inCity.score).toBeGreaterThan(bare.score);
    expect(ideas[0].score).toBeGreaterThanOrEqual(ideas[ideas.length - 1].score); // sorted desc
  });

  it("uses the category as the base term when no services are given", () => {
    const ideas = generateKeywordIdeas({ category: "Dentist", city: "Austin" });
    const kws = ideas.map((i) => i.keyword);
    expect(kws).toContain("Dentist in Austin");
    expect(ideas.some((i) => i.kind === "category")).toBe(true);
  });

  it("adds competitor-intent keywords", () => {
    const ideas = generateKeywordIdeas({ category: "Gym", competitors: ["FitClub"] });
    const competitor = ideas.filter((i) => i.kind === "competitor").map((i) => i.keyword);
    expect(competitor).toContain("FitClub alternative");
  });

  it("de-duplicates case-insensitively and respects the limit", () => {
    const ideas = generateKeywordIdeas({
      services: ["Plumbing", "plumbing"], // same term, different case
      city: "Reno",
      limit: 3,
    });
    expect(ideas.length).toBe(3);
    const lower = ideas.map((i) => i.keyword.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length); // no dupes
  });

  it("returns nothing when there is no category or service to seed from", () => {
    expect(generateKeywordIdeas({ city: "Pune" })).toEqual([]);
  });
});

describe("toSafeIdeaSet", () => {
  it("exposes inputs + ideas with a count, hides tenantId", () => {
    const ideas = [{ keyword: "cafe in pune", kind: "city", score: 90 }];
    const safe = toSafeIdeaSet({
      id: "k1",
      tenantId: "t1",
      locationId: "loc1",
      category: "Cafe",
      city: "Pune",
      region: null,
      services: ["espresso"],
      competitors: [],
      ideas,
      createdAt: new Date("2026-06-01"),
    });
    expect(safe.count).toBe(1);
    expect(safe.ideas).toEqual(ideas);
    expect(safe.services).toEqual(["espresso"]);
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
    expect(safe.clusters).toEqual([{ kind: "city", count: 1, topKeywords: ["cafe in pune"] }]);
  });
});

describe("clusterKeywordIdeas", () => {
  it("groups by kind, counts, and lists the top-scoring examples", () => {
    const ideas = generateKeywordIdeas({ category: "Cafe", city: "Pune", services: ["espresso", "cold brew"], competitors: ["Blue Tokai"] });
    const clusters = clusterKeywordIdeas(ideas);
    // every idea is accounted for in exactly one cluster
    expect(clusters.reduce((sum, c) => sum + c.count, 0)).toBe(ideas.length);
    for (const c of clusters) {
      expect(c.topKeywords.length).toBeGreaterThan(0);
      expect(c.topKeywords.length).toBeLessThanOrEqual(5);
    }
    // a competitor seed yields a competitor cluster
    expect(clusters.some((c) => c.kind === "competitor")).toBe(true);
  });

  it("orders clusters by local-SEO priority (service/city before category)", () => {
    const clusters = clusterKeywordIdeas(generateKeywordIdeas({ category: "Cafe", city: "Pune", services: ["espresso"] }));
    const kinds = clusters.map((c) => c.kind);
    if (kinds.includes("service") && kinds.includes("category")) {
      expect(kinds.indexOf("service")).toBeLessThan(kinds.indexOf("category"));
    }
    if (kinds.includes("city") && kinds.includes("category")) {
      expect(kinds.indexOf("city")).toBeLessThan(kinds.indexOf("category"));
    }
  });

  it("returns no clusters for an empty idea list", () => {
    expect(clusterKeywordIdeas([])).toEqual([]);
  });
});

describe("sanitizeAiIdeas", () => {
  it("normalizes LLM output: trims, defaults, clamps, dedupes, sorts, caps", () => {
    const ideas = sanitizeAiIdeas(
      [
        { keyword: "  best cafe in pune  ", kind: "city", score: 250 },
        { keyword: "best cafe in pune", kind: "city", score: 80 }, // dup (lower score loses)
        { keyword: "espresso bar", kind: "made_up_kind", score: "not-a-number" as unknown as number },
        { keyword: "   ", kind: "city", score: 90 }, // empty → dropped
        { keyword: "cold brew pune", kind: "service" }, // missing score → 50
      ],
      10,
    );
    expect(ideas).toEqual([
      { keyword: "best cafe in pune", kind: "city", score: 100 }, // clamped from 250
      { keyword: "cold brew pune", kind: "service", score: 50 }, // missing score defaulted; alphabetical tie-break
      { keyword: "espresso bar", kind: "long_tail", score: 50 }, // unknown kind + bad score defaulted
    ]);
  });

  it("caps at the limit and tolerates non-array input", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ keyword: `kw ${i}`, kind: "city", score: i }));
    expect(sanitizeAiIdeas(many, 5)).toHaveLength(5);
    expect(sanitizeAiIdeas(undefined, 5)).toEqual([]);
  });
});
