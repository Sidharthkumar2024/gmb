import { describe, expect, it } from "vitest";
import { GmbPostType } from "@nexaflow/db";
import { listNiches, normalizeTone, nicheCaption, resolveNiche } from "./gmbNiche";

describe("normalizeTone", () => {
  it("maps legacy values onto the two supported tones", () => {
    expect(normalizeTone("professional")).toBe("professional");
    expect(normalizeTone("warm")).toBe("professional");
    expect(normalizeTone("friendly")).toBe("friendly");
    expect(normalizeTone("playful")).toBe("friendly");
    expect(normalizeTone("")).toBe("friendly");
    expect(normalizeTone(undefined)).toBe("friendly");
  });
});

describe("listNiches", () => {
  it("returns the catalog with general first", () => {
    const niches = listNiches();
    expect(niches[0].key).toBe("general");
    expect(niches.map((n) => n.key)).toContain("salon");
    expect(niches.map((n) => n.key)).toContain("restaurant");
  });
});

describe("resolveNiche", () => {
  it("falls back to general for unknown keys", () => {
    expect(resolveNiche("nope").key).toBe("general");
    expect(resolveNiche("SALON").key).toBe("salon"); // case-insensitive
  });
});

describe("nicheCaption", () => {
  it("uses the niche default topic when none is given", () => {
    const c = nicheCaption({ businessName: "Glow", type: GmbPostType.OFFER, tone: "friendly", niche: "salon" });
    expect(c).toContain("Glow");
    expect(c).toContain("grooming"); // salon OFFER default
  });

  it("differs by tone for the same inputs", () => {
    const base = { businessName: "Glow", type: GmbPostType.EVENT, topic: "a launch", niche: "salon" } as const;
    expect(nicheCaption({ ...base, tone: "professional" })).not.toBe(
      nicheCaption({ ...base, tone: "friendly" }),
    );
  });

  it("includes the user's topic verbatim when provided", () => {
    const c = nicheCaption({ businessName: "Glow", type: GmbPostType.OFFER, topic: "30% off colour", tone: "professional", niche: "salon" });
    expect(c).toContain("30% off colour");
  });
});
