import { createHash } from "node:crypto";
import sharp from "sharp";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { assertSafeOutboundUrl } from "../lib/ssrfGuard";
import { putPublicObject } from "../lib/publicObjectStorage";
import {
  buildBrandedDesign,
  toPublicBrandKit,
  type BrandedDesignSpec,
} from "./brandKit.service";

// Google Business Profile image guidance: PNG/JPG, 10 KB–5 MB, at least
// 250px square, with 720×720 recommended. The fixed square layout also avoids
// unexpected crops across Search and Maps surfaces.
export const GMB_BRANDED_IMAGE_SIZE = 720;
export const GMB_IMAGE_MIN_BYTES = 10 * 1024;
export const GMB_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_PIXELS = 16_000_000;
const MAX_LOGO_REDIRECTS = 3;
const LOGO_FETCH_TIMEOUT_MS = 8_000;
const ALLOWED_LOGO_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_LOGO_FORMATS = new Set(["png", "jpeg", "webp"]);

function cleanText(value: string): string {
  const withoutControls = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return !(
        code <= 8 ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
      );
    })
    .join("");
  return withoutControls.replace(/\r\n?/g, "\n").trim();
}

export function escapeSvgText(value: string): string {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Deterministic character-based wrapping with a hard line cap and ellipsis. */
export function wrapBrandedCaption(
  value: string,
  maxChars: number,
  maxLines: number,
): string[] {
  const paragraphs = cleanText(value).split("\n");
  const lines: string[] = [];
  let truncated = false;

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    let remaining = paragraphs[paragraphIndex].replace(/\s+/g, " ").trim();
    if (!remaining) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }

    while (remaining) {
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
      if (remaining.length <= maxChars) {
        lines.push(remaining);
        remaining = "";
        continue;
      }

      let breakAt = remaining.lastIndexOf(" ", maxChars);
      if (breakAt < Math.floor(maxChars * 0.45)) breakAt = maxChars;
      lines.push(remaining.slice(0, breakAt).trim());
      remaining = remaining.slice(breakAt).trim();
    }
    if (truncated) break;
    if (paragraphIndex < paragraphs.length - 1 && lines.length >= maxLines) truncated = true;
  }

  if (lines.length === 0) return [""];
  if (truncated) {
    const lastIndex = Math.min(lines.length, maxLines) - 1;
    lines.splice(maxLines);
    lines[lastIndex] = `${lines[lastIndex].replace(/[\s.,;:!?-]+$/g, "")}…`;
  }
  return lines;
}

function displayWebsite(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname.replace(/^www\./i, "")}${path}`.slice(0, 42);
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/\/$/, "").slice(0, 42);
  }
}

function designBusinessName(design: BrandedDesignSpec): string {
  if (design.businessName) return design.businessName.slice(0, 40);
  const website = displayWebsite(design.website);
  return website?.split(/[/.]/)[0] || "Business update";
}

function captionLayout(caption: string): { fontSize: number; lineHeight: number; maxChars: number; maxLines: number } {
  if (caption.length <= 220) return { fontSize: 34, lineHeight: 46, maxChars: 37, maxLines: 9 };
  if (caption.length <= 500) return { fontSize: 28, lineHeight: 38, maxChars: 46, maxLines: 11 };
  return { fontSize: 23, lineHeight: 31, maxChars: 57, maxLines: 13 };
}

/** Build only controlled SVG markup; all tenant content is XML-escaped. */
export function buildBrandedPostSvg(
  design: BrandedDesignSpec,
  logoDataUri: string | null = null,
): string {
  if (logoDataUri && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logoDataUri)) {
    throw new Error("Logo data URI must be a normalized PNG.");
  }
  const layout = captionLayout(design.caption);
  const lines = wrapBrandedCaption(design.caption, layout.maxChars, layout.maxLines);
  const businessName = designBusinessName(design);
  const initial = businessName.charAt(0).toUpperCase() || "N";
  const website = displayWebsite(design.website);
  const footer = design.phone ? `Call ${design.phone}` : "Visit our Business Profile to get in touch";
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="56" dy="${index === 0 ? 0 : layout.lineHeight}">${escapeSvgText(line)}</tspan>`,
    )
    .join("");
  const logo = logoDataUri
    ? `<image href="${logoDataUri}" x="28" y="20" width="72" height="72" preserveAspectRatio="xMidYMid meet" clip-path="url(#logo-clip)"/>`
    : `<text x="64" y="70" text-anchor="middle" font-size="35" font-weight="700" fill="${design.primaryColor}">${escapeSvgText(initial)}</text>`;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720">
  <defs>
    <linearGradient id="header" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${design.primaryColor}"/>
      <stop offset="1" stop-color="${design.secondaryColor}"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#f8fafc"/>
    </linearGradient>
    <clipPath id="logo-clip"><rect x="28" y="20" width="72" height="72" rx="14"/></clipPath>
  </defs>
  <rect width="720" height="720" fill="url(#paper)"/>
  <rect width="720" height="112" fill="url(#header)"/>
  <circle cx="660" cy="-10" r="145" fill="#ffffff" opacity="0.05"/>
  <circle cx="600" cy="55" r="90" fill="#ffffff" opacity="0.04"/>
  <rect x="24" y="16" width="80" height="80" rx="16" fill="#ffffff" opacity="0.96"/>
  ${logo}
  <text x="124" y="57" font-family="DejaVu Sans, sans-serif" font-size="24" font-weight="700" fill="#ffffff">${escapeSvgText(businessName)}</text>
  ${website ? `<text x="692" y="86" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-size="15" fill="#ffffff" opacity="0.9">${escapeSvgText(website)}</text>` : ""}
  <rect x="0" y="112" width="8" height="534" fill="${design.primaryColor}" opacity="0.16"/>
  <text x="56" y="179" font-family="DejaVu Sans, sans-serif" font-size="${layout.fontSize}" font-weight="500" fill="#1e293b">${tspans}</text>
  <rect x="0" y="646" width="720" height="74" fill="${design.secondaryColor}"/>
  <text x="360" y="692" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="21" font-weight="600" fill="#ffffff">${escapeSvgText(footer)}</text>
