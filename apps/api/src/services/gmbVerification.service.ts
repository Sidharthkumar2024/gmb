import {
  prisma,
  GmbVerificationMethod,
  GmbVerificationRequestState,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  completeGoogleLocationVerification,
  fetchGoogleVoiceOfMerchantState,
  fetchGoogleVerificationOptions,
  requestGoogleLocationVerification,
  type GoogleVerificationMethod,
  type GoogleVerificationOption,
} from "./gmbGoogle.service";

// Google Business Profile verification. Verification is ONLY started by the
// location owner's explicit request — never a worker. Eligible methods, the
// request itself and PIN completion all come from Google's Verifications API;
// a local-only row can never mark a location verified.

export const VERIFICATION_METHODS: GmbVerificationMethod[] = [
  GmbVerificationMethod.PHONE_CALL,
  GmbVerificationMethod.SMS,
  GmbVerificationMethod.EMAIL,
  GmbVerificationMethod.POSTCARD,
];

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

type RequestRow = {
  id: string;
  locationId: string;
  method: GmbVerificationMethod;
  state: GmbVerificationRequestState;
  googleVerificationName: string | null;
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
    submittedToGoogle: Boolean(row.googleVerificationName),
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function findLocationOrThrow(tenantId: string, locationId: string) {
  const location = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: {
      id: true,
      verificationState: true,
      placeId: true,
      secretId: true,
    },
  });
  if (!location) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  return location;
}

function toGoogleMethod(method: GmbVerificationMethod): GoogleVerificationMethod {
  return method === GmbVerificationMethod.POSTCARD ? "ADDRESS" : method;
}

function toLocalMethod(method: GoogleVerificationMethod): GmbVerificationMethod {
  return method === "ADDRESS"
    ? GmbVerificationMethod.POSTCARD
    : method as GmbVerificationMethod;
}

function toSafeOption(option: GoogleVerificationOption) {
  const emailAddress = option.email?.user && option.email.domain
    ? `${option.email.user}@${option.email.domain}`
    : null;
  const address = option.address?.address;
  const addressText = address && typeof address === "object"
    ? [
        ...(Array.isArray(address.addressLines) ? address.addressLines : []),
        address.locality,
        address.administrativeArea,
        address.postalCode,
      ]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(", ")
    : null;
  return {
    method: toLocalMethod(option.method),
    destination: option.phoneNumber ?? emailAddress ?? addressText ?? null,
    expectedDeliveryDays: option.address?.expectedDeliveryDaysRegion ?? null,
    phoneNumber: option.phoneNumber ?? null,
    emailAddress,
  };
}

export async function getVerificationStatus(
  tenantId: string,
  locationId: string,
  languageCode = "en-US",
) {
  const location = await findLocationOrThrow(tenantId, locationId);
  const latest = await prisma.gmbVerificationRequest.findFirst({
    where: { tenantId, locationId },
    orderBy: { requestedAt: "desc" },
  });
  let googleVerified = false;
  let googleState = "UNKNOWN";
  let hasExternalPendingRequest = false;
  let options: GoogleVerificationOption[] = [];
  let reason: string | undefined;
  if (!location.secretId || !location.placeId) {
    reason = "Connect Google and sync this location before requesting verification.";
  } else {
    const voice = await fetchGoogleVoiceOfMerchantState({
      tenantId,
      locationId,
      secretId: location.secretId,
      locationResourceName: location.placeId,
    });
    googleVerified = Boolean(voice.hasBusinessAuthority || voice.hasVoiceOfMerchant);
    hasExternalPendingRequest = Boolean(voice.verify?.hasPendingVerification);
    googleState = googleVerified
      ? "VERIFIED"
      : hasExternalPendingRequest
        ? "PENDING"
        : voice.resolveOwnershipConflict
          ? "OWNERSHIP_CONFLICT"
          : voice.complyWithGuidelines
            ? "ACTION_REQUIRED"
            : voice.waitForVoiceOfMerchant
              ? "UNDER_REVIEW"
              : "NOT_VERIFIED";
    const basicGate = canRequestVerification({
      googleVerified,
      hasPendingRequest: latest?.state === GmbVerificationRequestState.PENDING,
    });
    reason = basicGate.reason;
    if (basicGate.allowed && hasExternalPendingRequest) {
      reason = "Google already has a verification in progress. Complete it in Business Profile Manager.";
    } else if (basicGate.allowed) {
      options = await fetchGoogleVerificationOptions({
        tenantId,
        locationId,
        secretId: location.secretId,
        locationResourceName: location.placeId,
        languageCode,
      });
      if (options.length === 0) {
        reason = "Google did not offer a verification method for this location.";
      }
    }
  }

  const availableOptions = options.map(toSafeOption);
  return {
    googleVerified,
    googleState,
    availableMethods: availableOptions.map((option) => option.method),
    availableOptions,
    latestRequest: latest ? toSafeVerification(latest) : null,
    allowed: !googleVerified
      && !hasExternalPendingRequest
      && latest?.state !== GmbVerificationRequestState.PENDING
      && availableOptions.length > 0,
    ...(reason ? { reason } : {}),
  };
}

