import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { recordLocationSync } from "./gmbLocation.service";
import {
  syncGoogleReviewsForLocation,
  syncGoogleInsightsForLocation,
} from "./gmbGoogle.service";

// =====================================================================
// AdGrowly GMB — Business Profile sync (planning PDF §3 Connect GMB). Records a
// sync for a location, refreshing its rating / review count / verification
// state and stamping lastSyncedAt (reuses gmbLocation.recordLocationSync). The
// live Google Business Profile fetch wires into `syncLocation` later (replacing
// caller-supplied `incoming` with the GBP API response). Pure helpers
// (isSyncDue / mergeLocationStats) are unit-tested.
// =====================================================================

/** True when a location has never synced or its last sync is older than the interval. */
export function isSyncDue(
  lastSyncedAt: Date | string | null,
  intervalHours: number,
  now: Date = new Date(),
): boolean {
  if (!lastSyncedAt) return true;
  const ageHours = (now.getTime() - new Date(lastSyncedAt).getTime()) / 3_600_000;
  return ageHours >= intervalHours;
}

export interface LocationStats {
  rating: number | null;
  reviewCount: number;
  verificationState: string | null;
}

/** Merge incoming sync values over current stats; only provided fields change. */
export function mergeLocationStats(current: LocationStats, incoming: Partial<LocationStats>): LocationStats {
  return {
    rating: incoming.rating !== undefined ? incoming.rating : current.rating,
    reviewCount:
      incoming.reviewCount !== undefined
        ? Math.max(0, Math.trunc(incoming.reviewCount))
        : current.reviewCount,
    verificationState:
      incoming.verificationState !== undefined ? incoming.verificationState : current.verificationState,
  };
}

const SYNC_INTERVAL_HOURS = 24;

async function findStatsOrThrow(tenantId: string, locationId: string) {
  const loc = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: { rating: true, reviewCount: true, verificationState: true },
  });
  if (!loc) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  return loc;
}

export interface SyncInput {
  rating?: number;
  reviewCount?: number;
  verificationState?: string;
  source?: "MANUAL" | "GOOGLE";
}

export async function syncLocation(tenantId: string, locationId: string, incoming: SyncInput = {}) {
  const current = await findStatsOrThrow(tenantId, locationId);
  const liveIncoming = incoming.source === "GOOGLE"
    ? await syncGoogleReviewsForLocation(tenantId, locationId)
    : incoming;
  // Live sync also refreshes the 30-day insights snapshot (best-effort —
  // the Performance API needs its own scope grant; a failure there
  // shouldn't void the review sync that already succeeded).
  if (incoming.source === "GOOGLE") {
    await syncGoogleInsightsForLocation(tenantId, locationId).catch((err) => {
      console.warn(
        `[gmb-sync] insights fetch failed for location ${locationId}:`,
        (err as Error).message,
      );
    });
  }
  const merged = mergeLocationStats(current, liveIncoming);

  // recordLocationSync takes only defined scalar fields; map the merged view.
  const data: SyncInput = { reviewCount: merged.reviewCount };
  if (merged.rating != null) data.rating = merged.rating;
  if (merged.verificationState != null) data.verificationState = merged.verificationState;

  const location = await recordLocationSync(tenantId, locationId, data);
  return {
    ...location,
    syncSource: liveIncoming.source ?? "MANUAL",
    importedReviews: "imported" in liveIncoming ? liveIncoming.imported : 0,
    updatedReviews: "updated" in liveIncoming ? liveIncoming.updated : 0,
  };
}

export async function listSyncStatus(tenantId: string, now: Date = new Date()) {
  const rows = await prisma.gmbLocation.findMany({
    where: { tenantId },
    select: { id: true, name: true, status: true, lastSyncedAt: true },
    orderBy: { name: "asc" },
  });
  return rows.map((l) => ({
    locationId: l.id,
    name: l.name,
    status: l.status,
    lastSyncedAt: l.lastSyncedAt,
    due: isSyncDue(l.lastSyncedAt, SYNC_INTERVAL_HOURS, now),
  }));
}
