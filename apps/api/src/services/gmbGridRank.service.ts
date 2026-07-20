// ============================================================================
// Grid rank tracker (Adgrowly GMB Panel design — "grid tracking").
//
// A capture lays an N×N lattice of map points around the location and asks,
// at every point, "where does this business rank in the local results for
// this keyword?" — the classic LocalFalcon-style heat map.
//
// Rank source: Google Places Text Search (New) with a per-point location
// bias, using GOOGLE_PLACES_API_KEY. The business is matched by its Google
// place resource (locations/… id can't be used directly, so we match on
// name + address overlap). When no API key is configured the capture
// endpoint fails with setup guidance — we never fabricate ranks.
//
// Derived stats (avgRank / top3Share / foundShare) are stored on the
// snapshot so the UI reads one row.
// ============================================================================

import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { evaluateRankAlerts } from "./gmbRankAlert.service";

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const MAX_RESULTS_PER_POINT = 20;

export interface GridPoint {
  lat: number;
  lng: number;
  rank: number | null;
}

export interface GridStats {
  avgRank: number | null;
  top3Share: number;
  foundShare: number;
}

/** Row-major N×N lattice centered on (lat, lng), edge at radiusKm. */
export function buildGrid(
  lat: number,
  lng: number,
  gridSize = 5,
  radiusKm = 2,
): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  const half = (gridSize - 1) / 2;
  const latDegPerKm = 1 / 110.574;
  const lngDegPerKm = 1 / (111.32 * Math.cos((lat * Math.PI) / 180) || 1);
  const stepKm = gridSize > 1 ? (radiusKm * 2) / (gridSize - 1) : 0;
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const dyKm = (row - half) * stepKm;
      const dxKm = (col - half) * stepKm;
      points.push({
        lat: lat + dyKm * latDegPerKm,
        lng: lng + dxKm * lngDegPerKm,
      });
    }
  }
  return points;
}

/** Pure stats over captured points — exported for tests. */
export function computeGridStats(points: GridPoint[]): GridStats {
  const found = points.filter((p) => p.rank !== null) as Array<
    GridPoint & { rank: number }
  >;
  if (points.length === 0) {
    return { avgRank: null, top3Share: 0, foundShare: 0 };
  }
  const avgRank =
    found.length > 0
      ? Math.round(
          (found.reduce((s, p) => s + p.rank, 0) / found.length) * 10,
        ) / 10
      : null;
  const top3Share =
    Math.round((found.filter((p) => p.rank <= 3).length / points.length) * 100) /
    100;
  const foundShare = Math.round((found.length / points.length) * 100) / 100;
  return { avgRank, top3Share, foundShare };
}

interface PlacesResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Match by name (and address hint when both sides have one). Exported for
 * tests — matching is the error-prone part of grid tracking.
 */
export function matchesBusiness(
  candidate: PlacesResult,
  business: { name: string; addressLine?: string | null },
): boolean {
  const candidateName = normalize(candidate.displayName?.text ?? "");
  const businessName = normalize(business.name);
  if (!candidateName || !businessName) return false;
  const nameMatch =
    candidateName.includes(businessName) || businessName.includes(candidateName);
  if (!nameMatch) return false;
  if (business.addressLine && candidate.formattedAddress) {
    // Loose address check: a short leading fragment (house number + street
    // start) must overlap. Kept short so "Rd" vs "Road" style abbreviation
    // differences later in the line don't reject the true listing.
    const street = normalize(business.addressLine).slice(0, 8);
    if (street && !normalize(candidate.formattedAddress).includes(street)) {
      return false;
    }
  }
  return true;
}

