import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const deps = vi.hoisted(() => ({
  imageFindFirst: vi.fn(),
  imageUpdateMany: vi.fn(),
  reserveAi: vi.fn(),
  settleAi: vi.fn(),
  releaseAi: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual, // keep the real GmbImageStatus etc.
    prisma: {
      gmbImageRequest: {
        findFirst: deps.imageFindFirst,
        updateMany: deps.imageUpdateMany,
      },
    },
  };
});
// Stub the credit engine so the claim tests don't need a live wallet. Default
// reserveAi -> null (matches billing-off); a test can override it.
vi.mock("./billing.service", () => ({
  reserveAi: deps.reserveAi,
  settleAi: deps.settleAi,
  releaseAi: deps.releaseAi,
}));

import { GmbImageStatus } from "@nexaflow/db";
import {
  buildImagePrompt,
  describeAspect,
  estimateImageCostCents,
  isAllowedSize,
  normalizeSize,
  persistGeneratedImage,
  processImageRequest,
  toSafeImage,
} from "./gmbImage.service";

describe("estimateImageCostCents", () => {
  it("prices OpenAI standard vs HD vs large canvas, and never returns 0", () => {
    expect(estimateImageCostCents("OPENAI", "1024x1024", null)).toBe(4);
    expect(estimateImageCostCents("OPENAI", "1024x1024", "hd")).toBe(8);
    expect(estimateImageCostCents("OPENAI", "1792x1024", null)).toBe(8);
    expect(estimateImageCostCents("OPENAI", "1792x1024", "hd")).toBe(12);
  });
  it("uses a cheap flat estimate for Replicate/other, still > 0", () => {
    expect(estimateImageCostCents("REPLICATE", "1024x1024", null)).toBe(1);
    expect(estimateImageCostCents("SOMETHING", "1024x1024", null)).toBe(1);
  });
});

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

describe("persistGeneratedImage", () => {
  it("validates provider bytes and stores a stable tenant-scoped object", async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: "#5a4af0" },
    }).png().toBuffer();
    const upload = vi.fn().mockResolvedValue("https://cdn.example.com/gmb-images/t1/img1-generated.png");
    const url = await persistGeneratedImage(
      { tenantId: "t1", requestId: "img1", providerUrl: "https://provider.example/result" },
      {
        assertUrl: vi.fn().mockResolvedValue(new URL("https://provider.example/result")),
        fetchFn: vi.fn().mockResolvedValue(new Response(png, {
          status: 200,
          headers: { "content-type": "image/png", "content-length": String(png.length) },
        })),
        upload,
      },
    );
    expect(upload).toHaveBeenCalledWith({
      key: "gmb-images/t1/img1-generated.png",
      body: png,
      contentType: "image/png",
    });
    expect(url).toBe("https://cdn.example.com/gmb-images/t1/img1-generated.png");
  });

  it("rejects non-image bytes before upload", async () => {
    const upload = vi.fn();
    await expect(persistGeneratedImage(
      { tenantId: "t1", requestId: "img1", providerUrl: "https://provider.example/result" },
      {
        assertUrl: vi.fn().mockResolvedValue(new URL("https://provider.example/result")),
        fetchFn: vi.fn().mockResolvedValue(new Response("<html>not an image</html>")),
        upload,
      },
    )).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("processImageRequest claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WALLET_BILLING_ENABLED; // billing off → affordability is a no-op
    deps.reserveAi.mockResolvedValue(null); // no hold by default
    deps.settleAi.mockResolvedValue(undefined); // return promises so `.catch` works
    deps.releaseAi.mockResolvedValue(undefined);
  });

  it("rejects a request that isn't PENDING or FAILED (400)", async () => {
    deps.imageFindFirst.mockResolvedValue({
      id: "img-1",
      tenantId: "t1",
      status: GmbImageStatus.READY,
    });
    await expect(processImageRequest("t1", "img-1")).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.imageUpdateMany).not.toHaveBeenCalled(); // never even claims
  });

  it("does not double-charge: a lost claim (count 0) throws 409 before the provider runs", async () => {
    deps.imageFindFirst.mockResolvedValue({
      id: "img-1",
      tenantId: "t1",
      status: GmbImageStatus.PENDING,
    });
    // Another concurrent run already flipped it out of PENDING/FAILED.
    deps.imageUpdateMany.mockResolvedValue({ count: 0 });
    await expect(processImageRequest("t1", "img-1")).rejects.toMatchObject({ statusCode: 409 });
    expect(deps.imageUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "img-1",
        tenantId: "t1",
        status: { in: [GmbImageStatus.PENDING, GmbImageStatus.FAILED] },
      },
      data: { status: GmbImageStatus.PROCESSING },
    });
  });

  it("reserves before claiming, and releases the hold when the claim is lost", async () => {
    deps.imageFindFirst.mockResolvedValue({
      id: "img-1",
      tenantId: "t1",
      status: GmbImageStatus.PENDING,
    });
    const reservation = { walletId: "w1", tenantId: "t1", feature: "gmb_image_generation", cost: 3 };
    deps.reserveAi.mockResolvedValue(reservation); // billing on: a hold is taken
    deps.imageUpdateMany.mockResolvedValue({ count: 0 }); // another run won the claim

    await expect(processImageRequest("t1", "img-1")).rejects.toMatchObject({ statusCode: 409 });
    // The hold must be returned, not leaked, and the provider never ran.
    expect(deps.reserveAi).toHaveBeenCalledWith("t1", "gmb_image_generation");
    expect(deps.releaseAi).toHaveBeenCalledWith(reservation);
    expect(deps.settleAi).not.toHaveBeenCalled();
  });
});
