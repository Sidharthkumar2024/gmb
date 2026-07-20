import { describe, expect, it } from "vitest";
import { GmbImageStatus } from "@nexaflow/db";
import {
  buildImagePrompt,
  describeAspect,
  isAllowedSize,
  normalizeSize,
  toSafeImage,
} from "./gmbImage.service";

describe("size helpers", () => {
  it("validates and normalizes sizes", () => {
    expect(isAllowedSize("1024x1024")).toBe(true);
    expect(isAllowedSize("999x999")).toBe(false);
    expect(normalizeSize("1792x1024")).toBe("1792x1024");
    expect(normalizeSize("bogus")).toBe("1024x1024"); // default
    expect(normalizeSize(undefined)).toBe("1024x1024");
  });

  it("describes aspect from dimensions", () => {
    expect(describeAspect("1024x1024")).toBe("square");
    expect(describeAspect("1792x1024")).toBe("landscape");
    expect(describeAspect("1024x1792")).toBe("portrait");
  });
});

describe("buildImagePrompt", () => {
  it("assembles subject + brand + style + palette and appends safety guidance", () => {
    const p = buildImagePrompt({
      subject: "a cozy latte on a wooden table",
      businessName: "Acme Cafe",
      style: "warm photographic",
      palette: "earthy",
      extras: ["morning light"],
    });
    expect(p).toContain("a cozy latte on a wooden table");
    expect(p).toContain("for Acme Cafe");
    expect(p).toContain("in a warm photographic style");
    expect(p).toContain("with a earthy color palette");
    expect(p).toContain("morning light");
    expect(p.endsWith("brand-safe.")).toBe(true);
  });

  it("falls back to a default style and still appends safety guidance", () => {
    const p = buildImagePrompt({ subject: "storefront photo" });
    expect(p).toContain("clean, professional, photorealistic");
    expect(p).toContain("brand-safe.");
  });
});

describe("toSafeImage", () => {
  it("exposes hasCredential + aspect, never the secretId", () => {
    const safe = toSafeImage({
      id: "img1",
      tenantId: "t1",
      locationId: "loc1",
      subject: "latte",
      prompt: "latte ...",
      style: null,
      palette: null,
      size: "1024x1792",
      quality: "hd",
      provider: "openai",
      secretId: "sv_img",
      status: GmbImageStatus.PENDING,
      resultUrl: null,
      error: null,
      createdAt: new Date("2026-06-01"),
      updatedAt: new Date("2026-06-01"),
    });
    expect(safe.hasCredential).toBe(true);
    expect(safe.aspect).toBe("portrait");
    expect(safe.status).toBe("PENDING");
    expect((safe as Record<string, unknown>).secretId).toBeUndefined();
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
  });
});