async function searchPlacesAtPoint(args: {
  apiKey: string;
  keyword: string;
  lat: number;
  lng: number;
}): Promise<PlacesResult[]> {
  const res = await fetch(PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": args.apiKey,
      // Essentials-tier fields only — adding rating/etc. would bump the
      // billing SKU of every grid point.
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
    },
    body: JSON.stringify({
      textQuery: args.keyword,
      pageSize: MAX_RESULTS_PER_POINT,
      locationBias: {
        circle: {
          center: { latitude: args.lat, longitude: args.lng },
          radius: 1000.0,
        },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Places search failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as { places?: PlacesResult[] };
  return body.places ?? [];
}

function rankInPlaces(
  places: PlacesResult[],
  business: { name: string; addressLine?: string | null },
): number | null {
  const idx = places.findIndex((p) => matchesBusiness(p, business));
  return idx === -1 ? null : idx + 1;
}

// --- Local leaderboard (Adgrowly GMB Panel design) --------------------------

export interface LeaderboardEntry {
  rank: number;
  name: string;
  /** True for the tenant's own business (matched like the rank check). */
  isYou: boolean;
}

const LEADERBOARD_LIMIT = 10;

/**
 * The ordered local results at one point, as a leaderboard. Pure — reuses the
 * same Places response as the rank check, so the leaderboard costs no extra
 * API call and can never disagree with the rank shown next to it.
 */
export function buildLocalLeaderboard(
  places: PlacesResult[],
  business: { name: string; addressLine?: string | null },
  limit = LEADERBOARD_LIMIT,
): LeaderboardEntry[] {
  return places.slice(0, Math.max(0, limit)).map((p, i) => ({
    rank: i + 1,
    name: p.displayName?.text?.trim() || "Unnamed business",
    isYou: matchesBusiness(p, business),
  }));
}

// --- Competitor battle map (Adgrowly GMB Panel design) ----------------------

export interface BattleMapRival {
  name: string;
  /** This rival's rank at each grid point, index-aligned with `points`.
   *  null = they didn't appear at that point. */
  ranks: Array<number | null>;
  /** Mean rank over the points where they appeared. Null = never found. */
  avgRank: number | null;
  /** 0..1 share of grid points where they appeared. */
  foundShare: number;
}

export interface BattleMap {
  rivals: BattleMapRival[];
}

const BATTLE_MAP_RIVAL_LIMIT = 5;

/**
 * Build a per-rival heat-map from the SAME per-point Places responses the rank
 * check already consumed — so the battle map costs no extra API call and can
 * never disagree with the grid beside it.
 *
 * Rivals are keyed by Places `id` when present (stable across renames /
 * formatting) and fall back to a normalized name. They're ranked by how often
 * they appear across the lattice, then by mean rank — i.e. the businesses
 * actually contesting this keyword in this area, not one-off blow-ins. Our own
 * listing is excluded (it's already the primary grid).
 *
 * Pure: `perPointPlaces` is index-aligned with the grid's points.
 */
export function buildBattleMap(
  perPointPlaces: PlacesResult[][],
  business: { name: string; addressLine?: string | null },
  limit = BATTLE_MAP_RIVAL_LIMIT,
): BattleMap {
  const pointCount = perPointPlaces.length;
  if (pointCount === 0 || limit <= 0) return { rivals: [] };

  interface Agg {
    name: string;
    ranks: Array<number | null>;
    found: number;
    rankSum: number;
  }
  const byKey = new Map<string, Agg>();

  perPointPlaces.forEach((places, pointIdx) => {
    places.forEach((place, i) => {
      if (matchesBusiness(place, business)) return; // that's us
      const name = place.displayName?.text?.trim() || "Unnamed business";
      const key = place.id?.trim() || normalize(name);
      if (!key) return;
      let agg = byKey.get(key);
      if (!agg) {
        agg = { name, ranks: new Array(pointCount).fill(null), found: 0, rankSum: 0 };
        byKey.set(key, agg);
      }
      // First occurrence at a point wins (Places returns best match first);
      // guards against a duplicate listing skewing the rank.
      if (agg.ranks[pointIdx] === null) {
        agg.ranks[pointIdx] = i + 1;
        agg.found += 1;
        agg.rankSum += i + 1;
      }
    });
  });

  const rivals = [...byKey.values()]
    .map((a) => ({
      name: a.name,
      ranks: a.ranks,
      avgRank: a.found > 0 ? Math.round((a.rankSum / a.found) * 10) / 10 : null,
      foundShare: Math.round((a.found / pointCount) * 100) / 100,
    }))
    .sort(
      (x, y) =>
        y.foundShare - x.foundShare ||
        (x.avgRank ?? Infinity) - (y.avgRank ?? Infinity) ||
        x.name.localeCompare(y.name),
    )
    .slice(0, limit);

  return { rivals };
}

export interface GridCaptureResult {
  snapshotId: string;
  gridSize: number;
  radiusKm: number;
  points: GridPoint[];
  stats: GridStats;
  /** Ordered local results at the grid's centre point ("Local leaderboard").
   *  Empty for manual/legacy snapshots. */
  leaderboard: LeaderboardEntry[];
  /** Per-rival heat-maps over the same lattice ("Competitor battle map").
   *  Empty for manual/legacy snapshots. */
  battleMap: BattleMap;
  capturedAt: Date;
}

/**
 * Capture a grid snapshot for a tracked keyword. Requires the location to
 * have coordinates and GOOGLE_PLACES_API_KEY to be configured.
 */
export async function captureGridSnapshot(args: {
  tenantId: string;
  keywordId: string;
  gridSize?: number;
  radiusKm?: number;
}): Promise<GridCaptureResult> {
  const gridSize = Math.min(7, Math.max(3, args.gridSize ?? 5));
  const radiusKm = Math.min(10, Math.max(0.5, args.radiusKm ?? 2));

  const keyword = await prisma.gmbTrackedKeyword.findFirst({
    where: { id: args.keywordId, tenantId: args.tenantId },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          addressLine: true,
          latitude: true,
          longitude: true,
        },
      },
    },
  });
  if (!keyword) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tracked keyword not found.");
  }
  const { location } = keyword;
  if (location.latitude == null || location.longitude == null) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Set the location's latitude/longitude before grid tracking (edit the location).",
    );
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Grid tracking needs GOOGLE_PLACES_API_KEY (Places API — New) configured on the platform.",
    );
  }

  const lattice = buildGrid(location.latitude, location.longitude, gridSize, radiusKm);
  const business = { name: location.name, addressLine: location.addressLine };
  const centerIdx = Math.floor(lattice.length / 2);
  let leaderboard: LeaderboardEntry[] = [];
  const points: GridPoint[] = [];
  // Index-aligned with `points`; feeds the battle map after the sweep. A
  // failed point contributes an empty list so the alignment always holds.
  const perPointPlaces: PlacesResult[][] = [];
  for (let i = 0; i < lattice.length; i++) {
    const p = lattice[i];
    try {
      const places = await searchPlacesAtPoint({
        apiKey,
        keyword: keyword.keyword,
        lat: p.lat,
        lng: p.lng,
      });
      points.push({ lat: p.lat, lng: p.lng, rank: rankInPlaces(places, business) });
      perPointPlaces.push(places);
      // The centre point's ordered results double as the local leaderboard —
      // same response, no extra API call.
      if (i === centerIdx) leaderboard = buildLocalLeaderboard(places, business);
    } catch (err) {
      // A single failed point degrades to "not found" rather than voiding
      // the whole capture; the error is visible in server logs.
      console.warn(
        `[gmb-grid] point (${p.lat.toFixed(4)},${p.lng.toFixed(4)}) failed:`,
        (err as Error).message,
      );
      points.push({ lat: p.lat, lng: p.lng, rank: null });
      perPointPlaces.push([]);
    }
  }
  // Same responses, no extra API call — the rivals contesting this lattice.
  const battleMap = buildBattleMap(perPointPlaces, business);

  const stats = computeGridStats(points);
  const snapshot = await prisma.gmbRankGridSnapshot.create({
    data: {
      tenantId: args.tenantId,
      keywordId: keyword.id,
      gridSize,
      radiusKm,
      points: JSON.stringify(points),
      competitors: leaderboard.length > 0 ? JSON.stringify(leaderboard) : null,
      battleMap: battleMap.rivals.length > 0 ? JSON.stringify(battleMap) : null,
      avgRank: stats.avgRank,
      top3Share: stats.top3Share,
      foundShare: stats.foundShare,
      source: "GOOGLE_PLACES",
    },
  });

  // Also record the center-point rank as a classic rank snapshot so the
  // existing trend chart picks up grid captures automatically.
  const centerRank = points[Math.floor(points.length / 2)]?.rank ?? null;
  await prisma.gmbRankSnapshot.create({
    data: {
      tenantId: args.tenantId,
      keywordId: keyword.id,
      rank: centerRank,
      source: "GRID",
    },
  });
  // Rank-drop alert rules ride on grid captures too — fire-and-forget.
  void evaluateRankAlerts(args.tenantId, keyword.id, centerRank);

  return {
    snapshotId: snapshot.id,
    gridSize,
    radiusKm,
    points,
    stats,
    leaderboard,
    battleMap,
    capturedAt: snapshot.capturedAt,
  };
}

