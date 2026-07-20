import { prisma, GmbPlaceActionType } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// GBP Place Actions (Adgrowly GMB Panel — "Place Actions API"). Manages the
// action links on a Business Profile (Book / Appointment / Reserve / Order /
// Dining). Pre-fillable from the tenant's own public booking page.
//
// The Google Place Actions *write* is gated on a live connection (like reviews
// and Q&A); `publishedToGoogle` reports the local state until it's wired.

type PlaceActionRow = {
  id: string;
  locationId: string;
  actionType: GmbPlaceActionType;
  url: string;
  isActive: boolean;
  publishedToGoogle: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function toSafePlaceAction(row: PlaceActionRow) {
  return {
    id: row.id,
    locationId: row.locationId,
    actionType: row.actionType,
    url: row.url,
    isActive: row.isActive,
    publishedToGoogle: row.publishedToGoogle,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The tenant's own public booking page. Google requires an HTTPS action URL;
 * localhost/dev bases (http) are still returned so the UI can show the
 * suggestion, but `isValidActionUrl` will flag them before a save.
 */
export function buildBookingUrl(tenantId: string, webUrl?: string): string {
  const base = (webUrl ?? process.env.WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/book/${tenantId}`;
}

/** Google action links must be absolute HTTPS URLs. Pure + testable. */
export function isValidActionUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && Boolean(u.hostname);
  } catch {
    return false;
  }
}

async function findLocationOrThrow(tenantId: string, locationId: string) {
  const loc = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true },
  });
  if (!loc) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  return loc;
}

export async function listPlaceActions(tenantId: string, locationId?: string) {
  const rows = await prisma.gmbPlaceAction.findMany({
    where: { tenantId, ...(locationId ? { locationId } : {}) },
    orderBy: { actionType: "asc" },
  });
  return rows.map(toSafePlaceAction);
}

/**
 * Suggested action links (NOT saved) for a location: the two booking-oriented
 * types pre-filled with the tenant's public booking page. The UI can accept or
 * edit them. Booking-heavy verticals want BOOK/APPOINTMENT; commerce/dining
 * want the others, which start blank.
 */
export async function suggestPlaceActions(tenantId: string, locationId: string, webUrl?: string) {
  await findLocationOrThrow(tenantId, locationId);
  const booking = buildBookingUrl(tenantId, webUrl);
  return {
    bookingUrl: booking,
    bookingUrlValid: isValidActionUrl(booking),
    suggestions: [
      { actionType: GmbPlaceActionType.BOOK, url: booking },
      { actionType: GmbPlaceActionType.APPOINTMENT, url: booking },
    ],
  };
}

export interface UpsertPlaceActionInput {
  locationId: string;
  actionType: GmbPlaceActionType;
  url: string;
  createdByUserId?: string;
}

export async function upsertPlaceAction(tenantId: string, input: UpsertPlaceActionInput) {
  const url = input.url.trim();
  if (!isValidActionUrl(url)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Action links must be an absolute https:// URL.",
    );
  }
  await findLocationOrThrow(tenantId, input.locationId);

  // Upsert on the (location, actionType) unique — one link per action type.
  const existing = await prisma.gmbPlaceAction.findUnique({
    where: {
      locationId_actionType: {
        locationId: input.locationId,
        actionType: input.actionType,
      },
    },
  });
  const row = existing
    ? await prisma.gmbPlaceAction.update({
        where: { id: existing.id },
        // URL changed → it's no longer in sync with Google.
        data: { url, isActive: true, publishedToGoogle: false },
      })
    : await prisma.gmbPlaceAction.create({
        data: {
          tenantId,
          locationId: input.locationId,
          actionType: input.actionType,
          url,
          createdByUserId: input.createdByUserId ?? null,
        },
      });
  return toSafePlaceAction(row);
}

export async function setPlaceActionActive(tenantId: string, id: string, isActive: boolean) {
  const existing = await prisma.gmbPlaceAction.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!existing) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Action link not found.");
  const row = await prisma.gmbPlaceAction.update({
    where: { id },
    data: { isActive },
  });
  return toSafePlaceAction(row);
}

export async function deletePlaceAction(tenantId: string, id: string) {
  const existing = await prisma.gmbPlaceAction.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!existing) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Action link not found.");
  await prisma.gmbPlaceAction.delete({ where: { id } });
}
