import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { evaluateRankAlerts } from "./gmbRankAlert.service";

// =====================================================================
// AdGrowly GMB — Local ranking tracker (planning PDF). Operators track
// keywords per location and capture local-rank snapshots over time. A null
// rank means "not found in the checked window". Pure helpers (bucketing +
// trend) are split out for unit testing; live grid/SERP capture wires into
// `recordSnapshot` later without changing the route contract.
// =====================================================================

interface KeywordRow {
  id: string;
  tenantId: string;
  locationId: string;
  keyword: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface SnapshotRow {
  id: string;
  tenantId: string;
  keywordId: string;
  rank: number | null;
  source: string | null;
  checkedAt: Date;
  createdAt: Date;
}

export type RankBucket = "top3" | "top10" | "beyond" | "not_found";

/** Classify a rank into a coarse bucket for dashboards/badges. */
export function rankBucket(rank: number | null | undefined): RankBucket {
  if (rank == null) return "not_found";
  if (rank <= 3) return "top3";
  if (rank <= 10) return "top10";
  return "beyond";
}

export interface RankTrend {
  latest: number | null;
  previous: number | null;
  /** Positions improved since the previous check (positive = moved up). */
  delta: number | null;
  best: number | null;
  average: number | null;
  checks: number;
  bucket: RankBucket;
}

/**
 * Summarize a keyword's rank history. Input may be in any order; we sort by
 * checkedAt descending internally so `latest` is the most recent check. Lower
 * rank numbers are better, so delta = previous - latest.
 */
export function summarizeRankTrend(
  snapshots: Array<{ rank: number | null; checkedAt: Date | string }>,
): RankTrend {
  const sorted = [...snapshots].sort(
    (a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime(),
  );
  const latest = sorted.length ? sorted[0].rank : null;
  const previous = sorted.length > 1 ? sorted[1].rank : null;
  const delta = latest != null && previous != null ? previous - latest : null;

  const ranked = sorted.map((s) => s.rank).filter((r): r is number => r != null);
  const best = ranked.length ? Math.min(...ranked) : null;
  const average = ranked.length
    ? Math.round((ranked.reduce((a, b) => a + b, 0) / ranked.length) * 100) / 100
    : null;

  return { latest, previous, delta, best, average, checks: sorted.length, bucket: rankBucket(latest) };
}

export interface RankDistribution {
  total: number;
  top3: number;
  top10: number; // ranks 4–10
  beyond: number;
  notFound: number;
  /** Keywords with any known rank (top3 + top10 + beyond). */
  ranking: number;
  /** 0–100 weighted visibility score: top3 = 1.0, top10 = 0.5, else 0. */
  visibilityScore: number;
}

/**
 * Aggregate many keywords' latest ranks into a bucket distribution plus a
 * weighted 0–100 visibility score for the Rankings dashboard. Pure; buckets via
 * rankBucket so the thresholds stay in one place.
 */
export function rankDistribution(ranks: Array<number | null | undefined>): RankDistribution {
  let top3 = 0;
  let top10 = 0;
  let beyond = 0;
  let notFound = 0;
  for (const r of ranks) {
    switch (rankBucket(r)) {
      case "top3":
        top3 += 1;
        break;
      case "top10":
        top10 += 1;
        break;
      case "beyond":
        beyond += 1;
        break;
      default:
        notFound += 1;
    }
  }
  const total = ranks.length;
  const visibilityScore = total > 0 ? Math.round(((top3 + top10 * 0.5) / total) * 100) : 0;
  return { total, top3, top10, beyond, notFound, ranking: top3 + top10 + beyond, visibilityScore };
}

export function toSafeKeyword(row: KeywordRow) {
  return {
    id: row.id,
    locationId: row.locationId,
    keyword: row.keyword,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toSafeSnapshot(row: SnapshotRow) {
  return {
    id: row.id,
    keywordId: row.keywordId,
    rank: row.rank,
    bucket: rankBucket(row.rank),
    source: row.source,
    checkedAt: row.checkedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

async function findLocationOrThrow(tenantId: string, locationId: string) {
  const loc = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true },
  });
  if (!loc) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  return loc;
}

async function findKeywordOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbTrackedKeyword.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tracked keyword not found.");
  return row;
}

export interface ListKeywordsFilter {
  locationId?: string;
  activeOnly?: boolean;
}

export async function listKeywords(tenantId: string, filter: ListKeywordsFilter = {}) {
  const rows = await prisma.gmbTrackedKeyword.findMany({
    where: {
      tenantId,
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      ...(filter.activeOnly ? { isActive: true } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      snapshots: { orderBy: { checkedAt: "desc" }, take: 1, select: { rank: true, checkedAt: true } },
    },
  });
  // Carry each keyword's latest check so list views can show buckets and a
  // portfolio visibility summary without fetching every trend.
  return rows.map((row) => {
    const latest = row.snapshots[0];
    return {
      ...toSafeKeyword(row),
      latestRank: latest ? latest.rank : null,
      bucket: latest ? rankBucket(latest.rank) : null,
      lastCheckedAt: latest?.checkedAt ?? null,
    };
  });
}

export interface AddKeywordInput {
  locationId: string;
  keyword: string;
  createdByUserId?: string;
}

export async function addKeyword(tenantId: string, input: AddKeywordInput) {
  const keyword = input.keyword.trim();
  if (!keyword) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A keyword is required.");
  }
  await findLocationOrThrow(tenantId, input.locationId);
  const existing = await prisma.gmbTrackedKeyword.findFirst({
    where: { locationId: input.locationId, keyword },
    select: { id: true },
  });
  if (existing) {
    throw new ApiError(ErrorCodes.CONFLICT, 409, "That keyword is already tracked for this location.");
  }
  const row = await prisma.gmbTrackedKeyword.create({
    data: {
      tenantId,
      locationId: input.locationId,
      keyword,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeKeyword(row);
}

const TREND_WINDOW = 30;

/** Keyword with its latest rank, computed trend, and recent snapshots. */
export async function getKeywordWithTrend(tenantId: string, id: string) {
  const keyword = await findKeywordOrThrow(tenantId, id);
  const snapshots = await prisma.gmbRankSnapshot.findMany({
    where: { keywordId: id },
    orderBy: { checkedAt: "desc" },
    take: TREND_WINDOW,
  });
  return {
    ...toSafeKeyword(keyword),
    trend: summarizeRankTrend(snapshots),
    snapshots: snapshots.map(toSafeSnapshot),
  };
}

export async function setKeywordActive(tenantId: string, id: string, isActive: boolean) {
  await findKeywordOrThrow(tenantId, id);
  const row = await prisma.gmbTrackedKeyword.update({ where: { id }, data: { isActive } });
  return toSafeKeyword(row);
}

export async function deleteKeyword(tenantId: string, id: string) {
  await findKeywordOrThrow(tenantId, id);
  await prisma.gmbTrackedKeyword.delete({ where: { id } });
}

export interface RecordSnapshotInput {
  rank?: number | null;
  source?: string;
  checkedAt?: string;
}

export async function recordSnapshot(tenantId: string, keywordId: string, input: RecordSnapshotInput) {
  if (input.rank != null && (!Number.isInteger(input.rank) || input.rank < 1)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Rank must be a positive integer or null (not found).");
  }
  await findKeywordOrThrow(tenantId, keywordId);
  const row = await prisma.gmbRankSnapshot.create({
    data: {
      tenantId,
      keywordId,
      rank: input.rank ?? null,
      source: input.source?.trim() || null,
      ...(input.checkedAt ? { checkedAt: new Date(input.checkedAt) } : {}),
    },
  });
  // Rank-drop alert rules: fire-and-forget — alerting must never break a
  // rank check (the evaluator swallows its own errors).
  void evaluateRankAlerts(tenantId, keywordId, row.rank);
  return toSafeSnapshot(row);
}

export async function listSnapshots(tenantId: string, keywordId: string, limit = TREND_WINDOW) {
  await findKeywordOrThrow(tenantId, keywordId);
  const rows = await prisma.gmbRankSnapshot.findMany({
    where: { keywordId },
    orderBy: { checkedAt: "desc" },
    take: Math.min(200, Math.max(1, limit)),
  });
  return rows.map(toSafeSnapshot);
}
