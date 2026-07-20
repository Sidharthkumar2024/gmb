import { prisma, GmbCitationStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { buildCitationScan } from "./gmbCitationScan";

// =====================================================================
// AdGrowly GMB — Citations service (planning PDF). Tracks a location's NAP
// (Name / Address / Phone) listings across external directories and scores
// consistency against the location's canonical NAP. Consistency is computed
// here — never stored — so it always reflects the current canonical profile.
// Pure normalization/compare/summary helpers are unit-tested (no Prisma).
// =====================================================================

export interface Nap {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
}

/** Lowercase, strip punctuation, collapse whitespace — for tolerant compare. */
export function normalizeText(value?: string | null): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Digits only — tolerant phone compare across formatting differences. */
export function normalizePhone(value?: string | null): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

export type NapField = "match" | "mismatch" | "na";

export interface NapComparison {
  name: NapField;
  address: NapField;
  phone: NapField;
  /** matched dimensions / comparable dimensions (0–1, 2dp). */
  score: number;
  /** true when every canonical dimension is present and matches. */
  consistent: boolean;
}

function compareField(canonical: string, listing: string, isPhone = false): NapField {
  const c = isPhone ? normalizePhone(canonical) : normalizeText(canonical);
  if (!c) return "na"; // nothing canonical to compare against
  const l = isPhone ? normalizePhone(listing) : normalizeText(listing);
  if (!l) return "mismatch"; // canonical exists but listing is blank/unknown
  return c === l ? "match" : "mismatch";
}

/**
 * Compare a directory listing's NAP to the canonical NAP. Dimensions the
 * canonical profile doesn't define are "na" and excluded from the score.
 */
export function compareNap(canonical: Nap, listing: Nap): NapComparison {
  const name = compareField(canonical.name ?? "", listing.name ?? "");
  const address = compareField(canonical.address ?? "", listing.address ?? "");
  const phone = compareField(canonical.phone ?? "", listing.phone ?? "", true);

  const fields = [name, address, phone];
  const comparable = fields.filter((f) => f !== "na").length;
  const matched = fields.filter((f) => f === "match").length;
  const score = comparable ? Math.round((matched / comparable) * 100) / 100 : 0;
  const consistent = comparable > 0 && matched === comparable;

  return { name, address, phone, score, consistent };
}

/** Compose a single-line address from a location's structured fields. */
export function composeAddress(parts: {
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): string {
  return [parts.addressLine, parts.city, parts.region, parts.postalCode, parts.country]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

interface CitationRow {
  id: string;
  tenantId: string;
  locationId: string;
  directory: string;
  listingUrl: string | null;
  napName: string | null;
  napAddress: string | null;
  napPhone: string | null;
  status: GmbCitationStatus;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe view; when canonical NAP is supplied, embeds a consistency comparison. */
export function toSafeCitation(row: CitationRow, canonical?: Nap) {
  const listing: Nap = { name: row.napName, address: row.napAddress, phone: row.napPhone };
  const comparison = canonical ? compareNap(canonical, listing) : null;
  return {
    id: row.id,
    locationId: row.locationId,
    directory: row.directory,
    listingUrl: row.listingUrl,
    nap: listing,
    status: row.status,
    consistency: comparison,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CitationsSummary {
  total: number;
  live: number;
  pending: number;
  missing: number;
  consistent: number;
  inconsistent: number;
  /** fraction of present (non-missing) listings that are fully consistent. */
  consistencyScore: number;
}

/** Aggregate counts + consistency score across a location's citations. */
export function summarizeCitations(
  items: Array<{ status: GmbCitationStatus; consistent: boolean }>,
): CitationsSummary {
  let live = 0;
  let pending = 0;
  let missing = 0;
  let consistent = 0;
  let present = 0;
  for (const it of items) {
    if (it.status === GmbCitationStatus.LIVE) live += 1;
    else if (it.status === GmbCitationStatus.PENDING) pending += 1;
    else if (it.status === GmbCitationStatus.MISSING) missing += 1;
    if (it.status !== GmbCitationStatus.MISSING) {
      present += 1;
      if (it.consistent) consistent += 1;
    }
  }
  return {
    total: items.length,
    live,
    pending,
    missing,
    consistent,
    inconsistent: present - consistent,
    consistencyScore: present ? Math.round((consistent / present) * 100) / 100 : 0,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

const LOCATION_NAP_SELECT = {
  name: true,
  phone: true,
  addressLine: true,
  city: true,
  region: true,
  postalCode: true,
  country: true,
} as const;

type LocationNapRow = {
  name: string;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
};

function canonicalNap(loc: LocationNapRow): Nap {
  return { name: loc.name, address: composeAddress(loc), phone: loc.phone };
}

async function findLocationNapOrThrow(tenantId: string, locationId: string): Promise<Nap> {
  const loc = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: LOCATION_NAP_SELECT,
  });
  if (!loc) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  return canonicalNap(loc);
}

async function findCitationOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbCitation.findFirst({
    where: { id, tenantId },
    include: { location: { select: LOCATION_NAP_SELECT } },
  });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Citation not found.");
  return row;
}

export interface ListCitationsFilter {
  locationId?: string;
  status?: GmbCitationStatus;
}

export async function listCitations(tenantId: string, filter: ListCitationsFilter = {}) {
  const rows = await prisma.gmbCitation.findMany({
    where: {
      tenantId,
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { directory: "asc" },
    include: { location: { select: LOCATION_NAP_SELECT } },
  });
  return rows.map((row) => toSafeCitation(row, canonicalNap(row.location)));
}

export interface CreateCitationInput {
  locationId: string;
  directory: string;
  listingUrl?: string;
  napName?: string;
  napAddress?: string;
  napPhone?: string;
  status?: GmbCitationStatus;
  createdByUserId?: string;
}

export async function createCitation(tenantId: string, input: CreateCitationInput) {
  const directory = input.directory.trim();
  if (!directory) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A directory name is required.");
  }
  const canonical = await findLocationNapOrThrow(tenantId, input.locationId);
  const existing = await prisma.gmbCitation.findFirst({
    where: { locationId: input.locationId, directory },
    select: { id: true },
  });
  if (existing) {
    throw new ApiError(ErrorCodes.CONFLICT, 409, "That directory is already tracked for this location.");
  }
  const row = await prisma.gmbCitation.create({
    data: {
      tenantId,
      locationId: input.locationId,
      directory,
      listingUrl: input.listingUrl?.trim() || null,
      napName: input.napName?.trim() || null,
      napAddress: input.napAddress?.trim() || null,
      napPhone: input.napPhone?.trim() || null,
      status: input.status ?? GmbCitationStatus.PENDING,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeCitation(row, canonical);
}

export async function getCitation(tenantId: string, id: string) {
  const row = await findCitationOrThrow(tenantId, id);
  return toSafeCitation(row, canonicalNap(row.location));
}

export interface UpdateCitationInput {
  listingUrl?: string | null;
  napName?: string | null;
  napAddress?: string | null;
  napPhone?: string | null;
  status?: GmbCitationStatus;
  /** stamp lastCheckedAt — set when a directory scan re-verifies the listing. */
  markChecked?: boolean;
}

export async function updateCitation(tenantId: string, id: string, input: UpdateCitationInput) {
  const current = await findCitationOrThrow(tenantId, id);
  const row = await prisma.gmbCitation.update({
    where: { id },
    data: {
      ...(input.listingUrl !== undefined ? { listingUrl: input.listingUrl } : {}),
      ...(input.napName !== undefined ? { napName: input.napName } : {}),
      ...(input.napAddress !== undefined ? { napAddress: input.napAddress } : {}),
      ...(input.napPhone !== undefined ? { napPhone: input.napPhone } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.markChecked ? { lastCheckedAt: new Date() } : {}),
    },
  });
  return toSafeCitation(row, canonicalNap(current.location));
}

export async function deleteCitation(tenantId: string, id: string) {
  await findCitationOrThrow(tenantId, id);
  await prisma.gmbCitation.delete({ where: { id } });
}

/**
 * Scan a location's tracked citations: recompute NAP consistency, stamp
 * `lastCheckedAt` on every row, and return the mismatch report plus the
 * niche-relevant directories not yet tracked. On-demand and (via a worker)
 * schedulable. No directory submission — detection + a checklist only.
 */
export async function scanCitations(
  tenantId: string,
  locationId: string,
  niche?: string | null,
) {
  const canonical = await findLocationNapOrThrow(tenantId, locationId);
  const rows = await prisma.gmbCitation.findMany({
    where: { tenantId, locationId },
    orderBy: { directory: "asc" },
  });
  // Stamp lastCheckedAt so the UI shows a fresh "checked just now".
  if (rows.length > 0) {
    await prisma.gmbCitation.updateMany({
      where: { tenantId, locationId },
      data: { lastCheckedAt: new Date() },
    });
  }
  const scanInput = rows.map((row) => ({
    id: row.id,
    directory: row.directory,
    status: String(row.status),
    nap: { name: row.napName, address: row.napAddress, phone: row.napPhone } as Nap,
  }));
  return buildCitationScan(canonical, scanInput, niche);
}

export async function getCitationSummary(tenantId: string, locationId?: string) {
  if (locationId) await findLocationNapOrThrow(tenantId, locationId);
  const rows = await prisma.gmbCitation.findMany({
    where: { tenantId, ...(locationId ? { locationId } : {}) },
    include: { location: { select: LOCATION_NAP_SELECT } },
  });
  const items = rows.map((row) => {
    const listing: Nap = { name: row.napName, address: row.napAddress, phone: row.napPhone };
    return { status: row.status, consistent: compareNap(canonicalNap(row.location), listing).consistent };
  });
  return summarizeCitations(items);
}
