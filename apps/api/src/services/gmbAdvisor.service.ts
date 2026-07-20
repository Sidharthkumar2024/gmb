import { prisma, Prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { getReputationSummary } from "./gmbReview.service";
import { getCitationSummary } from "./gmbCitation.service";
import { rankBucket } from "./gmbRanking.service";
import { GMB_PROMPT_KEYS, rankingAdviceVariables, resolveFeaturePrompt } from "./gmbAiPrompts.service";
import { runTenantLlmJson } from "./ai.service";

// =====================================================================
// AdGrowly GMB — AI Ranking Advisor (planning PDF §2). Analyzes a location's
// profile gaps and produces a 0-100 health score, a letter grade, a weighted
// breakdown, and a prioritized weekly local-SEO task list. The scoring +
// recommendation engine is pure and unit-tested; signals are aggregated from
// the location, reviews, ranking, citations and posting activity.
// =====================================================================

export interface ProfileSignals {
  profile: {
    hasPlaceId: boolean;
    hasPhone: boolean;
    hasWebsite: boolean;
    hasCategory: boolean;
    hasAddress: boolean;
  };
  reviews: { count: number; average: number; unanswered: number };
  ranking: { trackedKeywords: number; top3: number; top10: number };
  citations: { total: number; consistent: number };
  posts: { recent: number };
}

export interface ScoreArea {
  area: string;
  points: number;
  weight: number;
}

export interface ProfileScore {
  score: number;
  grade: string;
  breakdown: ScoreArea[];
}

const WEIGHTS = { profile: 25, reviews: 25, ranking: 20, citations: 15, posting: 15 };
const PROFILE_FIELDS: (keyof ProfileSignals["profile"])[] = [
  "hasPlaceId",
  "hasPhone",
  "hasWebsite",
  "hasCategory",
  "hasAddress",
];

export function gradeFromScore(score: number): string {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Weighted 0-100 profile health score with a per-area breakdown. */
export function scoreProfile(s: ProfileSignals): ProfileScore {
  const present = PROFILE_FIELDS.filter((f) => s.profile[f]).length;
  const profilePoints = Math.round((present / PROFILE_FIELDS.length) * WEIGHTS.profile);

  let reviewPoints = 0;
  if (s.reviews.count > 0) {
    const volume = Math.min(s.reviews.count / 20, 1) * 10;
    const rating = clamp(s.reviews.average / 5, 0, 1) * 10;
    const answered = ((s.reviews.count - s.reviews.unanswered) / s.reviews.count) * 5;
    reviewPoints = Math.round(clamp(volume + rating + answered, 0, WEIGHTS.reviews));
  }

  let rankingPoints = 0;
  if (s.ranking.trackedKeywords > 0) {
    const ratio = (s.ranking.top3 + s.ranking.top10 * 0.5) / s.ranking.trackedKeywords;
    rankingPoints = Math.round(clamp(ratio, 0, 1) * WEIGHTS.ranking);
  }

  const citationPoints =
    s.citations.total > 0
      ? Math.round((s.citations.consistent / s.citations.total) * WEIGHTS.citations)
      : 0;

  const postingPoints = Math.round(Math.min(s.posts.recent / 4, 1) * WEIGHTS.posting);

  const breakdown: ScoreArea[] = [
    { area: "profile", points: profilePoints, weight: WEIGHTS.profile },
    { area: "reviews", points: reviewPoints, weight: WEIGHTS.reviews },
    { area: "ranking", points: rankingPoints, weight: WEIGHTS.ranking },
    { area: "citations", points: citationPoints, weight: WEIGHTS.citations },
    { area: "posting", points: postingPoints, weight: WEIGHTS.posting },
  ];

  const score = clamp(breakdown.reduce((sum, b) => sum + b.points, 0), 0, 100);
  return { score, grade: gradeFromScore(score), breakdown };
}

export interface FocusArea {
  area: string;
  points: number;
  weight: number;
  /** Points left on the table for this area (weight − points). */
  gap: number;
  /** Gap as a percent of the area's weight (0–100). */
  gapPercent: number;
}

/**
 * Rank score areas by the points left on the table (biggest opportunity first),
 * so the advisor can point the customer at the highest-impact fix. Pure; a
 * fully-optimized profile returns an empty list.
 */
export function rankFocusAreas(score: ProfileScore): FocusArea[] {
  return score.breakdown
    .map((b) => {
      const gap = Math.max(0, b.weight - b.points);
      return { area: b.area, points: b.points, weight: b.weight, gap, gapPercent: b.weight > 0 ? Math.round((gap / b.weight) * 100) : 0 };
    })
    .filter((a) => a.gap > 0)
    .sort((a, b) => b.gap - a.gap || b.gapPercent - a.gapPercent || a.area.localeCompare(b.area));
}

/**
 * Deterministic coach's note from the score + focus areas — the fallback when
 * the LLM gateway is unavailable. Pure and unit-tested.
 */
export function buildAdvisorNote(score: ProfileScore, focus: FocusArea[]): string {
  const standing =
    score.score >= 85
      ? "Your profile is in excellent shape"
      : score.score >= 55
        ? "Your profile has a solid base"
        : "Your profile needs attention";
  if (focus.length === 0) {
    return `${standing} (${score.score}/100, grade ${score.grade}). Keep up the weekly cadence to hold your position.`;
  }
  const tops = focus.slice(0, 2).map((f) => `${f.area} (+${f.gap} pts available)`).join(" and ");
  return `${standing} (${score.score}/100, grade ${score.grade}). The fastest wins this week are ${tops} — start with the high-priority tasks below.`;
}

export type TaskPriority = "high" | "medium" | "low";

export interface AdvisorTask {
  priority: TaskPriority;
  area: string;
  task: string;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

/** Prioritized weekly local-SEO tasks derived from profile gaps. */
export function buildAdvisorTasks(s: ProfileSignals): AdvisorTask[] {
  const tasks: AdvisorTask[] = [];

  const missingFields = PROFILE_FIELDS.filter((f) => !s.profile[f]).map((f) =>
    f.replace(/^has/, "").toLowerCase(),
  );
  if (missingFields.length) {
    tasks.push({ priority: "high", area: "profile", task: `Complete your profile: add ${missingFields.join(", ")}.` });
  }

  if (s.reviews.unanswered > 0) {
    tasks.push({ priority: "high", area: "reviews", task: `Reply to ${s.reviews.unanswered} unanswered review(s).` });
  }
  if (s.reviews.count > 0 && s.reviews.average < 4) {
    tasks.push({ priority: "high", area: "reviews", task: `Lift your ${s.reviews.average}★ rating with a review-request campaign.` });
  } else if (s.reviews.count < 10) {
    tasks.push({ priority: "medium", area: "reviews", task: `Ask recent customers for reviews (you have ${s.reviews.count}).` });
  }

  if (s.ranking.trackedKeywords === 0) {
    tasks.push({ priority: "medium", area: "ranking", task: "Add target keywords to start tracking local rank." });
  } else if (s.ranking.top3 < s.ranking.trackedKeywords) {
    tasks.push({
      priority: "medium",
      area: "ranking",
      task: `Optimize for ${s.ranking.trackedKeywords - s.ranking.top3} keyword(s) not yet in the top 3.`,
    });
  }

  const inconsistent = s.citations.total - s.citations.consistent;
  if (s.citations.total === 0) {
    tasks.push({ priority: "low", area: "citations", task: "Add directory citations (Google, Bing, Yelp, Apple Maps)." });
  } else if (inconsistent > 0) {
    tasks.push({ priority: "medium", area: "citations", task: `Fix NAP on ${inconsistent} inconsistent citation(s).` });
  }

  if (s.posts.recent < 4) {
    tasks.push({ priority: "low", area: "posting", task: `Publish weekly GBP posts (only ${s.posts.recent} in the last 30 days).` });
  }

  return tasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

interface AdvisorRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  score: number;
  grade: string;
  signals: Prisma.JsonValue;
  breakdown: Prisma.JsonValue;
  tasks: Prisma.JsonValue;
  summary?: string | null;
  createdAt: Date;
}

export function toSafeAdvisor(row: AdvisorRow) {
  const breakdown = Array.isArray(row.breakdown) ? (row.breakdown as unknown as ScoreArea[]) : [];
  return {
    id: row.id,
    locationId: row.locationId,
    score: row.score,
    grade: row.grade,
    signals: row.signals,
    breakdown: row.breakdown,
    tasks: row.tasks,
    summary: row.summary ?? null,
    // Where the most score points are recoverable (biggest opportunity first).
    focusAreas: rankFocusAreas({ score: row.score, grade: row.grade, breakdown }),
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

const POST_WINDOW_DAYS = 30;

async function gatherSignals(tenantId: string, locationId: string): Promise<ProfileSignals> {
  const location = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: { placeId: true, phone: true, website: true, primaryCategory: true, addressLine: true },
  });
  if (!location) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");

  const [reviews, citations, keywords, recentPosts] = await Promise.all([
    getReputationSummary(tenantId, locationId),
    getCitationSummary(tenantId, locationId),
    prisma.gmbTrackedKeyword.findMany({
      where: { tenantId, locationId, isActive: true },
      include: { snapshots: { orderBy: { checkedAt: "desc" }, take: 1 } },
    }),
    prisma.gmbPost.count({
      where: { tenantId, createdAt: { gte: new Date(Date.now() - POST_WINDOW_DAYS * 86400000) } },
    }),
  ]);

  let top3 = 0;
  let top10 = 0;
  for (const k of keywords) {
    const bucket = rankBucket(k.snapshots[0]?.rank ?? null);
    if (bucket === "top3") top3 += 1;
    else if (bucket === "top10") top10 += 1;
  }

  return {
    profile: {
      hasPlaceId: Boolean(location.placeId),
      hasPhone: Boolean(location.phone),
      hasWebsite: Boolean(location.website),
      hasCategory: Boolean(location.primaryCategory),
      hasAddress: Boolean(location.addressLine),
    },
    reviews: { count: reviews.count, average: reviews.average, unanswered: reviews.unanswered },
    ranking: { trackedKeywords: keywords.length, top3, top10 },
    citations: { total: citations.total, consistent: citations.consistent },
    posts: { recent: recentPosts },
  };
}

/**
 * Coach's note via the live LLM gateway, driven by the Super-Admin's
 * `gmb.ranking_advisor` prompt (or its seed). Falls back to the deterministic
 * buildAdvisorNote on any failure (no key, no credits, provider/parse error).
 */
async function draftAdvisorSummaryWithAi(
  tenantId: string,
  businessName: string | null,
  profile: ProfileScore,
  tasks: AdvisorTask[],
): Promise<string> {
  const focus = rankFocusAreas(profile);
  const fallback = buildAdvisorNote(profile, focus);
  try {
    const resolved = await resolveFeaturePrompt(
      GMB_PROMPT_KEYS.rankingAdvice,
      rankingAdviceVariables({ businessName }),
    );
    const facts = [
      `Score: ${profile.score}/100 (grade ${profile.grade}).`,
      focus.length ? `Biggest gaps: ${focus.map((f) => `${f.area} (+${f.gap} pts)`).join(", ")}.` : "No gaps — fully optimized.",
      tasks.length ? `Planned tasks: ${tasks.slice(0, 5).map((t) => t.task).join(" | ")}` : "",
    ].filter(Boolean);
    const out = await runTenantLlmJson<{ summary: string }>({
      tenantId,
      feature: "gmb_ranking_advisor",
      system:
        "You are a concise local-SEO coach. Write 2–3 encouraging, specific sentences. No greetings, no markdown, no invented data.",
      prompt: `${resolved.text}\n${facts.join("\n")}\nReturn JSON: {"summary":"..."}`,
      maxTokens: 250,
      temperature: 0.6,
    });
    const summary = out?.summary?.trim();
    return summary ? summary.slice(0, 800) : fallback;
  } catch {
    return fallback;
  }
}

export async function generateAdvice(
  tenantId: string,
  locationId: string,
  createdByUserId?: string,
) {
  const signals = await gatherSignals(tenantId, locationId);
  const profile = scoreProfile(signals);
  const { score, grade, breakdown } = profile;
  const tasks = buildAdvisorTasks(signals);
  const location = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: { name: true },
  });
  const summary = await draftAdvisorSummaryWithAi(tenantId, location?.name ?? null, profile, tasks);

  const row = await prisma.gmbAdvisorReport.create({
    data: {
      tenantId,
      locationId,
      score,
      grade,
      signals: signals as unknown as Prisma.InputJsonValue,
      breakdown: breakdown as unknown as Prisma.InputJsonValue,
      tasks: tasks as unknown as Prisma.InputJsonValue,
      summary,
      createdByUserId: createdByUserId ?? null,
    },
  });
  return toSafeAdvisor(row);
}

export async function listAdvice(tenantId: string, locationId?: string) {
  const rows = await prisma.gmbAdvisorReport.findMany({
    where: { tenantId, ...(locationId ? { locationId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSafeAdvisor);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbAdvisorReport.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Advisor report not found.");
  return row;
}

export async function getAdvice(tenantId: string, id: string) {
  return toSafeAdvisor(await findOwnedOrThrow(tenantId, id));
}

export async function deleteAdvice(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  await prisma.gmbAdvisorReport.delete({ where: { id } });
}