</svg>`.trim();
}

export async function renderBrandedPostPng(svg: string): Promise<Buffer> {
  const png = await sharp(Buffer.from(svg), {
    density: 72,
    limitInputPixels: GMB_BRANDED_IMAGE_SIZE * GMB_BRANDED_IMAGE_SIZE,
  })
    .png({ compressionLevel: 3, adaptiveFiltering: true })
    .toBuffer();
  const metadata = await sharp(png).metadata();
  if (
    metadata.format !== "png" ||
    metadata.width !== GMB_BRANDED_IMAGE_SIZE ||
    metadata.height !== GMB_BRANDED_IMAGE_SIZE
  ) {
    throw new Error("Branded image renderer produced an invalid PNG.");
  }
  if (png.length < GMB_IMAGE_MIN_BYTES || png.length > GMB_IMAGE_MAX_BYTES) {
    throw new Error(
      `Branded image must be between ${GMB_IMAGE_MIN_BYTES} and ${GMB_IMAGE_MAX_BYTES} bytes for Google Business Profile.`,
    );
  }
  return png;
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Brand logo exceeds the 2 MB download limit.");
  }
  if (!response.body) throw new Error("Brand logo response had no body.");

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  let complete = false;
  while (!complete) {
    const { value, done } = await reader.read();
    if (done) {
      complete = true;
      continue;
    }
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Brand logo exceeds the 2 MB download limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

/** Download, SSRF-check, size-limit, decode, and normalize a tenant logo. */
export async function loadLogoDataUri(rawUrl: string): Promise<string> {
  let currentUrl = rawUrl;
  for (let redirectCount = 0; redirectCount <= MAX_LOGO_REDIRECTS; redirectCount += 1) {
    const safeUrl = await assertSafeOutboundUrl(currentUrl);
    if (safeUrl.protocol !== "https:") throw new Error("Brand logo URL must use HTTPS.");

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), LOGO_FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(safeUrl.toString(), {
        method: "GET",
        redirect: "manual",
        signal: abortController.signal,
        headers: { Accept: "image/png,image/jpeg,image/webp" },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_LOGO_REDIRECTS) {
        throw new Error("Brand logo redirected too many times.");
      }
      currentUrl = new URL(location, safeUrl.toString()).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Brand logo download failed with HTTP ${response.status}.`);

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_LOGO_CONTENT_TYPES.has(contentType)) {
      throw new Error("Brand logo must be PNG, JPEG, or WebP.");
    }

    const bytes = await readLimitedBody(response, LOGO_MAX_BYTES);
    const image = sharp(bytes, { failOn: "error", limitInputPixels: LOGO_MAX_PIXELS });
    const metadata = await image.metadata();
    if (!metadata.format || !ALLOWED_LOGO_FORMATS.has(metadata.format)) {
      throw new Error("Brand logo bytes do not match a supported image format.");
    }
    const normalized = await image
      .rotate()
      .resize(144, 144, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
    return `data:image/png;base64,${normalized.toString("base64")}`;
  }
  throw new Error("Brand logo download failed.");
}

function objectIdSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new Error(`Invalid ${label} for branded image object key.`);
  }
  return value;
}

export function brandedPostObjectKey(tenantId: string, postId: string, png: Buffer): string {
  const hash = createHash("sha256").update(png).digest("hex");
  return `gmb-posts/${objectIdSegment(tenantId, "tenantId")}/${objectIdSegment(postId, "postId")}/${hash}.png`;
}

export interface BrandedImageDependencies {
  includePhone?: boolean;
  loadLogo?: (url: string) => Promise<string>;
  renderPng?: (svg: string) => Promise<Buffer>;
  upload?: (input: { key: string; body: Buffer; contentType: string }) => Promise<string>;
}

/**
 * Idempotently create and persist a hosted branded image for one owned post.
 * Existing media always wins, so a manually supplied image is never replaced.
 * A missing BrandKit means the post remains a valid text-only Google post.
 */
export async function ensureBrandedPostMedia(
  tenantId: string,
  postId: string,
  deps: BrandedImageDependencies = {},
): Promise<string | null> {
  const post = await prisma.gmbPost.findFirst({
    where: { id: postId, tenantId },
    select: {
      id: true,
      summary: true,
      mediaUrl: true,
      callToActionType: true,
      locationLabel: true,
    },
  });
  if (!post) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "GMB post not found.");
  if (post.mediaUrl) return post.mediaUrl;

  const kitRow = await prisma.brandKit.findUnique({
    where: { tenantId },
    select: {
      logoUrl: true,
      phone: true,
      website: true,
      primaryColor: true,
      secondaryColor: true,
    },
  });
  if (!kitRow) return null;

  const includePhone =
    deps.includePhone ?? process.env.GMB_BRANDED_IMAGE_INCLUDE_PHONE?.toLowerCase() === "true";
  const kit = toPublicBrandKit(kitRow);
  const design = buildBrandedDesign(
    { ...kit, phone: includePhone ? kit.phone : null },
    {
      caption: post.summary,
      callToActionType: post.callToActionType,
      businessName: post.locationLabel,
    },
  );

  let logoDataUri: string | null = null;
  if (design.logoUrl) {
    try {
      logoDataUri = await (deps.loadLogo ?? loadLogoDataUri)(design.logoUrl);
    } catch (error) {
      console.warn(
        `[gmb-branded-image] post ${post.id} logo could not be normalized; using fallback:`,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  const svg = buildBrandedPostSvg(design, logoDataUri);
  const png = await (deps.renderPng ?? renderBrandedPostPng)(svg);
  if (png.length < GMB_IMAGE_MIN_BYTES || png.length > GMB_IMAGE_MAX_BYTES) {
    throw new Error("Rendered GMB image is outside Google's 10 KB–5 MB media limit.");
  }
  const key = brandedPostObjectKey(tenantId, postId, png);
  const mediaUrl = await (deps.upload ?? putPublicObject)({
    key,
    body: png,
    contentType: "image/png",
  });
  const parsedMediaUrl = new URL(mediaUrl);
  if (parsedMediaUrl.protocol !== "https:") {
    throw new Error("Hosted GMB image URL must use HTTPS.");
  }

  const updated = await prisma.gmbPost.updateMany({
    where: { id: postId, tenantId, mediaUrl: null },
    data: { mediaUrl },
  });
  if (updated.count === 1) return mediaUrl;

  // A manual edit or another worker won the race after upload. Preserve the
  // winner instead of overwriting it; object lifecycle policy can reap the
  // now-orphaned content-hash object later.
  const winner = await prisma.gmbPost.findFirst({
    where: { id: postId, tenantId },
    select: { mediaUrl: true },
  });
  if (winner?.mediaUrl) return winner.mediaUrl;
  throw new Error("GMB post disappeared before its branded image could be attached.");
}
