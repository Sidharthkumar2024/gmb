import {
  GoogleApiLogStatus,
  GmbLocationStatus,
  GmbReviewStatus,
  prisma,
  SecretProvider,
  SecretScope,
  SecretStatus,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { createHmac, timingSafeEqual } from "node:crypto";
import { captureLast4 } from "./secretVault.service";
import { decryptToken, encryptToken } from "../lib/tokenCrypto";
import { recordLog } from "./googleApiMonitor.service";
import { getCachedGoogleClientConfig } from "./googleOAuthConfig.service";

// Google Business Profile integration (AdGrowly GMB-first PDF).
//
// Tokens are stored as a JSON credential payload inside the existing encrypted
// Secret Vault. The route layer returns only safe connection metadata; raw
// access/refresh tokens never leave this service.

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCOUNT_MANAGEMENT_BASE = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const MY_BUSINESS_BASE = "https://mybusiness.googleapis.com/v4";
const PERFORMANCE_BASE = "https://businessprofileperformance.googleapis.com/v1";

export const GBP_SCOPES = ["https://www.googleapis.com/auth/business.manage"] as const;

const DEFAULT_LABEL = "Google Business Profile";

export interface GoogleOAuthStatePayload {
  tenantId: string;
  userId: string;
  iat: number;
  nonce: string;
}

export interface GoogleCredentialPayload {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string;
  connectedAt: string;
  accountName?: string;
}

export interface SafeGoogleConnection {
  configured: boolean;
  connected: boolean;
  secretId: string | null;
  label: string | null;
  last4: string | null;
  scopes: string[];
  connectedAt: string | null;
  expiresAt: string | null;
  accountName: string | null;
  lastSyncedAt: Date | null;
}

function readClientConfig() {
  // Prefer the SuperAdmin-managed config (when enabled) — see
  // googleOAuthConfig.service; fall back to environment variables.
  const stored = getCachedGoogleClientConfig();
  if (stored) return stored;
  return {
    clientId:
      process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID ??
      process.env.GOOGLE_CLIENT_ID ??
      "",
    clientSecret:
      process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET ??
      process.env.GOOGLE_CLIENT_SECRET ??
      "",
  };
}

export function isGoogleBusinessProfileOAuthConfigured(): boolean {
  const { clientId, clientSecret } = readClientConfig();
  return Boolean(clientId && clientSecret);
}

function getStateSecret(): string {
  return (
    process.env.GOOGLE_BUSINESS_PROFILE_STATE_SECRET ??
    process.env.JWT_SECRET ??
    process.env.ACCESS_TOKEN_SECRET ??
    "dev-google-business-profile-state-secret"
  );
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function signGoogleOAuthState(payload: GoogleOAuthStatePayload): string {
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", getStateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyGoogleOAuthState(state: string, maxAgeMs = 15 * 60_000): GoogleOAuthStatePayload {
  const [body, sig] = state.split(".");
  if (!body || !sig) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid Google OAuth state.");
  }
  const expected = createHmac("sha256", getStateSecret()).update(body).digest("base64url");
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid Google OAuth state signature.");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GoogleOAuthStatePayload;
  if (!payload.tenantId || !payload.userId || !payload.iat || !payload.nonce) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid Google OAuth state payload.");
  }
  if (Date.now() - payload.iat > maxAgeMs) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Google OAuth state expired.");
  }
  return payload;
}

