import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// Brand kit — the logo / phone / website / colors used to compose branded GMB
// post designs. One kit per tenant. Pure helpers (palette presets, hex
// validation, design-spec builder) are shared by the live preview contract and
// the server-side rasterizer that hosts the post's final mediaUrl.
// =====================================================================

export interface BrandKitPublic {
  logoUrl: string | null;
  phone: string | null;
  website: string | null;
  primaryColor: string;
  secondaryColor: string;
}

const DEFAULTS: BrandKitPublic = {
  logoUrl: null,
  phone: null,
  website: null,
  primaryColor: "#0f766e",
  secondaryColor: "#065f46",
};

/** Curated color-combo presets the composer offers as one-tap choices. */
export const PALETTE_PRESETS: { key: string; label: string; primary: string; secondary: string }[] = [
  { key: "emerald", label: "Emerald", primary: "#0f766e", secondary: "#065f46" },
  { key: "indigo", label: "Indigo", primary: "#4338ca", secondary: "#312e81" },
  { key: "rose", label: "Rose", primary: "#be123c", secondary: "#881337" },
  { key: "amber", label: "Amber", primary: "#b45309", secondary: "#78350f" },
  { key: "sky", label: "Sky", primary: "#0369a1", secondary: "#0c4a6e" },
  { key: "violet", label: "Violet", primary: "#6d28d9", secondary: "#4c1d95" },
  { key: "slate", label: "Slate", primary: "#334155", secondary: "#0f172a" },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Pure: validate a 6-digit hex color, falling back to a default. */
export function normalizeHex(raw: unknown, fallback: string): string {
  return typeof raw === "string" && HEX_RE.test(raw.trim()) ? raw.trim().toLowerCase() : fallback;
}

interface BrandKitRow {
  logoUrl: string | null;
  phone: string | null;
  website: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export function toPublicBrandKit(row: BrandKitRow | null): BrandKitPublic {
  if (!row) return { ...DEFAULTS };
  return {
    logoUrl: row.logoUrl,
    phone: row.phone,
    website: row.website,
    // Revalidate values read from storage too. This keeps the SVG renderer
    // safe if a legacy/imported row bypassed today's route validation.
    primaryColor: normalizeHex(row.primaryColor, DEFAULTS.primaryColor),
    secondaryColor: normalizeHex(row.secondaryColor, DEFAULTS.secondaryColor),
  };
}

/** Read a tenant's brand kit, returning sensible defaults when none exists. */
export async function getBrandKit(tenantId: string): Promise<BrandKitPublic> {
  const row = await prisma.brandKit.findUnique({ where: { tenantId } });
  return toPublicBrandKit(row);
}

export interface SaveBrandKitInput {
  logoUrl?: string | null;
  phone?: string | null;
  website?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
}

/** Create or update the tenant's brand kit. */
export async function saveBrandKit(tenantId: string, input: SaveBrandKitInput): Promise<BrandKitPublic> {
  const logoUrl = clampUrl(input.logoUrl);
  const website = clampUrl(input.website);
  const phone = input.phone?.trim() ? input.phone.trim().slice(0, 40) : null;
  const primaryColor = normalizeHex(input.primaryColor, DEFAULTS.primaryColor);
  const secondaryColor = normalizeHex(input.secondaryColor, DEFAULTS.secondaryColor);

  const row = await prisma.brandKit.upsert({
    where: { tenantId },
    create: { tenantId, logoUrl, phone, website, primaryColor, secondaryColor },
    update: { logoUrl, phone, website, primaryColor, secondaryColor },
  });
  return toPublicBrandKit(row);
}

function clampUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "URLs must start with http:// or https://");
  }
  return v.slice(0, 500);
}

export interface BrandedDesignSpec {
  businessName: string | null;
  caption: string;
  logoUrl: string | null;
  phone: string | null;
  website: string | null;
  ctaLabel: string | null;
  primaryColor: string;
  secondaryColor: string;
}

// Human labels for the native GBP CTA types, used on the branded button.
const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: "Learn more",
  CALL: "Call now",
  ORDER: "Order",
  BOOK: "Book now",
  SIGN_UP: "Sign up",
  SHOP: "Shop now",
};

/**
 * Pure: assemble the design spec the composer preview (and, later, the
 * rasterizer) renders — brand kit + this post's caption + CTA. Keeping this
 * pure means the same spec drives the client preview and the server-side image.
 */
export function buildBrandedDesign(
  kit: BrandKitPublic,
  post: {
    caption: string;
    callToActionType?: string | null;
    businessName?: string | null;
  },
): BrandedDesignSpec {
  return {
    businessName: post.businessName?.trim() || null,
    caption: post.caption,
    logoUrl: kit.logoUrl,
    phone: kit.phone,
    website: kit.website,
    ctaLabel: post.callToActionType ? CTA_LABELS[post.callToActionType] ?? null : null,
    primaryColor: kit.primaryColor,
    secondaryColor: kit.secondaryColor,
  };
}
