import { prisma } from "@nexaflow/db";
import { getReputationSummary } from "./gmbReview.service";
import { getCitationSummary } from "./gmbCitation.service";
import { rankBucket } from "./gmbRanking.service";

// =====================================================================
// AdGrowly GMB — Customer Dashboard (planning PDF §3). A tenant-scoped read
// model aggregating reviews, ranking, citations, posts, credits and the latest
// advisor score into dashboard cards + alerts + a growth summary. No new
// storage. The alert engine + payload assembler are pure and unit-tested.
// =====================================================================

export type AlertSeverity = "high" | "medium" | "low";

export interface DashboardAlert {
  severity: AlertSeverity;
  area: string;
  message: string;
}

export interface AlertSignals {
  reviews: { count: number; average: number; unanswered: number };
  citations: { total: number; consistent: number };
  ranking: { trackedKeywords: number; top3: number };
  posts: { recent: number };
  connections: { total: number; connected: number };
  credits: number | null;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Derive prioritized dashboard alerts from aggregated signals. */
export function buildDashboardAlerts(s: AlertSignals): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  if (s.credits !== null && s.credits <= 0) {
    alerts.push({ severity: "high", area: "credits", message: "You are out of credits — top up to keep using AI features." });
  }
  if (s.reviews.unanswered > 0) {
    alerts.push({ severity: "high", area: "reviews", message: `${s.reviews.unanswered} review(s) awaiting a reply.` });
  }
  if (s.reviews.count > 0 && s.reviews.average < 4) {
    alerts.push({ severity: "high", area: "reviews", message: `Your average rating is ${s.reviews.average}★ — below 4.0.` });
  }
  if (s.connections.total > 0 && s.connections.connected < s.connections.total) {
    const n = s.connections.total - s.connections.connected;
    alerts.push({ severity: "medium", area: "connection", message: `${n} location(s) not connected to Google.` });
  }
  const inconsistent = s.citations.total - s.citations.consistent;
  if (s.citations.total > 0 && inconsistent > 0) {
    alerts.push({ severity: "medium", area: "citations", message: `${inconsistent} citation(s) have inconsistent NAP.` });
  }
  if (s.ranking.trackedKeywords === 0) {
    alerts.push({ severity: "low", area: "ranking", message: "No keywords are being tracked yet." });
  }
  if (s.posts.recent < 4) {
    alerts.push({ severity: "low", area: "content", message: `Only ${s.posts.recent} post(s) in the last 30 days.` });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export interface DashboardParts {
  connections: { total: number; connected: number };
  reviews: { count: number; average: number; unanswered: number };
  ranking: { trackedKeywords: number; top3: number; top10: number; notFound: number };
  citations: { total: number; consistent: number; consistencyScore: number };
  posts: { recent: number; total: number };
  credits: number | null;
  advisor: { score: number; grade: string; at: Date } | null;
  generatedAt: Date;
}

/** Shape the dashboard payload; business score comes from the latest advisor run. */
export function assembleDashboard(parts: DashboardParts) {
  const alerts = buildDashboardAlerts({
    reviews: parts.reviews,
    citations: parts.citations,
    ranking: parts.ranking,
    posts: parts.posts,
    connections: parts.connections,
    credits: parts.credits,
  });

  return {
    businessScore: parts.advisor ? parts.advisor.score : null,
    grade: parts.advisor ? parts.advisor.grade : null,
    locations: parts.connections,
    reviews: parts.reviews,
    ranking: parts.ranking,
    citations: parts.citations,
    posts: parts.posts,
    credits: parts.credits,
    advisor: parts.advisor,
    alerts,
    generatedAt: parts.generatedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed aggregation (tenant-scoped)
// ---------------------------------------------------------------------

const POST_WINDOW_DAYS = 30;

export async function getDashboard(tenantId: string, locationId?: string) {
  const now = new Date();
  const since = new Date(now.getTime() - POST_WINDOW_DAYS * 86_400_000);
  const locationFilter = locationId ? { locationId } : {};

  const [locations, reviews, citations, keywords, recentPosts, totalPosts, advisor, wallets] =
    await Promise.all([
      prisma.gmbLocation.findMany({
        where: { tenantId, ...(locationId ? { id: locationId } : {}) },
        select: { status: true },
      }),
      getReputationSummary(tenantId, locationId),
      getCitationSummary(tenantId, locationId),
      prisma.gmbTrackedKeyword.findMany({
        where: { tenantId, ...locationFilter, isActive: true },
        include: { snapshots: { orderBy: { checkedAt: "desc" }, take: 1 } },
      }),
      prisma.gmbPost.count({ where: { tenantId, createdAt: { gte: since } } }),
      prisma.gmbPost.count({ where: { tenantId } }),
      prisma.gmbAdvisorReport.findFirst({
        where: { tenantId, ...locationFilter },
        orderBy: { createdAt: "desc" },
        select: { score: true, grade: true, createdAt: true },
      }),
      prisma.wallet.findMany({ where: { tenantId }, select: { balanceCredits: true, reservedCredits: true } }),
    ]);

  let top3 = 0;
  let top10 = 0;
  let notFound = 0;
  for (const k of keywords) {
    const bucket = rankBucket(k.snapshots[0]?.rank ?? null);
    if (bucket === "top3") top3 += 1;
    else if (bucket === "top10") top10 += 1;
    else if (bucket === "not_found") notFound += 1;
  }

  const connected = locations.filter((l) => l.status === "CONNECTED").length;
  const credits = wallets.length
    ? wallets.reduce((sum, w) => sum + (w.balanceCredits - w.reservedCredits), 0)
    : null;

  return assembleDashboard({
    connections: { total: locations.length, connected },
    reviews: { count: reviews.count, average: reviews.average, unanswered: reviews.unanswered },
    ranking: { trackedKeywords: keywords.length, top3, top10, notFound },
    citations: {
      total: citations.total,
      consistent: citations.consistent,
      consistencyScore: citations.consistencyScore,
    },
    posts: { recent: recentPosts, total: totalPosts },
    credits,
    advisor: advisor ? { score: advisor.score, grade: advisor.grade, at: advisor.createdAt } : null,
    generatedAt: now,
  });
}