export function buildGoogleBusinessProfileOAuthUrl(input: {
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const { clientId } = readClientConfig();
  if (!clientId) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Google Business Profile OAuth client is not configured.",
    );
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: (input.scopes ?? GBP_SCOPES).join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function parseCredential(raw: string): GoogleCredentialPayload {
  try {
    const parsed = JSON.parse(raw) as GoogleCredentialPayload;
    return { ...parsed, connectedAt: parsed.connectedAt ?? new Date().toISOString() };
  } catch {
    return { refreshToken: raw, connectedAt: new Date().toISOString() };
  }
}

function serializeCredential(payload: GoogleCredentialPayload): string {
  return JSON.stringify(payload);
}

function metadataFor(payload: GoogleCredentialPayload) {
  return JSON.stringify({
    provider: "GOOGLE_BUSINESS_PROFILE",
    scopes: payload.scope?.split(/\s+/).filter(Boolean) ?? [...GBP_SCOPES],
    connectedAt: payload.connectedAt,
    expiresAt: payload.expiresAt ?? null,
    accountName: payload.accountName ?? null,
  });
}

async function findActiveGoogleSecret(tenantId: string, secretId?: string | null) {
  return prisma.secretVaultEntry.findFirst({
    where: {
      scope: SecretScope.CUSTOMER,
      tenantId,
      provider: SecretProvider.GOOGLE_BUSINESS_PROFILE,
      status: SecretStatus.ACTIVE,
      ...(secretId ? { id: secretId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getGoogleConnectionStatus(tenantId: string): Promise<SafeGoogleConnection> {
  const secret = await findActiveGoogleSecret(tenantId);
  const lastSynced = await prisma.gmbLocation.aggregate({
    where: { tenantId, secretId: secret?.id },
    _max: { lastSyncedAt: true },
  });
  if (!secret) {
    return {
      configured: isGoogleBusinessProfileOAuthConfigured(),
      connected: false,
      secretId: null,
      label: null,
      last4: null,
      scopes: [...GBP_SCOPES],
      connectedAt: null,
      expiresAt: null,
      accountName: null,
      lastSyncedAt: null,
    };
  }
  const metadata = secret.metadata ? JSON.parse(secret.metadata) : {};
  return {
    configured: isGoogleBusinessProfileOAuthConfigured(),
    connected: true,
    secretId: secret.id,
    label: secret.label,
    last4: secret.last4,
    scopes: Array.isArray(metadata.scopes) ? metadata.scopes : [...GBP_SCOPES],
    connectedAt: typeof metadata.connectedAt === "string" ? metadata.connectedAt : null,
    expiresAt: typeof metadata.expiresAt === "string" ? metadata.expiresAt : null,
    accountName: typeof metadata.accountName === "string" ? metadata.accountName : null,
    lastSyncedAt: lastSynced._max.lastSyncedAt,
  };
}

export async function storeGoogleCredential(input: {
  tenantId: string;
  label?: string;
  payload: GoogleCredentialPayload;
  createdByUserId?: string;
}) {
  const payload = {
    ...input.payload,
    connectedAt: input.payload.connectedAt ?? new Date().toISOString(),
  };
  const plaintext = serializeCredential(payload);
  const label = input.label?.trim() || DEFAULT_LABEL;
  const existing = await prisma.secretVaultEntry.findFirst({
    where: {
      scope: SecretScope.CUSTOMER,
      tenantId: input.tenantId,
      provider: SecretProvider.GOOGLE_BUSINESS_PROFILE,
      label,
    },
    orderBy: { updatedAt: "desc" },
  });
  const data = {
    ciphertext: encryptToken(plaintext),
    last4: captureLast4(payload.refreshToken ?? payload.accessToken ?? plaintext),
    metadata: metadataFor(payload),
    status: SecretStatus.ACTIVE,
  };
  const row = existing
    ? await prisma.secretVaultEntry.update({
        where: { id: existing.id },
        data: { ...data, lastRotatedAt: new Date() },
      })
    : await prisma.secretVaultEntry.create({
        data: {
          scope: SecretScope.CUSTOMER,
          tenantId: input.tenantId,
          provider: SecretProvider.GOOGLE_BUSINESS_PROFILE,
          label,
          createdByUserId: input.createdByUserId ?? null,
          ...data,
        },
      });
  return {
    id: row.id,
    label: row.label,
    last4: row.last4,
    connectedAt: payload.connectedAt,
    expiresAt: payload.expiresAt ?? null,
    scopes: payload.scope?.split(/\s+/).filter(Boolean) ?? [...GBP_SCOPES],
  };
}

export async function exchangeGoogleOAuthCode(input: {
  tenantId: string;
  code: string;
  redirectUri: string;
  label?: string;
  createdByUserId?: string;
}) {
  const { clientId, clientSecret } = readClientConfig();
  if (!clientId || !clientSecret) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Google Business Profile OAuth client is not configured.",
    );
  }
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      json.error_description || "Google OAuth token exchange failed.",
    );
  }
  const expiresAt =
    typeof json.expires_in === "number"
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : undefined;
  return storeGoogleCredential({
    tenantId: input.tenantId,
    label: input.label,
    createdByUserId: input.createdByUserId,
    payload: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      tokenType: json.token_type,
      scope: json.scope,
      expiresAt,
      connectedAt: new Date().toISOString(),
    },
  });
}

export async function saveManualGoogleRefreshToken(input: {
  tenantId: string;
  refreshToken: string;
  accessToken?: string;
  expiresIn?: number;
  scope?: string;
  accountName?: string;
  label?: string;
  createdByUserId?: string;
}) {
  const expiresAt =
    input.expiresIn != null ? new Date(Date.now() + input.expiresIn * 1000).toISOString() : undefined;
  return storeGoogleCredential({
    tenantId: input.tenantId,
    label: input.label,
    createdByUserId: input.createdByUserId,
    payload: {
      refreshToken: input.refreshToken,
      accessToken: input.accessToken,
      scope: input.scope ?? GBP_SCOPES.join(" "),
      expiresAt,
      connectedAt: new Date().toISOString(),
      accountName: input.accountName,
    },
  });
}

export async function disconnectGoogleBusinessProfile(tenantId: string) {
  const result = await prisma.secretVaultEntry.updateMany({
    where: {
      scope: SecretScope.CUSTOMER,
      tenantId,
      provider: SecretProvider.GOOGLE_BUSINESS_PROFILE,
      status: SecretStatus.ACTIVE,
    },
    data: { status: SecretStatus.DISABLED },
  });
  await prisma.gmbLocation.updateMany({
    where: { tenantId },
    data: { secretId: null, status: GmbLocationStatus.DRAFT },
  });
  return { disabledSecrets: result.count };
}

async function resolveCredential(tenantId: string, secretId?: string | null) {
  const row = await findActiveGoogleSecret(tenantId, secretId);
  if (!row) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Connect Google Business Profile first.");
  }
  return { row, payload: parseCredential(decryptToken(row.ciphertext)) };
}

async function refreshAccessToken(tenantId: string, secretId?: string | null): Promise<{ secretId: string; accessToken: string; accountName?: string }> {
  const { clientId, clientSecret } = readClientConfig();
  const { row, payload } = await resolveCredential(tenantId, secretId);
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt).getTime() : 0;
  if (payload.accessToken && expiresAt > Date.now() + 60_000) {
    return { secretId: row.id, accessToken: payload.accessToken, accountName: payload.accountName };
  }
  if (!clientId || !clientSecret) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Google OAuth client is required to refresh the connected Business Profile token.",
    );
  }
  if (!payload.refreshToken) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Google refresh token is missing. Reconnect Google.");
  }
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: payload.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      json.error_description || "Google token refresh failed.",
    );
  }
  const next: GoogleCredentialPayload = {
    ...payload,
    accessToken: json.access_token,
    tokenType: json.token_type ?? payload.tokenType,
    scope: json.scope ?? payload.scope,
    expiresAt:
      typeof json.expires_in === "number"
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : payload.expiresAt,
  };
  await prisma.secretVaultEntry.update({
    where: { id: row.id },
    data: {
      ciphertext: encryptToken(serializeCredential(next)),
      metadata: metadataFor(next),
      lastRotatedAt: new Date(),
    },
  });
  return { secretId: row.id, accessToken: json.access_token, accountName: next.accountName };
}

