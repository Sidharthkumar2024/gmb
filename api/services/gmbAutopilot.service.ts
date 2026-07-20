import { prisma, GmbPostStatus, GmbPostType, GmbReviewStatus, type Prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { draftGmbCaption, toSafeGmbPost } from "./gmb.service";
import { draftReviewReplyWithAi } from "./gmbReview.service";
import type { PostTone } from "./gmbNiche";

// =====================================================================
// GMB autopilot — the "auto-generate, you approve" engine. Drafts a batch of
// Business-Profile posts into a PENDING_APPROVAL queue, and pre-drafts replies
// for un-answered reviews, so the operator only has to approve. Publishing
// stays gated behind an explicit approve (safer for Google's spam policy). The
// existing publisher worker (gmbPostPublisher) sends approved+scheduled posts;
// replyToReview publishes an approved review reply.
// =====================================================================

// A weekly cadence of post types — mostly updates, with an offer + event mixed
// in — so an auto-drafted batch reads like a real content calendar.
const TYPE_CYCLE: GmbPostType[] = [
  GmbPostType.UPDATE,
  GmbPostType.OFFER,
  GmbPostType.UPDATE,
  GmbPostType.EVENT,
  GmbPostType.UPDATE,
  GmbPostType.OFFER,
  GmbPostType.UPDATE,
];

const MAX_BATCH = 14;

export interface AutopilotPostsInput {
  businessName: string;
  niche?: string;
  tone?: PostTone | string;
  /** How many posts to draft (1–14). */
  count?: number;
  /** Optional per-post topics; falls back to niche defaults when short. */
  topics?: string[];
  createdByUserId?: string;
}

/**
 * Draft a batch of posts into the PENDING_APPROVAL queue. Each is AI-drafted
 * (falling back to the deterministic niche/tone template when no LLM key), typed
 * from the weekly cadence. Nothing is scheduled or published — the operator
 * approves each one.
 */
export async function draftAutopilotPosts(tenantId: string, input: AutopilotPostsInput) {
  const count = Math.min(MAX_BATCH, Math.max(1, input.count ?? 5));
  const created = [];
  for (let i = 0; i < count; i++) {
    const type = TYPE_CYCLE[i % TYPE_CYCLE.length];
    const topic = input.topics?.[i]?.trim() || undefined;
    const caption = await draftGmbCaption(tenantId, {
      businessName: input.businessName,
      type,
      topic,
      tone: input.tone,
      niche: input.niche,
    });
    const row = await prisma.gmbPost.create({
      data: {
        tenantId,
        type: caption.type,
        summary: caption.summary,
        callToActionType: caption.callToActionType,
        status: GmbPostStatus.PENDING_APPROVAL,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
    created.push(toSafeGmbPost(row));
  }
  return created;
}

/**
 * Approve a pending post: move it to SCHEDULED (when a time is given) or DRAFT.
 * Only PENDING_APPROVAL / DRAFT posts can be approved — you can't "approve" an
 * already-published one.
 */
export async function approvePost(
  tenantId: string,
  id: string,
  opts: { scheduledAt?: string | Date | null } = {},
) {
  const row = await prisma.gmbPost.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "GMB post not found.");
  if (row.status !== GmbPostStatus.PENDING_APPROVAL && row.status !== GmbPostStatus.DRAFT) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Only pending or draft posts can be approved.");
  }
  const scheduledAt = opts.scheduledAt ? new Date(opts.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid schedule time.");
  }
  const data: Prisma.GmbPostUpdateInput = scheduledAt
    ? { status: GmbPostStatus.SCHEDULED, scheduledAt, error: null }
    : { status: GmbPostStatus.DRAFT };
  const updated = await prisma.gmbPost.update({ where: { id }, data });
  return toSafeGmbPost(updated);
}

export interface AutoDraftRepliesInput {
  locationId?: string;
  /** Reply tone; defaults to warm. */
  tone?: "warm" | "professional";
  /** Max reviews to draft in one pass (1–50). */
  limit?: number;
}

/**
 * Pre-draft replies for NEW reviews that don't have one yet. The draft lands in
 * `replyText` while the review stays NEW — i.e. "a reply is ready for your
 * approval". Approving = the existing replyToReview (which publishes to Google
 * when the location is connected and flips the review to REPLIED). Idempotent:
 * reviews that already have a draft/reply are skipped.
 */
export async function draftPendingReviewReplies(tenantId: string, input: AutoDraftRepliesInput = {}) {
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  const reviews = await prisma.gmbReview.findMany({
    where: {
      tenantId,
      status: GmbReviewStatus.NEW,
      OR: [{ replyText: null }, { replyText: "" }],
      ...(input.locationId ? { locationId: input.locationId } : {}),
    },
    orderBy: { reviewedAt: "desc" },
    take: limit,
  });

  // Cache location names so we don't refetch per review.
  const locationNames = new Map<string, string>();
  async function locationName(locationId: string): Promise<string> {
    const cached = locationNames.get(locationId);
    if (cached) return cached;
    const loc = await prisma.gmbLocation.findFirst({
      where: { id: locationId, tenantId },
      select: { name: true },
    });
    const name = loc?.name ?? "our team";
    locationNames.set(locationId, name);
    return name;
  }

  let drafted = 0;
  for (const review of reviews) {
    const draft = await draftReviewReplyWithAi(tenantId, {
      businessName: await locationName(review.locationId),
      rating: review.rating,
      authorName: review.authorName,
      comment: review.comment,
      tone: input.tone,
    });
    // Store the draft but keep status NEW — it's a suggestion awaiting approval.
    await prisma.gmbReview.update({
      where: { id: review.id },
      data: { replyText: draft.reply },
    });
    drafted += 1;
  }
  return { drafted, scanned: reviews.length };
}
