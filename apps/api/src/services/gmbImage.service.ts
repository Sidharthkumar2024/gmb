import { prisma, GmbImageStatus, AiProviderKey, AiProviderKind, SecretScope } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import sharp from "sharp";
import { assertSafeOutboundUrl } from "../lib/ssrfGuard";
import { putPublicObject, type PublicObjectStorageConfig } from "../lib/publicObjectStorage";
import { reserveAi, settleAi, releaseAi } from "./billing.service";
import { resolveProviderChain } from "./aiProviderHub.service";
import { resolveSecretValue, type SecretContext } from "./secretVault.service";
import { resolvePublicStorageConfig } from "./storage.service";

// =====================================================================
// AdGrowly GMB — AI Image Generator (planning PDF §2). Builds an image-model
// prompt from a subject + brand/style hints and tracks the generation request
// through a generate-then-approve lifecycle. The actual provider call (key in
// the Secret Vault) is performed by a worker that fills resultUrl. The prompt
// builder + spec helpers are pure and unit-tested.
// =====================================================================

export const ALLOWED_IMAGE_SIZES = ["1024x1024", "1024x1792", "1792x1024"] as const;
export type ImageSize = (typeof ALLOWED_IMAGE_SIZES)[number];
const DEFAULT_SIZE: ImageSize = "1024x1024";

export function isAllowedSize(size: string): size is ImageSize {
  return (ALLOWED_IMAGE_SIZES as readonly string[]).includes(size);
}

/** Normalize a requested size to an allowed value (default square). */
export function normalizeSize(size?: string | null): ImageSize {
  return size && isAllowedSize(size) ? size : DEFAULT_SIZE;
}

/**
 * Rough per-image provider cost in USD cents for the AiUsage ledger. Images
 * have no token counts, so cost was previously logged as 0 — which made the
 * admin AI-spend total silently exclude all image generation. Env-overridable;
 * defaults track public list prices (DALL·E 3 standard/HD, larger canvases ~2x;
 * Replicate Flux is a cheap flat estimate).
 */
export function estimateImageCostCents(
  provider: "OPENAI" | "REPLICATE" | string,
  size: string,
  quality?: string | null,
): number {
  if (provider === "OPENAI") {
    const large = /1792/.test(size);
    const hd = (quality ?? "").toLowerCase() === "hd";
    const cents = hd
      ? Number(process.env.AI_IMAGE_COST_CENTS_OPENAI_HD ?? (large ? 12 : 8))
      : Number(process.env.AI_IMAGE_COST_CENTS_OPENAI ?? (large ? 8 : 4));
    return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : large ? 8 : 4;
  }
  const cents = Number(process.env.AI_IMAGE_COST_CENTS_REPLICATE ?? 1);
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 1;
}

/** Describe the aspect of an allowed size for UI hints. */
export function describeAspect(size: string): "square" | "portrait" | "landscape" {
  const [w, h] = size.split("x").map((n) => Number(n));
  if (!w || !h || w === h) return "square";
  return w > h ? "landscape" : "portrait";
}

export interface ImagePromptInput {
  subject: string;
  businessName?: string;
  style?: string;
  palette?: string;
  extras?: string[];
}

const DEFAULT_STYLE = "clean, professional, photorealistic";
const SAFETY_SUFFIX = "High quality, well-lit, no text overlays, brand-safe.";

/**
 * Build a deterministic image-model prompt from a subject + brand/style hints.
 * Always appends quality/safety guidance so generated creatives stay on-brand.
 */
export function buildImagePrompt(input: ImagePromptInput): string {
  const subject = input.subject.trim().replace(/\s+/g, " ");
  const parts: string[] = [subject];
  if (input.businessName?.trim()) parts.push(`for ${input.businessName.trim()}`);
  parts.push(`in a ${(input.style?.trim() || DEFAULT_STYLE)} style`);
  if (input.palette?.trim()) parts.push(`with a ${input.palette.trim()} color palette`);
  for (const extra of input.extras ?? []) {
    const e = extra.trim();
    if (e) parts.push(e);
  }
  return `${parts.join(", ")}. ${SAFETY_SUFFIX}`;
}

interface ImageRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  subject: string;
  prompt: string;
  style: string | null;
  palette: string | null;
  size: string;
  quality: string | null;
  provider: string | null;
  secretId: string | null;
  status: GmbImageStatus;
  resultUrl: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe view — exposes a hasCredential flag, never the secret pointer. */
