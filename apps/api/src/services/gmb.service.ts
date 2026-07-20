import { prisma, GmbPostStatus, GmbPostType } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { GMB_PROMPT_KEYS, postCaptionVariables, resolveFeaturePrompt } from "./gmbAiPrompts.service";
import { runTenantLlmJson } from "./ai.service";
import { nicheCaption, normalizeTone, type PostTone } from "./gmbNiche";

// =====================================================================
// GMB AI Manager service (Complete Planning PDF §2.19, Phase 11).
// Tenant-scoped Google Business Profile posts: AI-drafted captions +
// scheduling + draft→published lifecycle. Pure caption generation is
// split out for unit testing; live publishing to Google lands once the
// Business Profile OAuth connection exists.
// =====================================================================

export const GMB_CTA_TYPES = [
  "LEARN_MORE",
  "CALL",
  "ORDER",
  "BOOK",
  "SIGN_UP",
  "SHOP",
] as const;
export type GmbCtaType = (typeof GMB_CTA_TYPES)[number];

// ---------------------------------------------------------------------
// Pure helpers (unit-tested without a DB)
// ---------------------------------------------------------------------

export interface CaptionInput {
  businessName: string;
  type?: GmbPostType;
  topic?: string; // the offer / event / update subject
  /** Two supported tones. Legacy values (warm/playful) are normalized. */
  tone?: PostTone | string;
  /** Business niche key (restaurant, salon, clinic…) for industry-specific copy. */
  niche?: string;
}

export interface CaptionDraft {
  type: GmbPostType;
  summary: string;
  callToActionType: GmbCtaType;
}

const CTA_BY_TYPE: Record<GmbPostType, GmbCtaType> = {
  [GmbPostType.OFFER]: "ORDER",
  [GmbPostType.EVENT]: "LEARN_MORE",
  [GmbPostType.UPDATE]: "LEARN_MORE",
};

/** Draft a Business-Profile post caption. Deterministic, niche- and tone-aware. */
export function buildGmbCaption(input: CaptionInput): CaptionDraft {
  const type = input.type ?? GmbPostType.UPDATE;
  const tone = normalizeTone(input.tone);
  const summary = nicheCaption({
    businessName: input.businessName,
    type,
    topic: input.topic,
    tone,
    niche: input.niche,
  });
  return { type, summary, callToActionType: CTA_BY_TYPE[type] };
}

/**
 * Draft a caption with the live LLM gateway, driven by the Super-Admin's
 * `gmb.post_caption` prompt (or its seed) via resolveFeaturePrompt. Post type
 * and CTA stay deterministic; only the summary text is AI-written. Any failure
 * (no provider key, insufficient credits, provider/parse error) falls back to
 * the deterministic template so the feature never breaks.
 */
export async function draftGmbCaption(
  tenantId: string,
  input: CaptionInput,
): Promise<CaptionDraft & { source: "ai" | "template" }> {
  const fallback = buildGmbCaption(input);
  try {
    const resolved = await resolveFeaturePrompt(
      GMB_PROMPT_KEYS.postCaption,
      postCaptionVariables({
        businessName: input.businessName,
        topic: input.topic,
        tone: normalizeTone(input.tone),
        niche: input.niche,
      }),
    );
    const out = await runTenantLlmJson<{ summary: string }>({
      tenantId,
      feature: "gmb_post_caption",
      system:
        "You write concise Google Business Profile posts. Under 1500 characters, no hashtag walls, end with a clear invitation to act.",
      prompt: `${resolved.text}\n\nPost type: ${fallback.type}.\nReturn JSON: {"summary":"..."}`,
      maxTokens: 400,
      temperature: 0.7,
    });
    const summary = out?.summary?.trim();
    if (!summary) return { ...fallback, source: "template" };
    return { ...fallback, summary: summary.slice(0, 1500), source: "ai" };
  } catch {
    return { ...fallback, source: "template" };
  }
}