async function googleJson<T>(args: {
  tenantId: string;
  locationId?: string | null;
  secretId?: string | null;
  operation: string;
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}): Promise<T> {
  const started = Date.now();
  try {
    const { accessToken } = await refreshAccessToken(args.tenantId, args.secretId);
    const response = await fetch(args.url, {
      method: args.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(args.body != null ? { "Content-Type": "application/json" } : {}),
      },
      ...(args.body != null ? { body: JSON.stringify(args.body) } : {}),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    const status =
      response.status === 429
        ? GoogleApiLogStatus.RATE_LIMITED
        : response.ok
          ? GoogleApiLogStatus.OK
          : GoogleApiLogStatus.ERROR;
    await recordLog({
      tenantId: args.tenantId,
      locationId: args.locationId ?? null,
      operation: args.operation,
      status,
      statusCode: response.status,
      message: response.ok ? undefined : body.error?.message ?? text.slice(0, 500),
      durationMs: Date.now() - started,
    });
    if (!response.ok) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        response.status === 429 ? 429 : 400,
        body.error?.message ?? "Google Business Profile API request failed.",
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    await recordLog({
      tenantId: args.tenantId,
      locationId: args.locationId ?? null,
      operation: args.operation,
      status: GoogleApiLogStatus.ERROR,
      message: error instanceof Error ? error.message : "Google API request failed.",
      durationMs: Date.now() - started,
    });
    throw error;
  }
}

export function buildGoogleReviewResourceName(
  locationResourceName: string | null | undefined,
  externalReviewId: string | null | undefined,
): string | null {
  const review = externalReviewId?.trim();
  if (!review) return null;
  if (/^accounts\/[^/]+\/locations\/[^/]+\/reviews\/[^/]+/.test(review)) return review;

  const location = locationResourceName?.trim().replace(/\/+$/, "");
  if (!location || !/^accounts\/[^/]+\/locations\/[^/]+/.test(location)) return null;
  const reviewId = review.startsWith("reviews/") ? review.slice("reviews/".length) : review;
  return `${location}/reviews/${reviewId}`;
}

export interface GoogleLocationApiRow {
  name?: string;
  title?: string;
  storeCode?: string;
  websiteUri?: string;
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    administrativeArea?: string;
    postalCode?: string;
    regionCode?: string;
  };
  phoneNumbers?: { primaryPhone?: string };
  primaryCategory?: { displayName?: string; name?: string };
  metadata?: { placeId?: string };
}

