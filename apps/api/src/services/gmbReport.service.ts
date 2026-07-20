import { prisma, GmbReportType, Prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { getReputationSummary } from "./gmbReview.service";
import { getInsightsSummary } from "./gmbInsights.service";
import { getCitationSummary } from "./gmbCitation.service";
import { rankBucket } from "./gmbRanking.service";
import { GMB_PROMPT_KEYS, reportVariables, resolveFeaturePrompt } from "./gmbAiPrompts.service";
import { runTenantLlmJson } from "./ai.service";

// =====================================================================
// AdGrowly GMB — Reports (planning PDF §3 Reports + §2 AI Monthly Report). A
// report aggregates reputation / insights / ranking / citations / posts for a
// period into a stored snapshot, then derives a narrative summary and an
// action plan. The narrative/plan are deterministic (LLM-swappable later) so
// they stay unit-testable offline. DB ops are tenant-scoped.
// =====================================================================

export interface ReportSnapshot {
  reviews: { count: number; average: number; unanswered: number };
  insights: { totalViews: number; totalActions: number; actionRate: number };
  ranking: { trackedKeywords: number; top3: number; top10: number; notFound: number };
  citations: { total: number; consistent: number };
  posts: { created: number };
}

export interface ActionItem {
  priority: "high" | "medium" | "low";
  area: "reputation" | "ranking" | "citations" | "content";
  task: string;
}

/** Deterministic narrative summary of a period's GMB performance. */
export function buildReportNarrative(s: ReportSnapshot): string {
  const actionPct = Math.round(s.insights.actionRate * 100);
  return [
    `You collected ${s.reviews.count} review(s) at an average of ${s.reviews.average}★, with ${s.reviews.unanswered} awaiting a reply.`,
    `Your profile drew ${s.insights.totalViews} views and ${s.insights.totalActions} customer actions (${actionPct}% action rate).`,
    `Of ${s.ranking.trackedKeywords} tracked keyword(s), ${s.ranking.top3} rank in the top 3 and ${s.ranking.top10} in the top 10.`,
    `${s.citations.consistent}/${s.citations.total} citation(s) are NAP-consistent.`,
    `You published ${s.posts.created} post(s) this period.`,
  ].join(" ");
}

/** Derive a prioritized action plan from the gaps in a snapshot. */
export function buildActionPlan(s: ReportSnapshot): ActionItem[] {
  const plan: ActionItem[] = [];
  if (s.reviews.unanswered > 0) {
    plan.push({ priority: "high", area: "reputation", task: `Reply to ${s.reviews.unanswered} unanswered review(s).` });
  }
  if (s.reviews.count > 0 && s.reviews.average < 4) {
    plan.push({ priority: "high", area: "reputation", task: "Run a review-request campaign to lift your rating above 4.0." });
  }
  if (s.ranking.trackedKeywords === 0) {
    plan.push({ priority: "medium", area: "ranking", task: "Add target keywords to start tracking local rank." });
  } else if (s.ranking.top3 < s.ranking.trackedKeywords) {
    plan.push({ priority: "medium", area: "ranking", task: "Optimize posts and categories for keywords not yet in the top 3." });
  }
  const badCitations = s.citations.total - s.citations.consistent;
  if (badCitations > 0) {
    plan.push({ priority: "medium", area: "citations", task: `Fix NAP on ${badCitations} inconsistent or missing citation(s).` });
  }
  if (s.posts.created < 4) {
    plan.push({ priority: "low", area: "content", task: "Publish at least weekly Google posts to stay active." });
  }
  return plan;
}

export interface ReportTrend {
  reviewsCount: number;
  averageRating: number;
  totalViews: number;
  totalActions: number;
  top3: number;
  consistentCitations: number;
  postsCreated: number;
  /** Net direction across the headline metrics. */
  momentum: "improving" | "declining" | "steady";
}

/**
 * Period-over-period deltas between two report snapshots (current − previous).
 * Pure — powers a "vs last period" section in monthly reports. `momentum` is the
 * net sign across the headline metrics (rating weighted as whole steps).
 */
export function compareReportSnapshots(current: ReportSnapshot, previous: ReportSnapshot): ReportTrend {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const reviewsCount = current.reviews.count - previous.reviews.count;
  const averageRating = round1(current.reviews.average - previous.reviews.average);
  const totalViews = current.insights.totalViews - previous.insights.totalViews;
  const totalActions = current.insights.totalActions - previous.insights.totalActions;
  const top3 = current.ranking.top3 - previous.ranking.top3;
  const consistentCitations = current.citations.consistent - previous.citations.consistent;
  const postsCreated = current.posts.created - previous.posts.created;

  const net =
    Math.sign(reviewsCount) +
    Math.sign(averageRating) +
    Math.sign(totalViews) +
    Math.sign(totalActions) +
    Math.sign(top3) +
    Math.sign(consistentCitations) +
    Math.sign(postsCreated);
  const momentum = net > 0 ? "improving" : net < 0 ? "declining" : "steady";

  return { reviewsCount, averageRating, totalViews, totalActions, top3, consistentCitations, postsCreated, momentum };
}

function num(obj: unknown, ...path: string[]): number {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return 0;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : 0;
}

/**
 * Pure: best-effort reconstruct a ReportSnapshot from a previously stored report
 * `data` blob (used to compare a new report against the prior period). Returns
 * null when the blob is missing the expected sections.
 */
export function snapshotFromReportData(data: unknown): ReportSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!("reviews" in d) || !("insights" in d) || !("ranking" in d) || !("citations" in d) || !("posts" in d)) {
    return null;
  }
  return {
    reviews: { count: num(d, "reviews", "count"), average: num(d, "reviews", "average"), unanswered: num(d, "reviews", "unanswered") },
    insights: { totalViews: num(d, "insights", "totalViews"), totalActions: num(d, "insights", "totalActions"), actionRate: num(d, "insights", "actionRate") },
    ranking: {
      trackedKeywords: num(d, "ranking", "trackedKeywords"),
      top3: num(d, "ranking", "top3"),
      top10: num(d, "ranking", "top10"),
      notFound: num(d, "ranking", "notFound"),
    },
    citations: { total: num(d, "citations", "total"), consistent: num(d, "citations", "consistent") },
    posts: { created: num(d, "posts", "created") },
  };
}

