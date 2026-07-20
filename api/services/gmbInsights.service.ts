import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// AdGrowly GMB — Insights service (planning PDF). Periodic Business Profile
// performance snapshots per location. Metrics mirror the GBP performance API;
// a re-sync of the same period upserts the row. Derived totals (views /
// searches / actions) are computed here — never stored — and the aggregation
// helper drives the insights dashboard. Pure helpers are unit-tested.
// =====================================================================

export interface InsightMetrics {
  mapsViews: number;
  searchViews: number;
  directSearches: number;
  discoverySearches: number;
  brandedSearches: number;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  messageClicks: number;
  bookingClicks: number;
  photoViews: number;
}

const METRIC_KEYS: (keyof InsightMetrics)[] = [
  "mapsViews",
  "searchViews",
  "directSearches",
  "discoverySearches",
  "brandedSearches",
  "callClicks",
  "websiteClicks",
  "directionRequests",
  "messageClicks",
  "bookingClicks",
  "photoViews",
];

interface InsightRow extends InsightMetrics {
  id: string;
  tenantId: string;
  locationId: string;
  periodStart: Date;
  periodEnd: Date;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function zeroMetrics(): InsightMetrics {
  return {
    mapsViews: 0,
    searchViews: 0,
    directSearches: 0,
    discoverySearches: 0,
    brandedSearches: 0,
    callClicks: 0,
    websiteClicks: 0,
    directionRequests: 0,
    messageClicks: 0,
    bookingClicks: 0,
    photoViews: 0,
  };
}

function pickMetrics(src: InsightMetrics): InsightMetrics {
  const out = zeroMetrics();
  for (const k of METRIC_KEYS) out[k] = src[k];
  return out;
}

export interface InsightTotals {
  totalViews: number;
  totalSearches: number;
  totalActions: number;
}

/** Derived rollups (lower-level metrics aggregated into headline numbers). */
export function deriveInsightTotals(m: InsightMetrics): InsightTotals {
  return {
    totalViews: m.mapsViews + m.searchViews,
    totalSearches: m.directSearches + m.discoverySearches + m.brandedSearches,
    totalActions:
      m.callClicks + m.websiteClicks + m.directionRequests + m.messageClicks + m.bookingClicks,
  };
}

/** Conversion of profile views into customer actions, as a 0–1 ratio. */
export function actionRate(totalActions: number, totalViews: number): number {
  if (totalViews <= 0) return 0;
  return Math.round((totalActions / totalViews) * 10000) / 10000;
}

export interface InsightDelta {
  current: number;
  previous: number;
  /** current − previous (raw points). */
  change: number;
  /** Relative change vs previous, as a percent rounded to 1 dp; 0 when previous is 0. */
  changePercent: number;
}

export interface InsightComparison {
  totalViews: InsightDelta;
  totalSearches: InsightDelta;
  totalActions: InsightDelta;
  actionRate: InsightDelta;
}

function delta(current: number, previous: number): InsightDelta {
  const change = Math.round((current - previous) * 10000) / 10000;
  const changePercent = previous > 0 ? Math.round((change / previous) * 1000) / 10 : 0;
  return { current, previous, change, changePercent };
}

/**
 * Period-over-period comparison of the headline insight totals (pure). Powers
 * trend arrows on the Insights page: each field carries current, previous, the
 * raw change and the percent change (guarded against divide-by-zero).
 */
export function compareInsightTotals(current: InsightMetrics, previous: InsightMetrics): InsightComparison {
  const c = deriveInsightTotals(current);
  const p = deriveInsightTotals(previous);
  return {
    totalViews: delta(c.totalViews, p.totalViews),
    totalSearches: delta(c.totalSearches, p.totalSearches),
    totalActions: delta(c.totalActions, p.totalActions),
    actionRate: delta(actionRate(c.totalActions, c.totalViews), actionRate(p.totalActions, p.totalViews)),
  };
}

export function toSafeInsight(row: InsightRow) {
  const metrics = pickMetrics(row);
  const totals = deriveInsightTotals(metrics);
  return {
    id: row.id,
    locationId: row.locationId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    source: row.source,
    ...metrics,
    ...totals,
    actionRate: actionRate(totals.totalActions, totals.totalViews),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface InsightsSummary extends InsightMetrics, InsightTotals {
  periods: number;
  actionRate: number;
  rangeStart: Date | null;
  rangeEnd: Date | null;
}

/** Sum metrics across snapshots and compute headline totals + action rate. */
export function summarizeInsights(
  rows: Array<InsightMetrics & { periodStart: Date | string; periodEnd: Date | string }>,
): InsightsSummary {
  const sums = zeroMetrics();
  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;
  for (const row of rows) {
    for (const k of METRIC_KEYS) sums[k] += row[k] ?? 0;
    const start = new Date(row.periodStart);
    const end = new Date(row.periodEnd);
    if (!rangeStart || start < rangeStart) rangeStart = start;
    if (!rangeEnd || end > rangeEnd) rangeEnd = end;
  }
  const totals = deriveInsightTotals(sums);
  return {
    ...sums,
    ...totals,
    actionRate: actionRate(totals.totalActions, totals.totalViews),
    periods: rows.length,
    rangeStart,
    rangeEnd,
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

const normMetric = (n: number | undefined) => Math.max(0, Math.trunc(n ?? 0));

export interface InsightFilter {
  locationId?: string;
  from?: string;
  to?: string;
}

function periodWhere(filter: InsightFilter) {
  const range: { gte?: Date; lte?: Date } = {};
  if (filter.from) range.gte = new Date(filter.from);
  if (filter.to) range.lte = new Date(filter.to);
  return {
    ...(filter.locationId ? { locationId: filter.locationId } : {}),
    ...(Object.keys(range).length ? { periodStart: range } : {}),
  };
}

export async function listInsights(tenantId: string, filter: InsightFilter = {}) {
  const rows = await prisma.gmbInsightSnapshot.findMany({
    where: { tenantId, ...periodWhere(filter) },
    orderBy: { periodStart: "desc" },
  });
  return rows.map(toSafeInsight);
}

export interface RecordInsightInput extends Partial<InsightMetrics> {
  locationId: string;
  periodStart: string;
  periodEnd: string;
  source?: string;
}

export async function recordInsight(tenantId: string, input: RecordInsightInput) {
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid period dates.");
  }
  if (periodEnd < periodStart) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "periodEnd must be on or after periodStart.");
  }
  await findLocationOrThrow(tenantId, input.locationId);

  const metrics = zeroMetrics();
  for (const k of METRIC_KEYS) metrics[k] = normMetric(input[k]);
  const source = input.source?.trim() || null;

  const row = await prisma.gmbInsightSnapshot.upsert({
    where: {
      locationId_periodStart_periodEnd: { locationId: input.locationId, periodStart, periodEnd },
    },
    create: { tenantId, locationId: input.locationId, periodStart, periodEnd, source, ...metrics },
    update: { source, ...metrics },
  });
  return toSafeInsight(row);
}

/** Sum raw metric rows into a single InsightMetrics (for period comparison). */
function aggregateMetrics(rows: InsightMetrics[]): InsightMetrics {
  const sums = zeroMetrics();
  for (const row of rows) for (const k of METRIC_KEYS) sums[k] += row[k] ?? 0;
  return sums;
}

export async function getInsightsSummary(tenantId: string, filter: InsightFilter = {}) {
  if (filter.locationId) await findLocationOrThrow(tenantId, filter.locationId);
  const rows = await prisma.gmbInsightSnapshot.findMany({
    where: { tenantId, ...periodWhere(filter) },
  });
  const summary = summarizeInsights(rows);

  // Period-over-period comparison against the equal-length window immediately
  // before [from, to] — only when an explicit, valid window is requested.
  let comparison: InsightComparison | null = null;
  if (filter.from && filter.to) {
    const from = new Date(filter.from);
    const to = new Date(filter.to);
    const spanMs = to.getTime() - from.getTime();
    if (Number.isFinite(spanMs) && spanMs > 0) {
      const prevTo = new Date(from.getTime() - 1);
      const prevFrom = new Date(from.getTime() - spanMs - 1);
      const prevRows = await prisma.gmbInsightSnapshot.findMany({
        where: {
          tenantId,
          ...(filter.locationId ? { locationId: filter.locationId } : {}),
          periodStart: { gte: prevFrom, lte: prevTo },
        },
      });
      if (prevRows.length > 0) {
        comparison = compareInsightTotals(aggregateMetrics(rows), aggregateMetrics(prevRows));
      }
    }
  }

  return { ...summary, comparison };
}

export async function deleteInsight(tenantId: string, id: string) {
  const row = await prisma.gmbInsightSnapshot.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Insight snapshot not found.");
  await prisma.gmbInsightSnapshot.delete({ where: { id } });
}
