import { describe, expect, it } from "vitest";
import { GmbCitationStatus } from "@nexaflow/db";
import {
  compareNap,
  composeAddress,
  normalizePhone,
  normalizeText,
  summarizeCitations,
  toSafeCitation,
} from "./gmbCitation.service";

describe("normalizeText / normalizePhone", () => {
  it("normalizes case, punctuation and whitespace", () => {
    expect(normalizeText("Acme  Café, Inc.")).toBe("acme caf inc");
    expect(normalizeText(null)).toBe("");
  });
  it("reduces phones to digits only", () => {
    expect(normalizePhone("+1 (415) 555-0000")).toBe("14155550000");
    expect(normalizePhone(undefined)).toBe("");
  });
});

describe("composeAddress", () => {
  it("joins present parts, skipping blanks", () => {
    expect(
      composeAddress({ addressLine: "1 Main St", city: "Pune", region: null, postalCode: "411001", country: "IN" }),
    ).toBe("1 Main St, Pune, 411001, IN");
  });
});

const canonical = { name: "Acme Cafe", address: "1 Main St, Pune, 411001, IN", phone: "+91 20 5555 0000" };

describe("compareNap", () => {
  it("is fully consistent when all dimensions match (formatting-tolerant)", () => {
    const c = compareNap(canonical, {
      name: "ACME CAFE",
      address: "1 main st, pune, 411001, in",
      phone: "+91-20-5555-0000",
    });
    expect(c.name).toBe("match");
    expect(c.address).toBe("match");
    expect(c.phone).toBe("match");
    expect(c.score).toBe(1);
    expect(c.consistent).toBe(true);
  });

  it("flags mismatches and reports a partial score", () => {
    const c = compareNap(canonical, {
      name: "Acme Cafe",
      address: "9 Other Rd, Mumbai",
      phone: "+91 20 5555 0000",
    });
    expect(c.address).toBe("mismatch");
    expect(c.consistent).toBe(false);
    expect(c.score).toBeCloseTo(0.67, 2);
  });

  it("treats a blank listing value as a mismatch, not n/a", () => {
    const c = compareNap(canonical, { name: "Acme Cafe", address: "", phone: "02055550000" });
    expect(c.address).toBe("mismatch");
  });

  it("excludes dimensions the canonical profile lacks (na)", () => {
    const c = compareNap({ name: "Acme Cafe", address: null, phone: null }, { name: "Acme Cafe" });
    expect(c.address).toBe("na");
    expect(c.phone).toBe("na");
    expect(c.consistent).toBe(true); // only the comparable dimension (name) matches
    expect(c.score).toBe(1);
  });
});

describe("toSafeCitation", () => {
  const row = {
    id: "c1",
    tenantId: "t1",
    locationId: "loc1",
    directory: "Yelp",
    listingUrl: "https://yelp.com/biz/acme",
    napName: "Acme Cafe",
    napAddress: "1 Main St, Pune, 411001, IN",
    napPhone: "+91 20 5555 0000",
    status: GmbCitationStatus.LIVE,
    lastCheckedAt: new Date("2026-06-05"),
    createdAt: new Date("2026-06-01"),
    updatedAt: new Date("2026-06-01"),
  };

  it("embeds a consistency comparison when canonical NAP is supplied, hides tenantId", () => {
    const safe = toSafeCitation(row, canonical);
    expect(safe.consistency?.consistent).toBe(true);
    expect(safe.nap).toEqual({ name: "Acme Cafe", address: "1 Main St, Pune, 411001, IN", phone: "+91 20 5555 0000" });
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
  });

  it("omits the comparison when no canonical NAP is given", () => {
    expect(toSafeCitation(row).consistency).toBeNull();
  });
});

describe("summarizeCitations", () => {
  it("counts by status and scores consistency over present listings", () => {
    const summary = summarizeCitations([
      { status: GmbCitationStatus.LIVE, consistent: true },
      { status: GmbCitationStatus.LIVE, consistent: false },
      { status: GmbCitationStatus.PENDING, consistent: true },
      { status: GmbCitationStatus.MISSING, consistent: false },
    ]);
    expect(summary.total).toBe(4);
    expect(summary.live).toBe(2);
    expect(summary.pending).toBe(1);
    expect(summary.missing).toBe(1);
    expect(summary.consistent).toBe(2);
    expect(summary.inconsistent).toBe(1); // present(3) - consistent(2)
    expect(summary.consistencyScore).toBe(0.67); // 2 / 3 present
  });

  it("returns a zeroed summary for no citations", () => {
    const s = summarizeCitations([]);
    expect(s.total).toBe(0);
    expect(s.consistencyScore).toBe(0);
  });
});