export function normalizeGoogleLocation(row: GoogleLocationApiRow, accountName?: string) {
  const resourceName = row.name
    ? row.name.startsWith("accounts/") || !accountName
      ? row.name
      : `${accountName}/${row.name}`
    : row.metadata?.placeId ?? "";
  return {
    googleResourceName: resourceName,
    name: row.title?.trim() || row.storeCode?.trim() || resourceName || "Google Business location",
    storeCode: row.storeCode ?? null,
    placeId: resourceName || row.metadata?.placeId || null,
    phone: row.phoneNumbers?.primaryPhone ?? null,
    website: row.websiteUri ?? null,
    primaryCategory: row.primaryCategory?.displayName ?? row.primaryCategory?.name ?? null,
    addressLine: row.storefrontAddress?.addressLines?.join(", ") ?? null,
    city: row.storefrontAddress?.locality ?? null,
    region: row.storefrontAddress?.administrativeArea ?? null,
    postalCode: row.storefrontAddress?.postalCode ?? null,
    country: row.storefrontAddress?.regionCode ?? null,
  };
}

export async function syncGoogleLocations(input: {
  tenantId: string;
  secretId?: string;
  createdByUserId?: string;
}) {
  const credential = await refreshAccessToken(input.tenantId, input.secretId);
  const accounts = await googleJson<{ accounts?: Array<{ name?: string; accountName?: string }> }>({
    tenantId: input.tenantId,
    secretId: credential.secretId,
    operation: "GBP_LIST_ACCOUNTS",
    url: `${ACCOUNT_MANAGEMENT_BASE}/accounts`,
  });
  const accountNames = (accounts.accounts ?? []).map((a) => a.name).filter(Boolean) as string[];
  let created = 0;
  let updated = 0;
  const locations = [];
  for (const accountName of accountNames) {
    const readMask = [
      "name",
      "title",
      "storeCode",
      "storefrontAddress",
      "phoneNumbers",
      "websiteUri",
      "primaryCategory",
      "metadata",
    ].join(",");
    const body = await googleJson<{ locations?: GoogleLocationApiRow[] }>({
      tenantId: input.tenantId,
      secretId: credential.secretId,
      operation: "GBP_LIST_LOCATIONS",
      url: `${BUSINESS_INFO_BASE}/${accountName}/locations?readMask=${encodeURIComponent(readMask)}`,
    });
    for (const raw of body.locations ?? []) {
      const normalized = normalizeGoogleLocation(raw, accountName);
      const existing = normalized.placeId
        ? await prisma.gmbLocation.findFirst({
            where: { tenantId: input.tenantId, placeId: normalized.placeId },
            select: { id: true },
          })
        : null;
      const data = {
        name: normalized.name,
        storeCode: normalized.storeCode,
        placeId: normalized.placeId,
        phone: normalized.phone,
        website: normalized.website,
        primaryCategory: normalized.primaryCategory,
        addressLine: normalized.addressLine,
        city: normalized.city,
        region: normalized.region,
        postalCode: normalized.postalCode,
        country: normalized.country,
        status: GmbLocationStatus.CONNECTED,
        secretId: credential.secretId,
        lastSyncedAt: new Date(),
      };
      const row = existing
        ? await prisma.gmbLocation.update({ where: { id: existing.id }, data })
        : await prisma.gmbLocation.create({
            data: {
              tenantId: input.tenantId,
              createdByUserId: input.createdByUserId ?? null,
              ...data,
            },
          });
      existing ? (updated += 1) : (created += 1);
      locations.push(row);
    }
  }
  return { accounts: accountNames.length, created, updated, total: locations.length };
}