/**
 * Compact WhatsApp-ready text for a report (planning PDF §6: "WhatsApp report
 * sharing" hook). Plain text — title, period, the narrative summary, the
 * vs-last-period line when present, and up to 3 action items. Pure.
 */
export function buildReportWhatsAppText(
  report: {
    type: string;
    periodStart: Date | string;
    periodEnd: Date | string;
    summary: string | null;
    data?: unknown;
    actionPlan?: unknown;
  },
  issuerName = "NexaFlow AI",
): string {
  const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
  const lines = [
    `📊 ${issuerName} — Google Business report (${report.type})`,
    `Period: ${day(report.periodStart)} → ${day(report.periodEnd)}`,
  ];
  if (report.summary) lines.push("", report.summary);
  const data = report.data as Record<string, unknown> | null | undefined;
  const trend = data && typeof data === "object" ? (data.trend as ReportTrend | undefined) : undefined;
  if (trend && typeof trend === "object") {
    const s = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    lines.push(
      "",
      `Vs last period (${trend.momentum}): ${s(trend.reviewsCount)} reviews · ${s(trend.totalViews)} views · ${s(trend.totalActions)} actions`,
    );
  }
  const plan = Array.isArray(report.actionPlan)
    ? (report.actionPlan as Array<{ priority?: string; task?: string }>)
    : [];
  if (plan.length > 0) {
    lines.push("", "Next actions:");
    for (const item of plan.slice(0, 3)) {
      lines.push(`• ${item.task ?? ""}`);
    }
  }
  return lines.join("\n").slice(0, 3500);
}

/**
 * White-label issuer for a tenant's reports (planning PDF §4 "Report Templates:
 * white-label branding"). When the tenant sits under a reseller/agency, the
 * report carries that partner's brand; otherwise the platform default.
 */
export async function resolveReportIssuer(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { parentTenant: { select: { name: true } } },
  });
  return tenant?.parentTenant?.name?.trim() || "NexaFlow AI";
}

interface ReportRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  type: GmbReportType;
  periodStart: Date;
  periodEnd: Date;
  data: Prisma.JsonValue;
  summary: string | null;
  actionPlan: Prisma.JsonValue | null;
  createdAt: Date;
}

