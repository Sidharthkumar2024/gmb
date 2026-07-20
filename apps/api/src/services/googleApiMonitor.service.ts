import { prisma, GoogleApiLogStatus } from "@nexaflow/db";

// =====================================================================
// AdGrowly / platform — Google API Monitor (planning PDF §4). Records Google
// Business Profile API interactions and derives per-location connection health
// (token/sync status, recent errors, rate limits) for the Super-Admin monitor.
// Pure helpers (log summary + connection-state derivation) are unit-tested.
// =====================================================================

export type ConnectionState = "CONNECTED" | "STALE" | "ERROR" | "DISCONNECTED";

export interface ConnectionInput {
  hasCredential: boolean;
  lastSyncedAt: Date | string | null;
  recentErrorCount: number;
  now?: Date;
  staleHours?: number;
}

/**
 * Derive a location's Google connection state. Priority: no credential →
 * DISCONNECTED; recent errors → ERROR; never/old sync → STALE; else CONNECTED.
 */
export function deriveConnectionState(input: ConnectionInput): ConnectionState {
  if (!input.hasCredential) return "DISCONNECTED";
  if (input.recentErrorCount > 0) return "ERROR";
  const staleHours = input.staleHours ?? 24;
  const now = input.now ?? new Date();
  if (!input.lastSyncedAt) return "STALE";
  const ageHours = (now.getTime() - new Date(input.lastSyncedAt).getTime()) / 3_600_000;
  return ageHours > staleHours ? "STALE" : "CONNECTED";
}

export interface LogSummary {
  total: number;
  ok: number;
  errors: number;
  rateLimited: number;
  errorRate: number;
  lastErrorAt: Date | null;
}

/** Aggregate a set of API logs into counts + error rate + last error time. */
export function summarizeLogs(
  logs: Array<{ status: GoogleApiLogStatus; createdAt: Date | string }>,
): LogSummary {
  let ok = 0;
  let errors = 0;
  let rateLimited = 0;
  let lastErrorAt: Date | null = null;
  for (const l of logs) {
    if (l.status === GoogleApiLogStatus.OK) ok += 1;
    else {
      if (l.status === GoogleApiLogStatus.ERROR) errors += 1;
      else if (l.status === GoogleApiLogStatus.RATE_LIMITED) rateLimited += 1;
      const at = new Date(l.createdAt);
      if (!lastErrorAt || at > lastErrorAt) lastErrorAt = at;
    }
  }
  const total = logs.length;
  const errorRate = total ? Math.round(((errors + rateLimited) / total) * 10000) / 10000 : 0;
  return { total, ok, errors, rateLimited, errorRate, lastErrorAt };
}

interface LogRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  operation: string;
  status: GoogleApiLogStatus;
  statusCode: number | null;
  message: string | null;
  rateLimitRemaining: number | null;
  durationMs: number | null;
  createdAt: Date;
}

export function toSafeLog(row: LogRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    locationId: row.locationId,
    operation: row.operation,
    status: row.status,
    statusCode: row.statusCode,
    message: row.message,
    rateLimitRemaining: row.rateLimitRemaining,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (platform-scoped — SUPER_ADMIN reads)
// ---------------------------------------------------------------------

export interface RecordLogInput {
  tenantId: string;
  locationId?: string | null;
  operation: string;
  status?: GoogleApiLogStatus;
  statusCode?: number;
  message?: string;
  rateLimitRemaining?: number;
  durationMs?: number;
}

/** Append a Google API log entry (called by sync workers or integrations). */
export async function recordLog(input: RecordLogInput) {
  const row = await prisma.googleApiLog.create({
    data: {
      tenantId: input.tenantId,
      locationId: input.locationId?.trim() || null,
      operation: input.operation.trim(),
      status: input.status ?? GoogleApiLogStatus.OK,
      statusCode: input.statusCode ?? null,
      message: input.message?.trim() || null,
      rateLimitRemaining: input.rateLimitRemaining ?? null,
      durationMs: input.durationMs ?? null,
    },
  });
  return toSafeLog(row);
}

export interface ListLogsFilter {
  tenantId?: string;
  locationId?: string;
  status?: GoogleApiLogStatus;
  limit?: number;
}

export async function listLogs(filter: ListLogsFilter = {}) {
  const rows = await prisma.googleApiLog.findMany({
    where: {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, filter.limit ?? 100)),
  });
  return rows.map(toSafeLog);
}

const ERROR_WINDOW_HOURS = 24;

export interface MonitorOverviewFilter {
  tenantId?: string;
}

/** Per-location connection health across the platform (or one tenant). */
export async function getMonitorOverview(filter: MonitorOverviewFilter = {}) {
  const now = new Date();
  const since = new Date(now.getTime() - ERROR_WINDOW_HOURS * 3_600_000);

  const locations = await prisma.gmbLocation.findMany({
    where: { ...(filter.tenantId ? { tenantId: filter.tenantId } : {}) },
    select: { id: true, name: true, tenantId: true, secretId: true, lastSyncedAt: true },
  });

  const errorGroups = await prisma.googleApiLog.groupBy({
    by: ["locationId"],
    where: {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      status: { in: [GoogleApiLogStatus.ERROR, GoogleApiLogStatus.RATE_LIMITED] },
      createdAt: { gte: since },
      locationId: { not: null },
    },
    _count: { _all: true },
  });
  const errorByLocation = new Map<string, number>();
  for (const g of errorGroups) if (g.locationId) errorByLocation.set(g.locationId, g._count._all);

  const summary: Record<ConnectionState, number> = { CONNECTED: 0, STALE: 0, ERROR: 0, DISCONNECTED: 0 };
  const items = locations.map((loc) => {
    const recentErrorCount = errorByLocation.get(loc.id) ?? 0;
    const state = deriveConnectionState({
      hasCredential: Boolean(loc.secretId),
      lastSyncedAt: loc.lastSyncedAt,
      recentErrorCount,
      now,
    });
    summary[state] += 1;
    return {
      locationId: loc.id,
      name: loc.name,
      tenantId: loc.tenantId,
      state,
      hasCredential: Boolean(loc.secretId),
      lastSyncedAt: loc.lastSyncedAt,
      recentErrorCount,
    };
  });

  return { generatedAt: now, windowHours: ERROR_WINDOW_HOURS, total: items.length, summary, locations: items };
}