export function mapGoogleStarRating(starRating: string | number | undefined): number | null {
  if (typeof starRating === "number") return Math.min(5, Math.max(1, Math.round(starRating)));
  switch (starRating) {
    case "ONE":
      return 1;
    case "TWO":
      return 2;
    case "THREE":
      return 3;
    case "FOUR":
      return 4;
    case "FIVE":
      return 5;
    default:
      return null;
  }
}

export interface GoogleReviewApiRow {
  reviewId?: string;
  name?: string;
  reviewer?: { displayName?: string };
  starRating?: string | number;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

export function summarizeGoogleReviews(reviews: Array<{ rating: number }>) {
  const count = reviews.length;
  const rating = count
    ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / count) * 100) / 100
    : null;
  return { reviewCount: count, rating };
}

export async function syncGoogleReviewsForLocation(tenantId: string, locationId: string) {
  const location = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true, placeId: true, secretId: true },
  });
  if (!location) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  if (!location.secretId || !location.placeId) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "This location needs a Google credential and Google resource name before live sync.",
    );
  }
  const reviews: Array<{ rating: number }> = [];
  let imported = 0;
  let updated = 0;
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams({ pageSize: "50" });
    if (pageToken) qs.set("pageToken", pageToken);
    const body = await googleJson<{ reviews?: GoogleReviewApiRow[]; nextPageToken?: string }>({
      tenantId,
      locationId,
      secretId: location.secretId,
      operation: "GBP_LIST_REVIEWS",
      url: `${MY_BUSINESS_BASE}/${location.placeId}/reviews?${qs.toString()}`,
    });
    for (const raw of body.reviews ?? []) {
      const rating = mapGoogleStarRating(raw.starRating);
      if (!rating) continue;
      reviews.push({ rating });
      const externalReviewId = raw.reviewId ?? raw.name ?? null;
      const existing = externalReviewId
        ? await prisma.gmbReview.findFirst({
            where: { tenantId, locationId, externalReviewId },
            select: { id: true },
          })
        : null;
      const data = {
        rating,
        authorName: raw.reviewer?.displayName ?? null,
        comment: raw.comment ?? null,
        reviewedAt: raw.updateTime || raw.createTime ? new Date(raw.updateTime ?? raw.createTime!) : null,
        externalReviewId,
        ...(raw.reviewReply?.comment
          ? {
              status: GmbReviewStatus.REPLIED,
              replyText: raw.reviewReply.comment,
              repliedAt: raw.reviewReply.updateTime ? new Date(raw.reviewReply.updateTime) : new Date(),
            }
          : {}),
      };
      if (existing) {
        await prisma.gmbReview.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await prisma.gmbReview.create({
          data: {
            tenantId,
            locationId,
            ...data,
          },
        });
        imported += 1;
      }
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  const summary = summarizeGoogleReviews(reviews);
  return {
    rating: summary.rating ?? undefined,
    reviewCount: summary.reviewCount,
    verificationState: "SYNCED",
    imported,
    updated,
    source: "GOOGLE" as const,
  };
}

