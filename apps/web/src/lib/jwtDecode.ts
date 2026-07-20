// Display-only JWT payload decoder.
//
// IMPORTANT: this does NOT verify the signature — it just base64-decodes
// the middle segment so the UI can read display claims (e.g. an
// impersonation `actorUserId`). Trusting these claims for any
// security decision is incorrect; the server does the real check on
// every request. Use only for showing the impersonation banner,
// session-expiry hints, etc.

export interface DecodedTokenPayload {
  userId?: string;
  role?: string;
  tenantId?: string;
  actorUserId?: string;
  actorRole?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

function base64UrlDecode(segment: string): string | null {
  // JWT uses base64url encoding (- instead of +, _ instead of /, no =).
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const withPadding = padded + "=".repeat(padLen);
  try {
    if (typeof atob === "function") {
      // Browser path.
      return atob(withPadding);
    }
    // Node / SSR path (also reachable from vitest).
    return Buffer.from(withPadding, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Pure decoder. Returns null when the input isn't a well-formed
 * three-segment JWT or when the middle segment isn't valid JSON.
 * Never throws.
 */
export function decodeJwtPayload(
  token: string | null | undefined,
): DecodedTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const json = base64UrlDecode(parts[1]);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as DecodedTokenPayload;
  } catch {
    return null;
  }
}

/**
 * True when the token carries an `actorUserId` claim — i.e. the
 * caller is operating inside an impersonation session.
 */
export function isImpersonating(
  token: string | null | undefined,
): boolean {
  const payload = decodeJwtPayload(token);
  return Boolean(payload?.actorUserId);
}
