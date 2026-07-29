import { afterEach, describe, expect, it, vi } from "vitest";

// Brand-kit colours feed a server-side SVG renderer, so hex is revalidated on
// the way out too (a legacy row can't inject bad values); URLs must be http(s);
// and the design-spec builder is a pure function shared by preview + rasterizer.

const deps = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return { ...actual, prisma: { brandKit: { findUnique: deps.findUnique, upsert: deps.upsert } } };
});

import {
  buildBrandedDesign,
  getBrandKit,
  normalizeHex,
  saveBrandKit,
  toPublicBrandKit,
} from "./brandKit.service";

afterEach(() => vi.clearAllMocks());

describe("normalizeHex", () => {
  it("accepts a valid 6-digit hex, lowercased and trimmed", () => {
    expect(normalizeHex("  #AABBCC ", "#000000")).toBe("#aabbcc");
  });
  it("falls back for bad, short, or non-string input", () => {
    expect(normalizeHex("#GGG", "#123456")).toBe("#123456");
    expect(normalizeHex("#abc", "#123456")).toBe("#123456"); // 3-digit not allowed
    expect(normalizeHex(42, "#123456")).toBe("#123456");
    expect(normalizeHex(undefined, "#123456")).toBe("#123456");
  });
});

describe("toPublicBrandKit", () => {
  it("returns defaults for a missing kit", () => {
    expect(toPublicBrandKit(null)).toMatchObject({
      logoUrl: null,
      primaryColor: "#0f766e",
      secondaryColor: "#065f46",
    });
  });

  it("revalidates stored colours so a legacy bad hex can't reach the renderer", () => {
    const pub = toPublicBrandKit({
      logoUrl: "https://x/l.png",
      phone: "555",
      website: "https://x",
      primaryColor: "not-a-hex",
      secondaryColor: "#ABCDEF",
    });
    expect(pub.primaryColor).toBe("#0f766e"); // fell back
    expect(pub.secondaryColor).toBe("#abcdef"); // valid, normalised
  });
});

describe("buildBrandedDesign", () => {
  const kit = toPublicBrandKit(null);

  it("maps a known CTA type to its human label", () => {
    const spec = buildBrandedDesign(kit, { caption: "Hi", callToActionType: "BOOK", businessName: "  Acme  " });
    expect(spec.ctaLabel).toBe("Book now");
    expect(spec.businessName).toBe("Acme"); // trimmed
    expect(spec.primaryColor).toBe(kit.primaryColor);
  });

  it("yields a null CTA label for an unknown or absent type", () => {
    expect(buildBrandedDesign(kit, { caption: "Hi", callToActionType: "WHATEVER" }).ctaLabel).toBeNull();
    expect(buildBrandedDesign(kit, { caption: "Hi" }).ctaLabel).toBeNull();
  });
});

describe("getBrandKit", () => {
  it("returns defaults when the tenant has no kit", async () => {
    deps.findUnique.mockResolvedValue(null);
    expect(await getBrandKit("t1")).toMatchObject({ primaryColor: "#0f766e" });
  });
});

describe("saveBrandKit", () => {
  it("normalises colours, clamps the phone, and upserts", async () => {
    deps.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => create);
    const out = await saveBrandKit("t1", {
      logoUrl: "https://x/logo.png",
      phone: "  " + "9".repeat(60) + "  ",
      website: "https://acme.example",
      primaryColor: "#ABC123",
      secondaryColor: "bad",
    });
    const data = deps.upsert.mock.calls[0][0].create;
    expect(data.primaryColor).toBe("#abc123");
    expect(data.secondaryColor).toBe("#065f46"); // fell back
    expect((data.phone as string).length).toBe(40); // clamped
    expect(out.logoUrl).toBe("https://x/logo.png");
  });

  it("rejects a non-http(s) URL (400)", async () => {
    await expect(
      saveBrandKit("t1", { logoUrl: "javascript:alert(1)" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.upsert).not.toHaveBeenCalled();
  });
});