// ----------------------------------------------------------------------------
// Insights auto-fetch (Business Profile Performance API). Replaces the
// copy-numbers-from-the-GBP-dashboard manual flow: the metrics land in
// GmbInsightSnapshot automatically, stamped source=GOOGLE.
// ----------------------------------------------------------------------------

// Metric → snapshot-column mapping. The Performance API superseded the v4
// insights metrics; direct/discovery/branded search splits and photo views
// no longer exist there, so those columns stay 0 on auto-synced rows.
const PERFORMANCE_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
] as const;

interface PerformanceTimeSeriesResponse {
  multiDailyMetricTimeSeries?: Array<{
    dailyMetricTimeSeries?: Array<{
      dailyMetric?: string;
      timeSeries?: { datedValues?: Array<{ value?: string | number }> };
    }>;
  }>;
}

/** Extract "locations/{id}" from the stored Google resource name
 *  ("accounts/{a}/locations/{l}" or already bare). */
export function toPerformanceLocationName(resourceName: string): string | null {
  const match = resourceName.match(/locations\/[^/]+$/);
  return match ? match[0] : null;
}

function sumSeries(
  response: PerformanceTimeSeriesResponse,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const multi of response.multiDailyMetricTimeSeries ?? []) {
    for (const series of multi.dailyMetricTimeSeries ?? []) {
      if (!series.dailyMetric) continue;
      let sum = 0;
      for (const dv of series.timeSeries?.datedValues ?? []) {
        const n = Number(dv.value ?? 0);
        if (Number.isFinite(n)) sum += n;
      }
      totals[series.dailyMetric] = (totals[series.dailyMetric] ?? 0) + sum;
    }
  }
  return totals;
}

export interface InsightsSyncResult {
  periodStart: Date;
  periodEnd: Date;
  mapsViews: number;
  searchViews: number;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  messageClicks: number;
  bookingClicks: number;
  source: "GOOGLE";
}

export async function syncGoogleInsightsForLocation(
  tenantId: string,
  locationId: string,
  days = 30,
): Promise<InsightsSyncResult> {
  const location = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true, placeId: true, secretId: true },
  });
  if (!location) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  if (!location.secretId || !location.placeId) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "This location needs a Google credential and Google resource name before live sync.",
    );
  }
  const perfName = toPerformanceLocationName(location.placeId);
  if (!perfName) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Location's Google resource name is not in the expected accounts/*/locations/* shape.",
    );
  }

  // The Performance API lags ~3 days; end the window there so the last
  // days aren't permanently under-reported in the stored snapshot.
  const end = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const qs = new URLSearchParams();
  for (const metric of PERFORMANCE_METRICS) qs.append("dailyMetrics", metric);
  qs.set("dailyRange.startDate.year", String(start.getUTCFullYear()));
  qs.set("dailyRange.startDate.month", String(start.getUTCMonth() + 1));
  qs.set("dailyRange.startDate.day", String(start.getUTCDate()));
  qs.set("dailyRange.endDate.year", String(end.getUTCFullYear()));
  qs.set("dailyRange.endDate.month", String(end.getUTCMonth() + 1));
  qs.set("dailyRange.endDate.day", String(end.getUTCDate()));

  const body = await googleJson<PerformanceTimeSeriesResponse>({
    tenantId,
    locationId,
    secretId: location.secretId,
    operation: "GBP_FETCH_INSIGHTS",
    url: `${PERFORMANCE_BASE}/${perfName}:fetchMultiDailyMetricsTimeSeries?${qs.toString()}`,
  });

  const totals = sumSeries(body);
  const metrics = {
    mapsViews:
      (totals.BUSINESS_IMPRESSIONS_DESKTOP_MAPS ?? 0) +
      (totals.BUSINESS_IMPRESSIONS_MOBILE_MAPS ?? 0),
    searchViews:
      (totals.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0) +
      (totals.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0),
    callClicks: totals.CALL_CLICKS ?? 0,
    websiteClicks: totals.WEBSITE_CLICKS ?? 0,
    directionRequests: totals.BUSINESS_DIRECTION_REQUESTS ?? 0,
    messageClicks: totals.BUSINESS_CONVERSATIONS ?? 0,
    bookingClicks: totals.BUSINESS_BOOKINGS ?? 0,
  };

  // One snapshot per (location, window); re-syncs refresh the same row.
  const periodStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const periodEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  await prisma.gmbInsightSnapshot.upsert({
    where: {
      locationId_periodStart_periodEnd: {
        locationId,
        periodStart,
        periodEnd,
      },
    },
    update: { ...metrics, source: "GOOGLE" },
    create: {
      tenantId,
      locationId,
      periodStart,
      periodEnd,
      ...metrics,
      source: "GOOGLE",
    },
  });

  return { periodStart, periodEnd, ...metrics, source: "GOOGLE" };
}

