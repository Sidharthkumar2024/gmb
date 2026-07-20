import { prisma, GmbReviewStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { updateGoogleReviewReply } from "./gmbGoogle.service";
import { GMB_PROMPT_KEYS, reviewReplyVariables, resolveFeaturePrompt } from "./gmbAiPrompts.service";
import { runTenantLlmJson } from "./ai.service";

// =====================================================================
// AdGrowly GMB — Reputation service (planning PDF). Reviews are anchored to
// a GmbLocation and carry an AI-assisted reply draft (generate-then-approve):
// `buildReviewReplyDraft` produces a sentiment-tailored draft locally; the
// LLM gateway can swap in here later without changing the route contract.
// Pure helpers are split out for unit testing (no Prisma in tests).
// =====================================================================

interface ReviewRow {
  id: string;
  tenantId: string;
  locationId: string;
  externalReviewId: string | null;
  authorName: string | null;
  rating: number;
  comment: string | null;
  reviewedAt: Date | null;
  status: GmbReviewStatus;
  replyText: string | null;
  repliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe view — never leaks tenantId or the external sync id. */
export function toSafeReview(row: ReviewRow) {
  return {
    id: row.id,
    locationId: row.locationId,
    authorName: row.authorName,
    rating: row.rating,
    comment: row.comment,
    reviewedAt: row.reviewedAt,
    status: row.status,
    replyText: row.replyText,
    repliedAt: row.repliedAt,
    isGoogleSynced: Boolean(row.externalReviewId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type ReviewSentiment = "positive" | "neutral" | "negative";

export function ratingSentiment(rating: number): ReviewSentiment {
  if (rating >= 4) return "positive";
  if (rating <= 2) return "negative";
  return "neutral";
}

export interface ReviewReplyInput {
  businessName: string;
  rating: number;
  authorName?: string | null;
  comment?: string | null;
  tone?: "warm" | "professional";
}

/**
 * Deterministic, sentiment-aware reply draft. Returned to the operator to
 * edit/approve before sending — we never auto-publish a reply. Kept pure so
 * it is fully unit-testable and works offline.
 */
export function buildReviewReplyDraft(input: ReviewReplyInput): {
  reply: string;
  sentiment: ReviewSentiment;
} {
  const business = input.businessName.trim() || "our team";
  const firstName = (input.authorName ?? "").trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const tone = input.tone ?? "warm";
  const sentiment = ratingSentiment(input.rating);

  let body: string;
  if (sentiment === "positive") {
    body =
      tone === "professional"
        ? `thank you for the ${input.rating}-star review. We appreciate you taking the time to share your experience with ${business}, and we look forward to serving you again.`
        : `thank you so much for the wonderful ${input.rating}-star review! It means a lot to everyone at ${business}, and we can't wait to welcome you back. 🙌`;
  } else if (sentiment === "neutral") {
    body = `thank you for your feedback. We're glad you visited ${business}, and we'd love to learn how we can make your next experience a 5-star one — please reach out to us directly so we can help.`;
  } else {
    body = `thank you for letting us know, and we're sorry your experience with ${business} fell short. This isn't the standard we hold ourselves to. We'd like to make it right — please contact us directly so we can resolve this for you.`;
  }

  return { reply: `${greeting} ${body}`.trim(), sentiment };
}

/**
 * Draft a reply with the live LLM gateway, driven by the Super-Admin's
 * `gmb.review_reply` prompt (or its seed). Sentiment classification stays
 * deterministic (ratingSentiment); only the reply text is AI-written. Any
 * failure — no provider key, insufficient credits, provider/parse error —
 * falls back to the deterministic draft so generate-then-approve never breaks.
 */
export async function draftReviewReplyWithAi(
  tenantId: string,
  input: ReviewReplyInput,
): Promise<{ reply: string; sentiment: ReviewSentiment; source: "ai" | "template" }> {
  const fallback = buildReviewReplyDraft(input);
  try {
    const resolved = await resolveFeaturePrompt(
      GMB_PROMPT_KEYS.reviewReply,
      reviewReplyVariables({
        authorName: input.authorName,
        rating: input.rating,
        businessName: input.businessName,
        comment: input.comment,
      }),
    );
    const out = await runTenantLlmJson<{ reply: string }>({
      tenantId,
      feature: "gmb_review_reply",
      system:
        "You write short, courteous replies to Google reviews on behalf of a local business. Never promise compensation, never argue, keep it under 700 characters, and match the requested tone.",
      prompt: `${resolved.text}\nTone: ${input.tone ?? "warm"}. Review sentiment: ${fallback.sentiment}.\nReturn JSON: {"reply":"..."}`,
      maxTokens: 350,
      temperature: 0.7,
    });
    const reply = out?.reply?.trim();
    if (!reply) return { ...fallback, source: "template" };
    return { reply: reply.slice(0, 1000), sentiment: fallback.sentiment, source: "ai" };
  } catch {
    return { ...fallback, source: "template" };
  }
}

/**
 * Public "write a review" link for a location. Only well-formed Google Maps
 * place ids work here — locations synced via the Business Profile API store
 * the account resource name ("accounts/…/locations/…"), which has no public
 * review URL, so those return null and callers fall back to a linkless ask.
 */
export function buildGoogleReviewLink(placeId: string | null | undefined): string | null {
  const id = (placeId ?? "").trim();
  if (!id || id.includes("/")) return null;
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}`;
}

/**
 * WhatsApp-ready review request (planning PDF §6 hook: "review request
 * sharing"). Friendly, short, with the review link when one exists. Pure.
 */
export function buildReviewRequestText(input: {
  businessName: string;
  customerName?: string | null;
  link?: string | null;
}): string {
  const business = input.businessName.trim() || "our business";
  const firstName = (input.customerName ?? "").trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${firstName}!` : "Hi!";
  const lines = [
    `${greeting} Thank you for choosing ${business}. 🙏`,
    "",
    "If you have a moment, we'd really appreciate a quick Google review — it helps neighbours find us.",
  ];
  if (input.link) lines.push("", input.link);
  return lines.join("\n");
}

export interface ReputationSummary {
  count: number;
  average: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  unanswered: number;
}

/** Pure aggregate over rating+status rows — drives the reputation dashboard. */
export function summarizeReviews(
  rows: Array<{ rating: number; status: GmbReviewStatus }>,
): ReputationSummary {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let unanswered = 0;
  for (const r of rows) {
    const bucket = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    distribution[bucket] += 1;
    total += r.rating;
    if (r.status === GmbReviewStatus.NEW) unanswered += 1;
  }
  const count = rows.length;
  const average = count ? Math.round((total / count) * 100) / 100 : 0;
  return { count, average, distribution, unanswered };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

async function findLocationOrThrow(tenantId: string, locationId: string) {
  const loc = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true, name: true },
  });
  if (!loc) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  return loc;
}

async function findReviewOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbReview.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Review not found.");
  return row;
}

export interface ListReviewsFilter {
  locationId?: string;
  status?: GmbReviewStatus;
}

export async function listReviews(tenantId: string, filter: ListReviewsFilter = {}) {
  const rows = await prisma.gmbReview.findMany({
    where: {
      tenantId,
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toSafeReview);
}

export interface IngestReviewInput {
  locationId: string;
  rating: number;
  authorName?: string;
  comment?: string;
  reviewedAt?: string;
  externalReviewId?: string;
  createdByUserId?: string;
}

export async function ingestReview(tenantId: string, input: IngestReviewInput) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Rating must be an integer from 1 to 5.");
  }
  await findLocationOrThrow(tenantId, input.locationId);
  const row = await prisma.gmbReview.create({
    data: {
      tenantId,
      locationId: input.locationId,
      rating: input.rating,
      authorName: input.authorName?.trim() || null,
      comment: input.comment?.trim() || null,
      reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : null,
      externalReviewId: input.externalReviewId?.trim() || null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeReview(row);
}

export async function getReview(tenantId: string, id: string) {
  return toSafeReview(await findReviewOrThrow(tenantId, id));
}

/**
 * Build (but do not save) a reply draft for a review, using the linked
 * location's name as the business name. Returns the draft for the operator
 * to edit and approve via `replyToReview`.
 */
export async function generateReplyDraft(
  tenantId: string,
  id: string,
  tone?: "warm" | "professional",
) {
  const review = await findReviewOrThrow(tenantId, id);
  const location = await prisma.gmbLocation.findFirst({
    where: { id: review.locationId, tenantId },
    select: { name: true },
  });
  const draft = await draftReviewReplyWithAi(tenantId, {
    businessName: location?.name ?? "our team",
    rating: review.rating,
    authorName: review.authorName,
    comment: review.comment,
    tone,
  });
  return { reviewId: review.id, ...draft };
}

export async function replyToReview(tenantId: string, id: string, text: string) {
  const reply = text.trim();
  if (!reply) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Reply text is required.");
  }
  const review = await findReviewOrThrow(tenantId, id);
  const location = await prisma.gmbLocation.findFirst({
    where: { id: review.locationId, tenantId },
    select: { id: true, placeId: true, secretId: true },
  });
  let publishedToGoogle = false;
  let repliedAt = new Date();

  if (review.externalReviewId && location?.placeId && location.secretId) {
    const googleReply = await updateGoogleReviewReply({
      tenantId,
      locationId: location.id,
      locationResourceName: location.placeId,
      secretId: location.secretId,
      externalReviewId: review.externalReviewId,
      comment: reply,
    });
    publishedToGoogle = true;
    repliedAt = new Date(googleReply.updateTime);
  }

  const row = await prisma.gmbReview.update({
    where: { id },
    data: { replyText: reply, status: GmbReviewStatus.REPLIED, repliedAt },
  });
  return { ...toSafeReview(row), publishedToGoogle };
}

export async function updateReviewStatus(tenantId: string, id: string, status: GmbReviewStatus) {
  await findReviewOrThrow(tenantId, id);
  const row = await prisma.gmbReview.update({ where: { id }, data: { status } });
  return toSafeReview(row);
}

export async function deleteReview(tenantId: string, id: string) {
  await findReviewOrThrow(tenantId, id);
  await prisma.gmbReview.delete({ where: { id } });
}

export async function getReputationSummary(tenantId: string, locationId?: string) {
  if (locationId) await findLocationOrThrow(tenantId, locationId);
  const rows = await prisma.gmbReview.findMany({
    where: { tenantId, ...(locationId ? { locationId } : {}) },
    select: { rating: true, status: true },
  });
  return summarizeReviews(rows);
}