export async function getLatestGridSnapshot(
  tenantId: string,
  keywordId: string,
): Promise<GridCaptureResult | null> {
  const row = await prisma.gmbRankGridSnapshot.findFirst({
    where: { tenantId, keywordId },
    orderBy: { capturedAt: "desc" },
  });
  if (!row) return null;
  let points: GridPoint[] = [];
  try {
    points = JSON.parse(row.points) as GridPoint[];
  } catch {
    points = [];
  }
  let leaderboard: LeaderboardEntry[] = [];
  if (row.competitors) {
    try {
      leaderboard = JSON.parse(row.competitors) as LeaderboardEntry[];
    } catch {
      leaderboard = [];
    }
  }
  let battleMap: BattleMap = { rivals: [] };
  if (row.battleMap) {
    try {
      battleMap = JSON.parse(row.battleMap) as BattleMap;
    } catch {
      battleMap = { rivals: [] };
    }
  }
  return {
    snapshotId: row.id,
    gridSize: row.gridSize,
    radiusKm: row.radiusKm,
    points,
    stats: {
      avgRank: row.avgRank,
      top3Share: row.top3Share ?? 0,
      foundShare: row.foundShare ?? 0,
    },
    leaderboard,
    battleMap,
    capturedAt: row.capturedAt,
  };
}