export async function updateGoogleReviewReply(input: {
  tenantId: string;
  locationId: string;
  locationResourceName: string;
  secretId: string;
  externalReviewId: string;
  comment: string;
}) {
  const reviewName = buildGoogleReviewResourceName(input.locationResourceName, input.externalReviewId);
  if (!reviewName) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "This review is missing a Google review resource name.",
    );
  }

  const body = await googleJson<{ comment?: string; updateTime?: string }>({
    tenantId: input.tenantId,
    locationId: input.locationId,
    secretId: input.secretId,
    operation: "GBP_UPDATE_REVIEW_REPLY",
    method: "PUT",
    url: `${MY_BUSINESS_BASE}/${reviewName}/reply`,
    body: { comment: input.comment },
  });

  return {
    comment: body.comment ?? input.comment,
    updateTime: body.updateTime ?? new Date().toISOString(),
    reviewName,
  };
}

/**
 * Create a Google Business Profile local post. The location's stored resource
 * name ("accounts/…/locations/…") anchors the call. Google requires CALL to
 * omit its URL; other CTA types require one. A single public image is sent to
 * match NexaFlow's one-branded-image product constraint.
 */
export interface GoogleLocalPostInput {
  tenantId: string;
  locationId: string;
  locationResourceName: string;
  secretId: string;
  summary: string;
  mediaUrl?: string | null;
  callToActionType?: string | null;
  callToActionUrl?: string | null;
}

export function buildGoogleLocalPostBody(
  input: Pick<
    GoogleLocalPostInput,
    "summary" | "mediaUrl" | "callToActionType" | "callToActionUrl"
  >,
) {
  const callToAction =
    input.callToActionType === "CALL"
      ? { actionType: "CALL" }
      : input.callToActionType && input.callToActionUrl
        ? { actionType: input.callToActionType, url: input.callToActionUrl }
        : null;
  return {
    languageCode: "en-US",
    topicType: "STANDARD",
    summary: input.summary,
    ...(input.mediaUrl
      ? { media: [{ mediaFormat: "PHOTO", sourceUrl: input.mediaUrl }] }
      : {}),
    ...(callToAction ? { callToAction } : {}),
  };
}

export async function createGoogleLocalPost(input: GoogleLocalPostInput) {
  const body = await googleJson<{ name?: string; state?: string; createTime?: string }>({
    tenantId: input.tenantId,
    locationId: input.locationId,
    secretId: input.secretId,
    operation: "GBP_CREATE_LOCAL_POST",
    method: "POST",
    url: `${MY_BUSINESS_BASE}/${input.locationResourceName}/localPosts`,
    body: buildGoogleLocalPostBody(input),
  });
  return {
    name: body.name ?? null,
    state: body.state ?? null,
    createTime: body.createTime ?? null,
  };
}
