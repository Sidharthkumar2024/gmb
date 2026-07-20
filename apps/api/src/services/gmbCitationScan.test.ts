import { describe, expect, it } from "vitest";
import { recommendedDirectories, buildCitationScan } from "./gmbCitationScan";

const canonical = { name: "Glow Studio", address: "12 MG Road, Pune, MH, 411001, India", phone: "+91 2012345678" };

describe("recommendedDirectories", () => {
  it("includes the base set for any niche", () => {
    const g = recommendedDirectories("general");
    expect(g).toContain("Google Business Profile");
    expect(g).toContain("Justdial");
  });
  it("adds niche-specific directories", () => {
    expect(recommendedDirectories("restaurant")).toContain("Zomato");
    expect(recommendedDirectories("salon")).toContain("Fresha");
  });
  it("dedupes and tolerates unknown niches", () => {
    const r = recommendedDirectories("does-not-exist");
    expect(new Set(r).size).toBe(r.length);
    expect(r).toContain("Google Business Profile");
  });
});

describe("buildCitationScan", () => {
  it("flags present listings whose NAP mismatches, ignores MISSING ones", () => {
    const result = buildCitationScan(
      canonical,
      [
        { id: "c1", directory: "Justdial", status: "LIVE", nap: { name: "Glow Studio", address: "12 MG Road, Pune, MH, 411001, India", phone: "+91 2012345678" } },
        { id: "c2", directory: "Sulekha", status: "LIVE", nap: { name: "Glow Studio", address: "OLD ADDRESS", phone: "+91 2012345678" } },
        { id: "c3", directory: "Bing Places", status: "MISSING", nap: {} },
      ],
      "salon",
    );
    expect(result.scanned).toBe(3);
    expect(result.mismatches.map((m) => m.directory)).toEqual(["Sulekha"]); // c1 consistent, c3 missing
    expect(result.consistencyScore).toBe(0.5); // 1 of 2 present listings consistent
  });

  it("lists recommended directories not yet tracked", () => {
    const result = buildCitationScan(
      canonical,
      [{ id: "c1", directory: "Justdial", status: "LIVE", nap: canonical }],
      "salon",
    );
    // Justdial is tracked, so it's excluded; base + salon extras remain.
    expect(result.missingRecommended).not.toContain("Justdial");
    expect(result.missingRecommended).toContain("Fresha");
    expect(result.missingRecommended).toContain("Google Business Profile");
  });
});