export function toSafeImage(row: ImageRow) {
  return {
    id: row.id,
    locationId: row.locationId,
    subject: row.subject,
    prompt: row.prompt,
    style: row.style,
    palette: row.palette,
    size: row.size,
    aspect: describeAspect(row.size),
    quality: row.quality,
    provider: row.provider,
    hasCredential: Boolean(row.secretId),
    status: row.status,
    resultUrl: row.resultUrl,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

async function assertSecretOwned(tenantId: string, secretId?: string | null) {
  if (!secretId) return;
  const secret = await prisma.secretVaultEntry.findFirst({
    where: { id: secretId, tenantId },
    select: { id: true },
  });
  if (!secret) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Referenced secret was not found in your vault.");
  }
}

export interface CreateImageInput extends ImagePromptInput {
  locationId?: string;
  size?: string;
  quality?: string;
  provider?: string;
  secretId?: string | null;
  createdByUserId?: string;
}

export async function createImageRequest(tenantId: string, input: CreateImageInput) {
  if (!input.subject.trim()) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "An image subject is required.");
  }
  await assertSecretOwned(tenantId, input.secretId);
  // Verify a supplied locationId actually belongs to this tenant before storing
  // it — the sibling create functions (reviews, questions, citations) all do
  // this. Without it a caller can attach an arbitrary/foreign location id to
  // their own row, leaving a dangling reference.
  const imageLocationId = input.locationId?.trim() || null;
  if (imageLocationId) {
    const owned = await prisma.gmbLocation.findFirst({
      where: { id: imageLocationId, tenantId },
      select: { id: true },
    });
    if (!owned) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  }
  const prompt = buildImagePrompt(input);
  const row = await prisma.gmbImageRequest.create({
    data: {
      tenantId,
      locationId: input.locationId?.trim() || null,
      subject: input.subject.trim(),
      prompt,
      style: input.style?.trim() || null,
      palette: input.palette?.trim() || null,
      size: normalizeSize(input.size),
      quality: input.quality?.trim() || null,
      provider: input.provider?.trim() || null,
      secretId: input.secretId ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeImage(row);
}

export interface ListImagesFilter {
  locationId?: string;
  status?: GmbImageStatus;
}

export async function listImageRequests(tenantId: string, filter: ListImagesFilter = {}) {
  const rows = await prisma.gmbImageRequest.findMany({
    where: {
      tenantId,
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSafeImage);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbImageRequest.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Image request not found.");
  return row;
}

export async function getImageRequest(tenantId: string, id: string) {
  return toSafeImage(await findOwnedOrThrow(tenantId, id));
}

export interface UpdateImageInput {
  status?: GmbImageStatus;
  resultUrl?: string | null;
  error?: string | null;
}

export async function updateImageRequest(tenantId: string, id: string, input: UpdateImageInput) {
  await findOwnedOrThrow(tenantId, id);
  const row = await prisma.gmbImageRequest.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.resultUrl !== undefined ? { resultUrl: input.resultUrl } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
    },
  });
  return toSafeImage(row);
}

export async function deleteImageRequest(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  await prisma.gmbImageRequest.delete({ where: { id } });
}

// ---------------------------------------------------------------------
// Generation executor (planning PDF §2: "Image model API key, size, style,
// quality, safety and credit cost" — all admin-controlled). Resolves the
// admin's IMAGE provider chain (customer scope first, then platform), calls
// the provider, and moves the request PENDING/FAILED → READY or FAILED.
// Credit-gated like every other AI feature.
// ---------------------------------------------------------------------

async function generateViaOpenAiImages(args: {
  apiKey: string;
  baseUrl: string | null;
  model: string;
  prompt: string;
  size: ImageSize;
  quality?: string | null;
}): Promise<string> {
  const base = (args.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${args.apiKey}` },
    body: JSON.stringify({
      model: args.model,
      prompt: args.prompt,
      n: 1,
      size: args.size,
      ...(args.quality ? { quality: args.quality } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image provider HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
  const url = json.data?.[0]?.url;
  if (url) return url;
  if (json.data?.[0]?.b64_json) {
    throw new Error("Model returned an inline image; configure a URL-returning image model (e.g. dall-e-3).");
  }
  throw new Error("Image provider returned no image.");
}

async function generateViaReplicate(args: {
  apiKey: string;
  baseUrl: string | null;
  model: string;
  prompt: string;
  size: ImageSize;
}): Promise<string> {
  const base = (args.baseUrl ?? "https://api.replicate.com").replace(/\/+$/, "");
  const [width, height] = args.size.split("x").map(Number);
  // "owner/name" → latest-version endpoint; a bare 64-char id → version endpoint.
  const isModelPath = args.model.includes("/");
  const url = isModelPath ? `${base}/v1/models/${args.model}/predictions` : `${base}/v1/predictions`;
  const body = isModelPath
    ? { input: { prompt: args.prompt, width, height } }
    : { version: args.model, input: { prompt: args.prompt, width, height } };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
      // Hold the connection until the prediction finishes (up to 60s).
      Prefer: "wait",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image provider HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { status?: string; output?: unknown; error?: unknown };
  if (json.status !== "succeeded") {
    const reason = json.error ? `: ${String(json.error).slice(0, 160)}` : "";
    throw new Error(`Replicate prediction ${json.status ?? "failed"}${reason}`);
  }
  const out = Array.isArray(json.output) ? json.output[0] : json.output;
  if (typeof out === "string" && out.startsWith("http")) return out;
  throw new Error("Replicate returned no image URL.");
}

const GENERATED_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const GENERATED_IMAGE_MAX_PIXELS = 20_000_000;

type GeneratedImageFetch = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "headers" | "arrayBuffer">>;

/**
 * Copy the provider's short-lived result to platform storage before exposing
 * it to the browser. The downloaded bytes are decoded by sharp, so a provider
 * cannot smuggle HTML or another arbitrary payload under an image content type.
 */
export async function persistGeneratedImage(
  input: { tenantId: string; requestId: string; providerUrl: string },
  deps: {
    fetchFn?: GeneratedImageFetch;
    assertUrl?: (url: string) => Promise<URL>;
    upload?: (input: { key: string; body: Buffer; contentType: string }) => Promise<string>;
  } = {},
): Promise<string> {
  await (deps.assertUrl ?? assertSafeOutboundUrl)(input.providerUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Awaited<ReturnType<GeneratedImageFetch>>;
  try {
    response = await (deps.fetchFn ?? fetch)(input.providerUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`Generated image download failed with HTTP ${response.status}.`);
  }
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > GENERATED_IMAGE_MAX_BYTES) {
    throw new Error("Generated image exceeds the 20 MB storage limit.");
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0 || body.length > GENERATED_IMAGE_MAX_BYTES) {
    throw new Error("Generated image is empty or exceeds the 20 MB storage limit.");
  }
  const metadata = await sharp(body, { limitInputPixels: GENERATED_IMAGE_MAX_PIXELS }).metadata();
  const formats = {
    png: { extension: "png", contentType: "image/png" },
    jpeg: { extension: "jpg", contentType: "image/jpeg" },
    webp: { extension: "webp", contentType: "image/webp" },
  } as const;
  const format = metadata.format ? formats[metadata.format as keyof typeof formats] : undefined;
  if (!format) throw new Error("Generated image must be a PNG, JPEG or WebP file.");

  const safeTenant = input.tenantId.replace(/[^A-Za-z0-9._-]/g, "_");
  const safeRequest = input.requestId.replace(/[^A-Za-z0-9._-]/g, "_");
  const upload = deps.upload ?? (async (object) =>
    putPublicObject(object, { config: await resolvePublicStorageConfig() }));
  return upload({
    key: `gmb-images/${safeTenant}/${safeRequest}-generated.${format.extension}`,
    body,
    contentType: format.contentType,
  });
}

/**
 * Generate the image for a PENDING (or retry a FAILED) request. Walks the
 * admin-configured IMAGE provider chain — the tenant's own providers first,
 * then the platform's — and records which provider/key produced the result.
 * Never throws on provider trouble: the request lands in FAILED with the
 * reason so the operator can fix configuration and retry.
 */
export async function processImageRequest(tenantId: string, id: string) {
  const row = await findOwnedOrThrow(tenantId, id);
  if (row.status !== GmbImageStatus.PENDING && row.status !== GmbImageStatus.FAILED) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Only pending or failed image requests can be generated.");
  }
  // Reserve the credits up front (atomic hold), so two DIFFERENT image gens that
  // the wallet can only cover once can't both pass an affordability check and
  // both hit the paid provider — the second is rejected with 402 here before it
  // runs. Settled on success, released on any failure. Null when billing is off.
  const reservation = await reserveAi(tenantId, "gmb_image_generation");

  // Atomically claim the request so two concurrent generate calls for the SAME
  // request (a double click, or a retry racing the first run) can't both hit the
  // paid provider. Only the runner that flips PENDING/FAILED -> PROCESSING
  // proceeds; it then becomes READY on success or FAILED on failure (retryable).
  const claim = await prisma.gmbImageRequest.updateMany({
    where: {
      id,
      tenantId,
      status: { in: [GmbImageStatus.PENDING, GmbImageStatus.FAILED] },
    },
    data: { status: GmbImageStatus.PROCESSING },
  });
  if (claim.count !== 1) {
    // Lost the claim — return the hold so it isn't leaked, then reject.
    await releaseAi(reservation).catch(() => undefined);
    throw new ApiError(ErrorCodes.CONFLICT, 409, "This image is already being generated.");
  }

  // Fail before calling a paid provider if the result cannot be persisted.
  let storageConfig: PublicObjectStorageConfig;
  try {
    storageConfig = await resolvePublicStorageConfig();
  } catch (error) {
    await releaseAi(reservation).catch(() => undefined);
    const failed = await prisma.gmbImageRequest.update({
      where: { id },
      data: {
        status: GmbImageStatus.FAILED,
        error: `Object storage is required for durable AI images: ${
          error instanceof Error ? error.message : "storage is unavailable"
        }`.slice(0, 500),
      },
    });
    return toSafeImage(failed);
  }

  const contexts: SecretContext[] = [
    { scope: SecretScope.CUSTOMER, tenantId },
    { scope: SecretScope.PLATFORM, tenantId: null },
  ];
  let lastError = "No IMAGE provider is configured. Add one under AI Providers with kind IMAGE.";

  providerContexts: for (const ctx of contexts) {
    const chain = await resolveProviderChain(ctx, AiProviderKind.IMAGE).catch(() => []);
    for (const cfg of chain) {
      if (!cfg.secretId) continue;
      if (cfg.provider !== AiProviderKey.OPENAI && cfg.provider !== AiProviderKey.REPLICATE) {
        lastError = `Provider ${cfg.provider} is not yet supported for image generation — configure an OpenAI or Replicate IMAGE provider.`;
        continue;
      }
      const apiKey = await resolveSecretValue(ctx, cfg.secretId).catch(() => null);
      if (!apiKey) continue;
      try {
        const providerUrl =
          cfg.provider === AiProviderKey.REPLICATE
            ? await generateViaReplicate({
                apiKey,
                baseUrl: cfg.baseUrl,
                model: cfg.defaultModel ?? "black-forest-labs/flux-schnell",
                prompt: row.prompt,
                size: normalizeSize(row.size),
              })
            : await generateViaOpenAiImages({
                apiKey,
                baseUrl: cfg.baseUrl,
                model: cfg.defaultModel ?? "dall-e-3",
                prompt: row.prompt,
                size: normalizeSize(row.size),
                quality: row.quality,
              });
        let resultUrl: string;
        try {
          resultUrl = await persistGeneratedImage(
            { tenantId, requestId: id, providerUrl },
            { upload: (object) => putPublicObject(object, { config: storageConfig }) },
          );
        } catch (error) {
          lastError = `The image was generated but could not be stored safely: ${
            error instanceof Error ? error.message : "storage upload failed"
          }`;
          break providerContexts;
        }
        const updated = await prisma.gmbImageRequest.update({
          where: { id },
          data: {
            status: GmbImageStatus.READY,
            resultUrl,
            error: null,
            provider: String(cfg.provider),
            secretId: cfg.secretId,
          },
        });
        // Mirror ai.service's usage+debit path so the Credit Engine's
        // per-feature rules apply (token counts don't exist for images).
        try {
          const usage = await prisma.aiUsage.create({
            data: {
              tenantId,
              model: cfg.defaultModel ?? "dall-e-3",
              feature: "gmb_image_generation",
              inputTokens: 0,
              outputTokens: 0,
              // Images have no tokens; record an estimated provider cost so the
              // admin AI-spend total includes image generation (was 0).
              costInCents: estimateImageCostCents(
                String(cfg.provider),
                normalizeSize(row.size),
                row.quality,
              ),
            },
          });
          // Convert the hold into an actual spend now the call succeeded.
          await settleAi(reservation, { aiUsageId: usage.id });
        } catch (err) {
          // Usage/settle failed — release the hold so credits aren't stuck
          // reserved. The customer keeps their image uncharged (matches the
          // prior behaviour where a failed debit was logged, not thrown).
          await releaseAi(reservation).catch(() => undefined);
          console.error("[gmb-image] failed to log usage/settle", err);
        }
        return toSafeImage(updated);
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Image provider call failed.";
      }
    }
  }

  // Every provider failed — nothing was charged, so return the held credits.
  await releaseAi(reservation).catch(() => undefined);
  const failed = await prisma.gmbImageRequest.update({
    where: { id },
    data: { status: GmbImageStatus.FAILED, error: lastError.slice(0, 500) },
  });
  return toSafeImage(failed);
}
