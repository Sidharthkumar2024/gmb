import { prisma, GmbQuestionStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { runTenantLlmJson } from "./ai.service";

// GBP Q&A (Adgrowly GMB Panel — "Q&A API"). Mirrors the reviews pipeline:
// a public question on the Business Profile is synced/logged, an answer is
// AI-drafted, the owner approves it, and it's posted back to Google.
//
// Approval-first, like review replies: answers are NEVER auto-posted. This
// matches Google's policy (no automated public changes without the customer's
// specific, express consent) and the reviews module's own default.
//
// The Google Q&A *write* (posting the approved answer back to the profile)
// lands when the Business Profile Q&A endpoint is wired — it needs a live
// customer connection to exercise. Until then the approval flow is fully
// functional and `publishedToGoogle` reports false, exactly like a review
// reply on a manually-logged (non-Google) question.

type QuestionRow = {
  id: string;
  locationId: string;
  externalQuestionId: string | null;
  authorName: string | null;
  questionText: string;
  askedAt: Date | null;
  status: GmbQuestionStatus;
  answerText: string | null;
  answeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toSafeQuestion(row: QuestionRow) {
  return {
    id: row.id,
    locationId: row.locationId,
    authorName: row.authorName,
    questionText: row.questionText,
    askedAt: row.askedAt?.toISOString() ?? null,
    status: row.status,
    answerText: row.answerText,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    isFromGoogle: Boolean(row.externalQuestionId),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Deterministic answer draft — no I/O, always available. The AI path builds on
 * this and falls back to it. Kept short and non-committal (never promises
 * specifics we can't verify), matching the review-reply guardrails.
 */
export function buildAnswerDraft(input: {
  businessName: string;
  questionText: string;
}): string {
  const business = input.businessName.trim() || "our team";
  return `Thanks for asking! ${business} would be happy to help with this. Please call us or send a message and we'll share the details you need.`;
}

export async function draftAnswerWithAi(
  tenantId: string,
  input: { businessName: string; questionText: string },
): Promise<{ answer: string; source: "ai" | "template" }> {
  const fallback = buildAnswerDraft(input);
  try {
    const out = await runTenantLlmJson<{ answer: string }>({
      tenantId,
      feature: "gmb_qanda_answer",
      system:
        "You answer public questions on a local business's Google Business Profile. Be helpful, courteous, and concise (under 400 characters). Never invent prices, hours, or policies you weren't given — if unknown, invite the asker to contact the business. Return JSON.",
      prompt: `Business: ${input.businessName.trim() || "our business"}\nQuestion: ${input.questionText.trim()}\nReturn JSON: {"answer":"..."}`,
      maxTokens: 250,
      temperature: 0.6,
    });
    const answer = out?.answer?.trim();
    if (!answer) return { answer: fallback, source: "template" };
    return { answer: answer.slice(0, 1000), source: "ai" };
  } catch {
    return { answer: fallback, source: "template" };
  }
}

// ----------------------------------------------------------------------------
// CRUD (tenant-scoped)
// ----------------------------------------------------------------------------

async function findQuestionOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbQuestion.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Question not found.");
  return row;
}

async function findLocationOrThrow(tenantId: string, locationId: string) {
  const loc = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true, name: true },
  });
  if (!loc) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  return loc;
}

export interface ListQuestionsFilter {
  locationId?: string;
  status?: GmbQuestionStatus;
}

export async function listQuestions(tenantId: string, filter: ListQuestionsFilter = {}) {
  const rows = await prisma.gmbQuestion.findMany({
    where: {
      tenantId,
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: [{ askedAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toSafeQuestion);
}

export interface IngestQuestionInput {
  locationId: string;
  questionText: string;
  authorName?: string;
  askedAt?: string;
  externalQuestionId?: string;
  createdByUserId?: string;
}

export async function ingestQuestion(tenantId: string, input: IngestQuestionInput) {
  const text = input.questionText?.trim();
  if (!text) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Question text is required.");
  }
  await findLocationOrThrow(tenantId, input.locationId);
  const row = await prisma.gmbQuestion.create({
    data: {
      tenantId,
      locationId: input.locationId,
      questionText: text,
      authorName: input.authorName?.trim() || null,
      askedAt: input.askedAt ? new Date(input.askedAt) : null,
      externalQuestionId: input.externalQuestionId?.trim() || null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeQuestion(row);
}

export async function getQuestion(tenantId: string, id: string) {
  return toSafeQuestion(await findQuestionOrThrow(tenantId, id));
}

/**
 * Build (but do not save) an answer draft for a question, using the linked
 * location's name as the business name. Returns the draft for the operator to
 * edit and approve via `answerQuestion`.
 */
export async function generateAnswerDraft(tenantId: string, id: string) {
  const question = await findQuestionOrThrow(tenantId, id);
  const location = await findLocationOrThrow(tenantId, question.locationId);
  const draft = await draftAnswerWithAi(tenantId, {
    businessName: location.name,
    questionText: question.questionText,
  });
  return { questionId: id, ...draft };
}

/**
 * Save an approved answer and mark the question ANSWERED. The Google Q&A write
 * is gated on a live customer connection + the Q&A endpoint (Phase 2); today
 * `publishedToGoogle` is false and the answer is stored for the record.
 */
export async function answerQuestion(tenantId: string, id: string, text: string) {
  const answer = text.trim();
  if (!answer) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Answer text is required.");
  }
  await findQuestionOrThrow(tenantId, id);
  const row = await prisma.gmbQuestion.update({
    where: { id },
    data: {
      answerText: answer,
      status: GmbQuestionStatus.ANSWERED,
      answeredAt: new Date(),
    },
  });
  return { ...toSafeQuestion(row), publishedToGoogle: false };
}

export async function updateQuestionStatus(
  tenantId: string,
  id: string,
  status: GmbQuestionStatus,
) {
  await findQuestionOrThrow(tenantId, id);
  const row = await prisma.gmbQuestion.update({ where: { id }, data: { status } });
  return toSafeQuestion(row);
}

export async function deleteQuestion(tenantId: string, id: string) {
  await findQuestionOrThrow(tenantId, id);
  await prisma.gmbQuestion.delete({ where: { id } });
}

export async function summarizeQuestions(tenantId: string, locationId?: string) {
  const where = { tenantId, ...(locationId ? { locationId } : {}) };
  const [total, unanswered] = await Promise.all([
    prisma.gmbQuestion.count({ where }),
    prisma.gmbQuestion.count({ where: { ...where, status: GmbQuestionStatus.NEW } }),
  ]);
  return { total, unanswered };
}