interface PostRow {
  id: string;
  tenantId: string;
  type: GmbPostType;
  summary: string;
  mediaUrl: string | null;
  callToActionType: string | null;
  callToActionUrl: string | null;
  locationLabel: string | null;
  scheduledAt: Date | null;
  status: GmbPostStatus;
  publishedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSafeGmbPost(row: PostRow) {
  return {
    id: row.id,
    type: row.type,
    summary: row.summary,
    mediaUrl: row.mediaUrl,
    callToActionType: row.callToActionType,
    callToActionUrl: row.callToActionUrl,
    locationLabel: row.locationLabel,
    scheduledAt: row.scheduledAt,
    status: row.status,
    publishedAt: row.publishedAt,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertCta(cta: string | null | undefined): void {
  if (cta && !GMB_CTA_TYPES.includes(cta as GmbCtaType)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Unsupported call-to-action "${cta}".`,
    );
  }
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

export async function listPosts(tenantId: string, status?: GmbPostStatus) {
  const rows = await prisma.gmbPost.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map(toSafeGmbPost);
}

export interface CreatePostInput {
  type?: GmbPostType;
  summary: string;
  mediaUrl?: string;
  callToActionType?: string;
  callToActionUrl?: string;
  locationLabel?: string;
  scheduledAt?: string | Date | null;
  createdByUserId?: string;
}

export async function createPost(tenantId: string, input: CreatePostInput) {
  const summary = input.summary.trim();
  if (!summary) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A post summary is required.");
  }
  if (summary.length > 1500) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Summary exceeds 1500 characters.");
  }
  assertCta(input.callToActionType);
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;

  const row = await prisma.gmbPost.create({
    data: {
      tenantId,
      type: input.type ?? GmbPostType.UPDATE,
      summary,
      mediaUrl: input.mediaUrl ?? null,
      callToActionType: input.callToActionType ?? null,
      callToActionUrl: input.callToActionUrl ?? null,
      locationLabel: input.locationLabel ?? null,
      scheduledAt,
      status: scheduledAt ? GmbPostStatus.SCHEDULED : GmbPostStatus.DRAFT,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeGmbPost(row);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbPost.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "GMB post not found.");
  return row;
}

export async function getPost(tenantId: string, id: string) {
  return toSafeGmbPost(await findOwnedOrThrow(tenantId, id));
}

export interface UpdatePostInput {
  type?: GmbPostType;
  summary?: string;
  mediaUrl?: string | null;
  callToActionType?: string | null;
  callToActionUrl?: string | null;
  locationLabel?: string | null;
}

export async function updatePost(tenantId: string, id: string, input: UpdatePostInput) {
  await findOwnedOrThrow(tenantId, id);
  if (input.callToActionType !== undefined) assertCta(input.callToActionType);
  if (input.summary !== undefined && input.summary.trim().length > 1500) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Summary exceeds 1500 characters.");
  }
  const row = await prisma.gmbPost.update({
    where: { id },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.summary !== undefined ? { summary: input.summary.trim() } : {}),
      ...(input.mediaUrl !== undefined ? { mediaUrl: input.mediaUrl } : {}),
      ...(input.callToActionType !== undefined ? { callToActionType: input.callToActionType } : {}),
      ...(input.callToActionUrl !== undefined ? { callToActionUrl: input.callToActionUrl } : {}),
      ...(input.locationLabel !== undefined ? { locationLabel: input.locationLabel } : {}),
    },
  });
  return toSafeGmbPost(row);
}

export async function schedulePost(tenantId: string, id: string, when: string | Date) {
  await findOwnedOrThrow(tenantId, id);
  const scheduledAt = new Date(when);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid schedule time.");
  }
  const row = await prisma.gmbPost.update({
    where: { id },
    data: { scheduledAt, status: GmbPostStatus.SCHEDULED, error: null },
  });
  return toSafeGmbPost(row);
}

export async function deletePost(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  await prisma.gmbPost.delete({ where: { id } });
}
