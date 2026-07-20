import {
  prisma,
  GmbVerificationMethod,
  GmbVerificationRequestState,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// GBP Verifications (Adgrowly GMB Panel — "Verifications API").
//
// POLICY, load-bearing: verification is ONLY ever started by the location
// owner's explicit request — NEVER a background job. Every request carries the
// human `requestedByUserId`, and there is no code path that creates one without
// a user (the route passes `req.userId`). This mirrors Google's own rule that
// verification options are initiated only by the owner's direct request.
//
// The real Google start/complete calls are gated on a live connection (like
// reviews / Q&A / Place Actions); today the flow records the owner's request +
// code entry locally and marks the location's verification state optimistically.
// `submittedToGoogle` reports the gated state.

// The standard verification methods. With a live connection these come from
// Google's `fetchVerificationOptions`; without one we offer the common set so
// the owner can still record an out-of-band verification.
export const VERIFICATION_METHODS: GmbVerificationMethod[] = [
  GmbVerificationMethod.PHONE_CALL,
  GmbVerificationMethod.SMS,
  GmbVerificationMethod.EMAIL,
  GmbVerificationMethod.POSTCARD,
];

/**
 * Pure gate: may a new verification be requested? Blocked when the profile is
 * already Google-verified, or an active PENDING request already exists (one
 * in-flight verification at a time). Testable in isolation.
 */
export function canRequestVerification(input: {
  googleVerified: boolean;
  hasPendingRequest: boolean;
}): { allowed: boolean; reason?: string } {
  if (input.googleVerified) {
    return { allowed: false, reason: "This location is already verified." };
  }
  if (input.hasPendingRequest) {
    return { allowed: false, reason: "A verification is already in progress." };
  }
  return { allowed: true };
}

function isGoogleVerified(verificationState: string | null): boolean {
  // Exact-match, NOT substring — "UNVERIFIED" contains "VERIFIED".
  const s = (verificationState ?? "").trim().toUpperCase();
  return s === "VERIFIED" || s === "COMPLETED";
}

type RequestRow = {
  id: string;
  locationId: string;
  method: GmbVerificationMethod;
  state: GmbVerificationRequestState;
  requestedByUserId: string;
  requestedAt: Date;
  completedAt: Date | null;
};

export function toSafeVerification(row: RequestRow) {
  return {
    id: row.id,
    locationId: row.locationId,
    method: row.method,
    state: row.state,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function findLocationOrThrow(tenantId: string, locationId: string) {
  const loc = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true, verificationState: true },
  });
  if (!loc) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  return loc;
}

export async function getVerificationStatus(tenantId: string, locationId: string) {
  const loc = await findLocationOrThrow(tenantId, locationId);
  const latest = await prisma.gmbVerificationRequest.findFirst({
    where: { tenantId, locationId },
    orderBy: { requestedAt: "desc" },
  });
  const googleVerified = isGoogleVerified(loc.verificationState);
  const hasPendingRequest =
    latest?.state === GmbVerificationRequestState.PENDING;
  return {
    googleVerified,
    googleState: loc.verificationState ?? "UNKNOWN",
    availableMethods: VERIFICATION_METHODS,
    latestRequest: latest ? toSafeVerification(latest) : null,
    ...canRequestVerification({ googleVerified, hasPendingRequest }),
  };
}

/**
 * Start a verification. `requestedByUserId` is REQUIRED — this is the single
 * enforcement point of the customer-initiated policy. Never call this from a
 * worker or without a real user.
 */
export async function requestVerification(input: {
  tenantId: string;
  locationId: string;
  method: GmbVerificationMethod;
  requestedByUserId: string;
}) {
  if (!input.requestedByUserId) {
    // Defense in depth: verification must be a human, explicit action.
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "Verification must be started by a signed-in user, never automatically.",
    );
  }
  const loc = await findLocationOrThrow(input.tenantId, input.locationId);
  const pending = await prisma.gmbVerificationRequest.findFirst({
    where: {
      locationId: input.locationId,
      state: GmbVerificationRequestState.PENDING,
    },
    select: { id: true },
  });
  const gate = canRequestVerification({
    googleVerified: isGoogleVerified(loc.verificationState),
    hasPendingRequest: Boolean(pending),
  });
  if (!gate.allowed) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, gate.reason ?? "Cannot request verification.");
  }
  const row = await prisma.gmbVerificationRequest.create({
    data: {
      tenantId: input.tenantId,
      locationId: input.locationId,
      method: input.method,
      requestedByUserId: input.requestedByUserId,
    },
  });
  // submittedToGoogle=false: the Google `verify` call lands with a live
  // connection; today we've recorded the owner's request.
  return { ...toSafeVerification(row), submittedToGoogle: false };
}

/**
 * Complete a pending verification with the code Google sent. Marks the request
 * VERIFIED and stamps the location's verification state. The Google
 * `completeVerification` call is gated on a live connection.
 */
export async function completeVerification(input: {
  tenantId: string;
  requestId: string;
  code: string;
}) {
  const code = input.code.trim();
  if (!code) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Enter the verification code.");
  }
  const request = await prisma.gmbVerificationRequest.findFirst({
    where: { id: input.requestId, tenantId: input.tenantId },
  });
  if (!request) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Verification request not found.");
  }
  if (request.state !== GmbVerificationRequestState.PENDING) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "This verification is no longer pending.");
  }
  const row = await prisma.gmbVerificationRequest.update({
    where: { id: request.id },
    data: {
      state: GmbVerificationRequestState.VERIFIED,
      completedAt: new Date(),
    },
  });
  await prisma.gmbLocation
    .update({
      where: { id: request.locationId },
      data: { verificationState: "VERIFIED" },
    })
    .catch(() => undefined);
  return { ...toSafeVerification(row), submittedToGoogle: false };
}

export async function cancelVerification(tenantId: string, requestId: string) {
  const request = await prisma.gmbVerificationRequest.findFirst({
    where: { id: requestId, tenantId },
    select: { id: true, state: true },
  });
  if (!request) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Verification request not found.");
  }
  if (request.state !== GmbVerificationRequestState.PENDING) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Only a pending verification can be canceled.");
  }
  const row = await prisma.gmbVerificationRequest.update({
    where: { id: request.id },
    data: { state: GmbVerificationRequestState.CANCELED, completedAt: new Date() },
  });
  return toSafeVerification(row);
}
