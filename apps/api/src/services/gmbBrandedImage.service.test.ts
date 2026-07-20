import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  postFindFirst: vi.fn(),
  postUpdateMany: vi.fn(),
  brandKitFindUnique: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      gmbPost: {
        findFirst: db.postFindFirst,
        updateMany: db.postUpdateMany,
      },
      brandKit: {
        findUnique: db.brandKitFindUnique,
      },
    },
  };
});

import {
  GMB_BRANDED_IMAGE_SIZE,
  GMB_IMAGE_MIN_BYTES,
  brandedPostObjectKey,
  buildBrandedPostSvg,
  ensureBrandedPostMedia,
  renderBrandedPostPng,
  wrapBrandedCaption,
} from "./gmbBrandedImage.service";
import type { BrandedDesignSpec } from "./brandKit.service";

const DESIGN: BrandedDesignSpec = {
  businessName: "Cutz & Bangs",
  caption: "Fresh cuts, thoughtful styling, and a warm welcome are waiting for you.",
  logoUrl: "https://cdn.example.com/logo.png",
  phone: "+91 98765 43210",
  website: "https://cutz.example.com/book",
  ctaLabel: "Book now",
  primaryColor: "#0f766e",
  secondaryColor: "#065f46",
};

const POST = {
  id: "post-1",
  summary: DESIGN.caption,
  mediaUrl: null,
  callToActionType: "BOOK",
  locationLabel: "Cutz & Bangs",
};

const KIT = {
  logoUrl: DESIGN.logoUrl,
  phone: DESIGN.phone,
  website: DESIGN.website,
  primaryColor: DESIGN.primaryColor,
  secondaryColor: DESIGN.secondaryColor,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.postFindFirst.mockResolvedValue(POST);
  db.brandKitFindUnique.mockResolvedValue(KIT);
  db.postUpdateMany.mockResolvedValue({ count: 1 });
});

describe("branded image SVG", () => {
  it("escapes tenant text, omits a fake CTA, and truncates long captions", () => {
    const svg = buildBrandedPostSvg({
      ...DESIGN,
      businessName: 'A & B <script>"',
      caption: `${"Very long caption text ".repeat(100)}<unsafe>`,
    });
    expect(svg).toContain("A &amp; B &lt;script&gt;&quot;");
    expect(svg).not.toContain("<unsafe>");
    expect(svg).not.toContain("Book now");
    expect(svg).toContain("…");
  });

  it("wraps deterministically at the requested line cap", () => {
    const lines = wrapBrandedCaption("one two three four five six", 8, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/…$/);
  });

  it("renders a Google-compatible 720px PNG without a browser", async () => {
    const png = await renderBrandedPostPng(buildBrandedPostSvg(DESIGN));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(GMB_BRANDED_IMAGE_SIZE);
    expect(png.readUInt32BE(20)).toBe(GMB_BRANDED_IMAGE_SIZE);
    expect(png.length).toBeGreaterThanOrEqual(GMB_IMAGE_MIN_BYTES);
  });
});

describe("ensureBrandedPostMedia", () => {
  it("renders, uploads, and persists a tenant-scoped stable media URL", async () => {
    const png = Buffer.alloc(GMB_IMAGE_MIN_BYTES, 7);
    const renderPng = vi.fn(async (svg: string) => {
      expect(svg).not.toContain(DESIGN.phone!); // policy-safe default
      return png;
    });
    const upload = vi.fn(async () => "https://media.example.com/gmb/post.png");

    await expect(
      ensureBrandedPostMedia("tenant-1", "post-1", {
        loadLogo: vi.fn(async () => "data:image/png;base64,aGVsbG8="),
        renderPng,
        upload,
      }),
    ).resolves.toBe("https://media.example.com/gmb/post.png");

    expect(db.postFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "post-1", tenantId: "tenant-1" } }),
    );
    expect(db.brandKitFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-1" } }),
    );
    expect(upload).toHaveBeenCalledWith({
      key: brandedPostObjectKey("tenant-1", "post-1", png),
      body: png,
      contentType: "image/png",
    });
    expect(db.postUpdateMany).toHaveBeenCalledWith({
      where: { id: "post-1", tenantId: "tenant-1", mediaUrl: null },
      data: { mediaUrl: "https://media.example.com/gmb/post.png" },
    });
  });

  it("can bake the phone footer only when explicitly enabled", async () => {
    const renderPng = vi.fn(async (svg: string) => {
      expect(svg).toContain(DESIGN.phone!);
      return Buffer.alloc(GMB_IMAGE_MIN_BYTES, 1);
    });
    await ensureBrandedPostMedia("tenant-1", "post-1", {
      includePhone: true,
      loadLogo: vi.fn(async () => "data:image/png;base64,aGVsbG8="),
      renderPng,
      upload: vi.fn(async () => "https://media.example.com/gmb/post.png"),
    });
    expect(renderPng).toHaveBeenCalledOnce();
  });

  it("reuses existing media without reading the BrandKit or uploading", async () => {
    db.postFindFirst.mockResolvedValue({ ...POST, mediaUrl: "https://cdn.example.com/manual.png" });
    const upload = vi.fn();
    await expect(
      ensureBrandedPostMedia("tenant-1", "post-1", { upload }),
    ).resolves.toBe("https://cdn.example.com/manual.png");
    expect(db.brandKitFindUnique).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps text-only publishing available when no BrandKit exists", async () => {
    db.brandKitFindUnique.mockResolvedValue(null);
    await expect(ensureBrandedPostMedia("tenant-1", "post-1")).resolves.toBeNull();
    expect(db.postUpdateMany).not.toHaveBeenCalled();
  });

  it("falls back to an initial when a safely checked logo cannot be loaded", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const renderPng = vi.fn(async (svg: string) => {
      expect(svg).not.toContain("data:image/png");
      expect(svg).toContain(">C</text>");
      return Buffer.alloc(GMB_IMAGE_MIN_BYTES, 2);
    });
    await ensureBrandedPostMedia("tenant-1", "post-1", {
      loadLogo: vi.fn(async () => {
        throw new Error("unsafe or unavailable");
      }),
      renderPng,
      upload: vi.fn(async () => "https://media.example.com/gmb/post.png"),
    });
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("does not persist when object upload fails", async () => {
    await expect(
      ensureBrandedPostMedia("tenant-1", "post-1", {
        loadLogo: vi.fn(async () => "data:image/png;base64,aGVsbG8="),
        renderPng: vi.fn(async () => Buffer.alloc(GMB_IMAGE_MIN_BYTES, 3)),
        upload: vi.fn(async () => {
          throw new Error("storage unavailable");
        }),
      }),
    ).rejects.toThrow("storage unavailable");
    expect(db.postUpdateMany).not.toHaveBeenCalled();
  });
});
