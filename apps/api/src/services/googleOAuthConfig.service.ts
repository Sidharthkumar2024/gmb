import { prisma } from "@nexaflow/db";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";

// =====================================================================
// SuperAdmin "Google Business Profile — API Configuration". Stores the
// platform's Google OAuth app credentials (client id/secret, redirect URI,
// scope, enable toggle) as a single row. The client secret is envelope-
// encrypted at rest and never returned raw. A sync in-memory cache lets
// gmbGoogle.readClientConfig() prefer these creds (when enabled) without going
// async, falling back to environment variables when unset/disabled.
// =====================================================================

const CONFIG_ID = "default";
const DEFAULT_SCOPE = "https://www.googleapis.com/auth/business.manage";

export interface GoogleOAuthConfigInput {
  clientId?: string;
  /** Optional on update: when blank/omitted, the stored secret is preserved. */
  clientSecret?: string;
  redirectUri?: string;
  scope?: string;
  enabled?: boolean;
}

export interface SafeGoogleOAuthConfig {
  clientId: string;
  redirectUri: string;
  scope: string;
  enabled: boolean;
  hasSecret: boolean;
  secretLast4: string | null;
}

const last4 = (s: string) => (s.length >= 4 ? s.slice(-4) : s);

/** Pure: trim + default the editable (non-secret) fields. */
export function normalizeGoogleConfigInput(input: GoogleOAuthConfigInput): {
  clientId: string;
  redirectUri: string;
  scope: string;
  enabled: boolean;
} {
  return {
    clientId: (input.clientId ?? "").trim(),
    redirectUri: (input.redirectUri ?? "").trim(),
    scope: (input.scope ?? "").trim() || DEFAULT_SCOPE,
    enabled: Boolean(input.enabled),
  };
}

interface ConfigRow {
  clientId: string;
  redirectUri: string;
  scope: string;
  enabled: boolean;
  clientSecretCipher: string | null;
  clientSecretLast4: string | null;
}

function toSafe(row: ConfigRow): SafeGoogleOAuthConfig {
  return {
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    scope: row.scope,
    enabled: row.enabled,
    hasSecret: Boolean(row.clientSecretCipher),
    secretLast4: row.clientSecretLast4 ?? null,
  };
}

export async function getSafeGoogleOAuthConfig(): Promise<SafeGoogleOAuthConfig> {
  const row = await prisma.googleOAuthConfig.findUnique({ where: { id: CONFIG_ID } });
  if (!row) {
    return { clientId: "", redirectUri: "", scope: DEFAULT_SCOPE, enabled: false, hasSecret: false, secretLast4: null };
  }
  return toSafe(row);
}

export async function saveGoogleOAuthConfig(
  input: GoogleOAuthConfigInput,
  updatedByUserId?: string,
): Promise<SafeGoogleOAuthConfig> {
  const base = normalizeGoogleConfigInput(input);
  const secret = (input.clientSecret ?? "").trim();
  const secretFields = secret
    ? { clientSecretCipher: encryptToken(secret), clientSecretLast4: last4(secret) }
    : {}; // preserve existing secret when none supplied
  const row = await prisma.googleOAuthConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, ...base, ...secretFields, updatedByUserId: updatedByUserId ?? null },
    update: { ...base, ...secretFields, updatedByUserId: updatedByUserId ?? null },
  });
  await primeGoogleOAuthCache();
  return toSafe(row);
}

// ---------------------------------------------------------------------
// Sync cache consumed by gmbGoogle.readClientConfig() (env fallback on null).
// ---------------------------------------------------------------------
let cache: { clientId: string; clientSecret: string } | null = null;

/** Reload the cache from the DB. Best-effort: never throws (falls back to env). */
export async function primeGoogleOAuthCache(): Promise<void> {
  try {
    const row = await prisma.googleOAuthConfig.findUnique({ where: { id: CONFIG_ID } });
    cache =
      row && row.enabled && row.clientId && row.clientSecretCipher
        ? { clientId: row.clientId, clientSecret: decryptToken(row.clientSecretCipher) }
        : null;
  } catch {
    cache = null;
  }
}

/** Stored creds when configured + enabled, else null (caller uses env). */
export function getCachedGoogleClientConfig(): { clientId: string; clientSecret: string } | null {
  return cache;
}