/** Safe view — never leaks tenantId or the generator's user id. */
export function toSafeReport(row: ReportRow) {
  return {
    id: row.id,
    locationId: row.locationId,
    type: row.type,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    data: row.data,
    summary: row.summary,
    actionPlan: row.actionPlan,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

async function assertLocationOwned(tenantId: string, locationId: string) {
  const loc = await prisma.gmbLocation.findFirst({ where: { id: locationId, tenantId }, select: { id: true } });
  if (!loc) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
}

async function aggregateRanking(tenantId: string, locationId?: string) {
  const keywords = await prisma.gmbTrackedKeyword.findMany({
    where: { tenantId, isActive: true, ...(locationId ? { locationId } : {}) },
    include: { snapshots: { orderBy: { checkedAt: "desc" }, take: 1 } },
  });
  let top3 = 0;
  let top10 = 0;
  let notFound = 0;
  for (const k of keywords) {
    const latest = k.snapshots[0]?.rank ?? null;
    const bucket = rankBucket(latest);
    if (bucket === "top3") top3 += 1;
    else if (bucket === "top10") top10 += 1;
    else if (bucket === "not_found") notFound += 1;
  }
  return { trackedKeywords: keywords.length, top3, top10, notFound };
}

export interface GenerateReportInput {
  locationId?: string;
  type?: GmbReportType;
  periodStart: string;
  periodEnd: string;
  generatedByUserId?: string;
}

/**
 * Report narrative via the live LLM gateway, driven by the Super-Admin's
 * `gmb.report` prompt (or its seed). The deterministic narrative doubles as
 * the grounding fact sheet, so the model can rephrase but not invent numbers.
 * Falls back to that same deterministic narrative on any failure.
 */
async function draftReportNarrativeWithAi(
  tenantId: string,
  businessName: string | null,
  snapshot: ReportSnapshot,
  trend: ReportTrend | null,
): Promise<string> {
  const fallback = buildReportNarrative(snapshot);
  try {
    const resolved = await resolveFeaturePrompt(GMB_PROMPT_KEYS.report, reportVariables({ businessName }));
    const facts = [
      `Facts (do not invent numbers): ${fallback}`,
      trend
        ? `Vs last period (${trend.momentum}): ${trend.reviewsCount} reviews, ${trend.averageRating} rating, ${trend.totalViews} views, ${trend.totalActions} actions, ${trend.top3} top-3 keywords.`
        : "",
    ].filter(Boolean);
    const out = await runTenantLlmJson<{ summary: string }>({
      tenantId,
      feature: "gmb_report",
      system:
        "You summarize Google Business Profile performance for a business owner. 3–4 plain, encouraging sentences; use only the numbers given; no markdown, no greetings.",
      prompt: `${resolved.text}\n${facts.join("\n")}\nReturn JSON: {"summary":"..."}`,
      maxTokens: 350,
      temperature: 0.5,
    });
    const summary = out?.summary?.trim();
    return summary ? summary.slice(0, 1200) : fallback;
  } catch {
    return fallback;
  }
}

export async function generateReport(tenantId: string, input: GenerateReportInput) {
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid period dates.");
  }
  if (periodEnd < periodStart) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "periodEnd must be on or after periodStart.");
  }
  if (input.locationId) await assertLocationOwned(tenantId, input.locationId);

  const [reviews, insights, citations, ranking, posts] = await Promise.all([
    getReputationSummary(tenantId, input.locationId),
    getInsightsSummary(tenantId, { locationId: input.locationId, from: input.periodStart, to: input.periodEnd }),
    getCitationSummary(tenantId, input.locationId),
    aggregateRanking(tenantId, input.locationId),
    prisma.gmbPost.count({ where: { tenantId, createdAt: { gte: periodStart, lte: periodEnd } } }),
  ]);

  const snapshot: ReportSnapshot = {
    reviews: { count: reviews.count, average: reviews.average, unanswered: reviews.unanswered },
    insights: {
      totalViews: insights.totalViews,
      totalActions: insights.totalActions,
      actionRate: insights.actionRate,
    },
    ranking,
    citations: { total: citations.total, consistent: citations.consistent },
    posts: { created: posts },
  };
  // Compare against the most recent prior report of the same scope (if any).
  const previous = await prisma.gmbReport.findFirst({
    where: {
      tenantId,
      type: input.type ?? GmbReportType.MONTHLY,
      locationId: input.locationId ?? null,
      periodEnd: { lt: periodStart },
    },
    orderBy: { periodEnd: "desc" },
    select: { data: true },
  });
  const prevSnapshot = previous ? snapshotFromReportData(previous.data) : null;
  const trend = prevSnapshot ? compareReportSnapshots(snapshot, prevSnapshot) : null;

  // Store the full module summaries (richer than the snapshot) for the UI.
  const data = { reviews, insights, citations, ranking, posts: { created: posts }, ...(trend ? { trend } : {}) };
  const location = input.locationId
    ? await prisma.gmbLocation.findFirst({ where: { id: input.locationId, tenantId }, select: { name: true } })
    : null;
  const summary = await draftReportNarrativeWithAi(tenantId, location?.name ?? null, snapshot, trend);
  const actionPlan = buildActionPlan(snapshot);

  const row = await prisma.gmbReport.create({
    data: {
      tenantId,
      locationId: input.locationId ?? null,
      type: input.type ?? GmbReportType.MONTHLY,
      periodStart,
      periodEnd,
      data: data as unknown as Prisma.InputJsonValue,
      summary,
      actionPlan: actionPlan as unknown as Prisma.InputJsonValue,
      generatedByUserId: input.generatedByUserId ?? null,
    },
  });
  return toSafeReport(row);
}

export interface ListReportsFilter {
  locationId?: string;
  type?: GmbReportType;
}

export async function listReports(tenantId: string, filter: ListReportsFilter = {}) {
  const rows = await prisma.gmbReport.findMany({
    where: {
      tenantId,
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSafeReport);
}

async function findReportOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbReport.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Report not found.");
  return row;
}

export async function getReport(tenantId: string, id: string) {
  return toSafeReport(await findReportOrThrow(tenantId, id));
}

export async function deleteReport(tenantId: string, id: string) {
  await findReportOrThrow(tenantId, id);
  await prisma.gmbReport.delete({ where: { id } });
}
