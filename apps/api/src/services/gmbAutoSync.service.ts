// ============================================================================
// GMB auto-sync worker — makes reviews + insights AUTOMATIC.
//
// Before this worker, `syncGoogleReviewsForLocation` only ran when a
// customer clicked "Sync now", and insights had no Google fetch at all.
// Now every CONNECTED location with a Google credential gets:
//   - reviews pulled from the Business Profile API, and
//   - a 30-day insights snapshot from the Performance API,
// on a fixed cadence with zero customer action.
//
// Runs on its OWN dedicated queue (GMB_AUTO_SYNC). It previously piggybacked on
// the gmb-post-publisher queue, but multiple competing BullMQ Workers on one
// queue each receive only a share of the jobs — so an auto-sync job could be
// consumed by the post-publisher worker (which runs its own sweep and ignores
// the job name) and the sync would be silently skipped. A dedicated queue
// (mirroring gmbReportScheduler) guarantees every scheduled job runs the sync.
// Per-location failures are logged and skipped; one broken credential can't
// stall the fleet. Every Google call is logged to GoogleApiLog by googleJson.
// ============================================================================

import { Worker } from "bullmq";
import { prisma, GmbLocationStatus } from "@nexaflow/db";
import {
  getQueueConnection,
  getGmbAutoSyncQueue,
  getGmbPostPublisherQueue,
  QueueNames,
  trackWorker,
  type GmbAutoSyncJobData,
} from "../lib/queue";
import {
  syncGoogleReviewsForLocation,
  syncGoogleInsightsForLocation,
} from "./gmbGoogle.service";

const SYNC_INTERVAL_MS = Number(
  process.env.GMB_AUTO_SYNC_INTERVAL_MS ?? `${6 * 60 * 60 * 1000}`,
); // every 6 hours by default
const SYNC_JOB_NAME = "sweep";
// Job name used by the old piggyback on the gmb-post-publisher queue — removed
// on startup so a redeploy doesn't leave a stale scheduler enqueuing there.
const LEGACY_PIGGYBACK_JOB_NAME = "gmb-auto-sync";
const MAX_LOCATIONS_PER_SWEEP = 200;

// --- Quota pacing (GBP APIs default to ~300 QPM; bursts get 429) -----------
// Locations are synced with a fixed gap + jitter so a 200-location sweep
// spreads over minutes instead of hammering the API, and a quota error
// backs the sweep off exponentially instead of burning the remaining fleet
// against an exhausted quota.
const LOCATION_SPACING_MS = Number(
  process.env.GMB_AUTO_SYNC_LOCATION_SPACING_MS ?? "2000",
);
const QUOTA_BACKOFF_BASE_MS = Number(
  process.env.GMB_AUTO_SYNC_QUOTA_BACKOFF_BASE_MS ?? "30000",
);
const QUOTA_BACKOFF_CAP_MS = Number(
  process.env.GMB_AUTO_SYNC_QUOTA_BACKOFF_CAP_MS ?? `${5 * 60 * 1000}`,
);
const MAX_QUOTA_HITS_PER_SWEEP = Number(
  process.env.GMB_AUTO_SYNC_MAX_QUOTA_HITS ?? "5",
);

/** Google quota exhaustion, in any of the shapes our HTTP layer surfaces. */
export function isQuotaError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return (
    /\b429\b/.test(msg) ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    /rate.?limit/i.test(msg) ||
    /quota/i.test(msg)
  );
}

/**
 * Exponential backoff with jitter for consecutive quota hits. Pure — the
 * jitter source is injected so tests are deterministic.
 * hit 1 → ~base, hit 2 → ~2×base, … capped at capMs.
 */