export async function requestVerification(input: {
  tenantId: string;
  locationId: string;
  method: GmbVerificationMethod;
  requestedByUserId: string;
  languageCode?: string;
  mailerContact?: string;
}) {
  if (!input.requestedByUserId) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "Verification must be started by a signed-in user, never automatically.",
    );
  }
  const location = await findLocationOrThrow(input.tenantId, input.locationId);
  const pending = await prisma.gmbVerificationRequest.findFirst({
    where: {
      tenantId: input.tenantId,
      locationId: input.locationId,
      state: GmbVerificationRequestState.PENDING,
    },
    select: { id: true },
  });
  if (!location.secretId || !location.placeId) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Connect Google and sync this location before requesting verification.",
    );
  }
  const voice = await fetchGoogleVoiceOfMerchantState({
    tenantId: input.tenantId,
    locationId: input.locationId,
    secretId: location.secretId,
    locationResourceName: location.placeId,
  });
  const gate = canRequestVerification({
    googleVerified: Boolean(voice.hasBusinessAuthority || voice.hasVoiceOfMerchant),
    hasPendingRequest: Boolean(pending),
  });
  if (!gate.allowed) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, gate.reason ?? "Cannot request verification.");
  }
  if (voice.verify?.hasPendingVerification) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Google already has a verification in progress. Complete it in Business Profile Manager.",
    );
  }

  const googleMethod = toGoogleMethod(input.method);
  const options = await fetchGoogleVerificationOptions({
    tenantId: input.tenantId,
    locationId: input.locationId,
    secretId: location.secretId,
    locationResourceName: location.placeId,
    languageCode: input.languageCode,
  });
  const selected = options.find((option) => option.method === googleMethod);
  if (!selected) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Google does not currently offer that verification method for this location.",
    );
  }

  // Create the audit row before Google's irreversible start call. A rejected
  // API request is recorded as FAILED, never left as fake in-progress state.
  const local = await prisma.gmbVerificationRequest.create({
    data: {
      tenantId: input.tenantId,
      locationId: input.locationId,
      method: input.method,
      requestedByUserId: input.requestedByUserId,
    },
  });

  try {
    const google = await requestGoogleLocationVerification({
      tenantId: input.tenantId,
      locationId: input.locationId,
      secretId: location.secretId,
      locationResourceName: location.placeId,
      method: googleMethod,
      languageCode: input.languageCode,
      phoneNumber: selected.phoneNumber,
      emailAddress: selected.email?.user && selected.email.domain
        ? `${selected.email.user}@${selected.email.domain}`
        : undefined,
      mailerContact: input.mailerContact,
    });
    const verified = google.state === "VERIFIED";
    const row = await prisma.gmbVerificationRequest.update({
      where: { id: local.id },
      data: {
        googleVerificationName: google.name,
        state: verified
          ? GmbVerificationRequestState.VERIFIED
          : GmbVerificationRequestState.PENDING,
        completedAt: verified ? new Date() : null,
      },
    });
    if (verified) {
      await prisma.gmbLocation.update({
        where: { id: input.locationId },
        data: { verificationState: "VERIFIED" },
      });
    }
    return toSafeVerification(row);
  } catch (error) {
    await prisma.gmbVerificationRequest.update({
      where: { id: local.id },
      data: { state: GmbVerificationRequestState.FAILED, completedAt: new Date() },
    }).catch(() => undefined);
    throw error;
  }
}

export async function completeVerification(input: {
  tenantId: string;
  requestId: string;
  code: string;
}) {
  const code = input.code.trim();
  if (!code) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Enter the verification code.");

  const request = await prisma.gmbVerificationRequest.findFirst({
    where: { id: input.requestId, tenantId: input.tenantId },
  });
  if (!request) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Verification request not found.");
  if (request.state !== GmbVerificationRequestState.PENDING) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "This verification is no longer pending.");
  }
  if (!request.googleVerificationName) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "This legacy request was not sent to Google. Cancel it and start a new verification.",
    );
  }

  const location = await findLocationOrThrow(input.tenantId, request.locationId);
  if (!location.secretId) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Reconnect Google before submitting the PIN.");
  }
  const google = await completeGoogleLocationVerification({
    tenantId: input.tenantId,
    locationId: request.locationId,
    secretId: location.secretId,
    verificationName: request.googleVerificationName,
    pin: code,
  });
  const nextState = google.state === "VERIFIED"
    ? GmbVerificationRequestState.VERIFIED
    : google.state === "FAILED"
      ? GmbVerificationRequestState.FAILED
      : GmbVerificationRequestState.PENDING;
  const row = await prisma.gmbVerificationRequest.update({
    where: { id: request.id },
    data: {
      state: nextState,
      completedAt: nextState === GmbVerificationRequestState.PENDING ? null : new Date(),
    },
  });
  if (nextState === GmbVerificationRequestState.VERIFIED) {
    await prisma.gmbLocation.update({
      where: { id: request.locationId },
      data: { verificationState: "VERIFIED" },
    });
  }
  return toSafeVerification(row);
}

export async function cancelVerification(tenantId: string, requestId: string) {
  const request = await prisma.gmbVerificationRequest.findFirst({
    where: { id: requestId, tenantId },
    select: { id: true, state: true, googleVerificationName: true },
  });
  if (!request) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Verification request not found.");
  if (request.state !== GmbVerificationRequestState.PENDING) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Only a pending verification can be canceled.");
  }
  if (request.googleVerificationName) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Google verification requests cannot be canceled here. Complete it or manage it in Business Profile Manager.",
    );
  }
  const row = await prisma.gmbVerificationRequest.update({
    where: { id: request.id },
    data: { state: GmbVerificationRequestState.CANCELED, completedAt: new Date() },
  });
  return toSafeVerification(row);
}
