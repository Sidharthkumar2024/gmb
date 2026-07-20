import { prisma, GmbLocationStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// AdGrowly GMB — Business Profile / location service (planning PDF). The
// anchor entity for reviews, insights, ranking and citations. Google
// credentials are referenced by secretId in the Secret Vault; live GBP
// sync is a later slice. Pure helpers split out for unit testing.
// =====================================================================

interface LocationRow {
  id: string;
  tenantId: string;
  name: string;
  storeCode: string | null;
  placeId: string | null;
  phone: string | null;
  website: string | null;
  primaryCategory: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  status: GmbLocationStatus;
  verificationState: string | null;
  rating: number | null;
  reviewCount: number;
  secretId: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe view — exposes a `hasCredential` flag, never the secret pointer. */
export function toSafeLocation(row: LocationRow) {
  return {
    id: row.id,
    name: row.name,
    storeCode: row.storeCode,
    placeId: row.placeId,
    phone: row.phone,
    website: row.website,
    primaryCategory: row.primaryCategory,
    address: {
      line: row.addressLine,
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
      country: row.country,
    },
    latitude: row.latitude,
    longitude: row.longitude,
    status: row.status,
    verificationState: row.verificationState,
    rating: row.rating,
    reviewCount: row.reviewCount,
    hasCredential: Boolean(row.secretId),
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

export async function listLocations(tenantId: string, status?: GmbLocationStatus) {
  const rows = await prisma.gmbLocation.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSafeLocation);
}

async function assertSecretOwned(tenantId: string, secretId?: string | null) {
  if (!secretId) return;
  const secret = await prisma.secretVaultEntry.findFirst({
    where: { id: secretId, tenantId },
    select: { id: true },
  });
  if (!secret) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Referenced secret was not found in your vault.");
  }
}

export interface CreateLocationInput {
  name: string;
  storeCode?: string;
  placeId?: string;
  phone?: string;
  website?: string;
  primaryCategory?: string;
  addressLine?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  secretId?: string | null;
  createdByUserId?: string;
}

export async function createLocation(tenantId: string, input: CreateLocationInput) {
  const name = input.name.trim();
  if (!name) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A location name is required.");
  }
  await assertSecretOwned(tenantId, input.secretId);
  const row = await prisma.gmbLocation.create({
    data: {
      tenantId,
      name,
      storeCode: input.storeCode?.trim() || null,
      placeId: input.placeId?.trim() || null,
      phone: input.phone?.trim() || null,
      website: input.website?.trim() || null,
      primaryCategory: input.primaryCategory?.trim() || null,
      addressLine: input.addressLine?.trim() || null,
      city: input.city?.trim() || null,
      region: input.region?.trim() || null,
      postalCode: input.postalCode?.trim() || null,
      country: input.country?.trim() || null,
      secretId: input.secretId ?? null,
      status: input.placeId?.trim() ? GmbLocationStatus.CONNECTED : GmbLocationStatus.DRAFT,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeLocation(row);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbLocation.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  return row;
}

export async function getLocation(tenantId: string, id: string) {
  return toSafeLocation(await findOwnedOrThrow(tenantId, id));
}

export interface UpdateLocationInput {
  name?: string;
  storeCode?: string | null;
  placeId?: string | null;
  phone?: string | null;
  website?: string | null;
  primaryCategory?: string | null;
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  secretId?: string | null;
  status?: GmbLocationStatus;
}

export async function updateLocation(tenantId: string, id: string, input: UpdateLocationInput) {
  await findOwnedOrThrow(tenantId, id);
  if (input.secretId !== undefined) await assertSecretOwned(tenantId, input.secretId);
  const row = await prisma.gmbLocation.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.storeCode !== undefined ? { storeCode: input.storeCode } : {}),
      ...(input.placeId !== undefined ? { placeId: input.placeId } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.website !== undefined ? { website: input.website } : {}),
      ...(input.primaryCategory !== undefined ? { primaryCategory: input.primaryCategory } : {}),
      ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
      ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      ...(input.secretId !== undefined ? { secretId: input.secretId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
  return toSafeLocation(row);
}

/**
 * Record a sync result for a location (rating/review count snapshot). Live
 * Google Business Profile fetch wires in here in a later slice; for now this
 * accepts the values and stamps lastSyncedAt.
 */
export async function recordLocationSync(
  tenantId: string,
  id: string,
  data: { rating?: number; reviewCount?: number; verificationState?: string },
) {
  await findOwnedOrThrow(tenantId, id);
  const row = await prisma.gmbLocation.update({
    where: { id },
    data: {
      ...(data.rating !== undefined ? { rating: data.rating } : {}),
      ...(data.reviewCount !== undefined ? { reviewCount: Math.max(0, Math.trunc(data.reviewCount)) } : {}),
      ...(data.verificationState !== undefined ? { verificationState: data.verificationState } : {}),
      lastSyncedAt: new Date(),
    },
  });
  return toSafeLocation(row);
}

export async function deleteLocation(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  await prisma.gmbLocation.delete({ where: { id } });
}