export function computeQuotaBackoffMs(
  consecutiveHits: number,
  opts: { baseMs?: number; capMs?: number; jitter?: () => number } = {},
): number {
  const base = opts.baseMs ?? QUOTA_BACKOFF_BASE_MS;
  const cap = opts.capMs ?? QUOTA_BACKOFF_CAP_MS;
  const jitter = opts.jitter ?? Math.random;
  const hits = Math.max(1, consecutiveHits);
  const exp = Math.min(base * 2 ** (hits - 1), cap);
  // ±20% jitter so replicas don't retry in lock-step.
  return Math.round(exp * (0.8 + jitter() * 0.4));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GmbAutoSyncSummary {
  locations: number;
  reviewsSynced: number;
  insightsSynced: number;
  failed: number;
  /** Quota (429/RESOURCE_EXHAUSTED) errors observed during the sweep. */
  quotaHits: number;
  /** True when the sweep stopped early because quota kept failing. */
  aborted: boolean;
}

/** One pass over every Google-connected location. Exported for tests and
 *  the admin "run now" escape hatch. */
export async function sweepGmbAutoSync(): Promise<GmbAutoSyncSummary> {
  const locations = await prisma.gmbLocation.findMany({
    where: {
      status: GmbLocationStatus.CONNECTED,
      secretId: { not: null },
      placeId: { not: null },
    },
    select: { id: true, tenantId: true },
    take: MAX_LOCATIONS_PER_SWEEP,
    orderBy: { lastSyncedAt: "asc" }, // stalest first
  });

  const summary: GmbAutoSyncSummary = {
    locations: locations.length,
    reviewsSynced: 0,
    insightsSynced: 0,
    failed: 0,
    quotaHits: 0,
    aborted: false,
  };

  let consecutiveQuotaHits = 0;

  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    let ok = false;
    let quotaHitThisLocation = false;

    try {
      await syncGoogleReviewsForLocation(loc.tenantId, loc.id);
      summary.reviewsSynced += 1;
      ok = true;
    } catch (err) {
      if (isQuotaError(err)) quotaHitThisLocation = true;
      console.warn(
        `[gmb-auto-sync] review sync failed for location ${loc.id}:`,
        (err as Error).message,
      );
    }
    try {
      await syncGoogleInsightsForLocation(loc.tenantId, loc.id);
      summary.insightsSynced += 1;
      ok = true;
    } catch (err) {
      if (isQuotaError(err)) quotaHitThisLocation = true;
      console.warn(
        `[gmb-auto-sync] insights sync failed for location ${loc.id}:`,
        (err as Error).message,
      );
    }
    if (ok) {
      await prisma.gmbLocation
        .update({
          where: { id: loc.id },
          data: { lastSyncedAt: new Date() },
        })
        .catch(() => undefined);
    } else {
      summary.failed += 1;
    }

    // Quota pacing: back off exponentially on 429s; abort the sweep once the
    // quota keeps failing — the remaining locations are stalest-first next
    // sweep, so nothing is lost by stopping early.
    if (quotaHitThisLocation) {
      summary.quotaHits += 1;
      consecutiveQuotaHits += 1;
      if (consecutiveQuotaHits >= MAX_QUOTA_HITS_PER_SWEEP) {
        summary.aborted = true;
        console.warn(
          `[gmb-auto-sync] aborting sweep after ${consecutiveQuotaHits} consecutive quota errors (${locations.length - i - 1} locations deferred to the next sweep).`,
        );
        break;
      }
      const backoff = computeQuotaBackoffMs(consecutiveQuotaHits);
      console.warn(`[gmb-auto-sync] quota hit — backing off ${backoff}ms.`);
      await sleep(backoff);
    } else {
      consecutiveQuotaHits = 0;
      // Even spacing between locations so a full sweep never bursts the API.
      if (i < locations.length - 1) await sleep(LOCATION_SPACING_MS);
    }
  }

  return summary;
}

let gmbAutoSyncWorker: Worker<GmbAutoSyncJobData> | null = null;

export async function startGmbAutoSyncWorker(): Promise<void> {
  if (gmbAutoSyncWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[gmb-auto-sync] database unavailable; worker not started.");
    return;
  }

  // One-time migration: drop the old scheduler that enqueued onto the shared
  // gmb-post-publisher queue, so it stops firing after this deploy.
  await getGmbPostPublisherQueue()
    .removeJobScheduler(LEGACY_PIGGYBACK_JOB_NAME)
    .catch(() => undefined);

  const q = getGmbAutoSyncQueue();
  try {
    await q.removeJobScheduler(SYNC_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SYNC_JOB_NAME,
      { every: SYNC_INTERVAL_MS },
      { name: SYNC_JOB_NAME, data: { kind: "sweep" } },
    );
  } catch (err) {
    console.warn(
      "[gmb-auto-sync] could not register scheduler:",
      (err as Error).message,
    );
    return;
  }

  gmbAutoSyncWorker = new Worker<GmbAutoSyncJobData>(
    QueueNames.GMB_AUTO_SYNC,
    async () => {
      const summary = await sweepGmbAutoSync();
      if (summary.locations > 0) {
        console.log(
          `[gmb-auto-sync] swept ${summary.locations} location(s): ${summary.reviewsSynced} review syncs, ${summary.insightsSynced} insight syncs, ${summary.failed} fully failed`,
        );
      }
    },
    {
      connection: getQueueConnection(),
      concurrency: 1,
    },
  );
  gmbAutoSyncWorker.on("failed", (job, err) => {
    console.error(`[gmb-auto-sync] job ${job?.id} failed:`, err?.message);
  });
  gmbAutoSyncWorker.on("error", (err) => {
    console.error("[gmb-auto-sync] worker error:", err.message);
  });
  trackWorker(gmbAutoSyncWorker);
}

export function stopGmbAutoSyncWorker(): void {
  if (!gmbAutoSyncWorker) return;
  void gmbAutoSyncWorker.close();
  gmbAutoSyncWorker = null;
}
