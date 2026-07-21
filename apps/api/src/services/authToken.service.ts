import crypto from "node:crypto";
import { prisma, AuthTokenPurpose } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// Token handling for refresh sessions, email verification and password reset.
//
// Governing rule: the database never stores a usable token. Every value is
// kept as a SHA-256 hash, so a leaked dump yields nothing an attacker can
// present. The plaintext exists only in the response that created it.
//
// SHA-256 (not bcrypt) is deliberate here: these are 256-bit random values, not
// user-chosen passwords, so there is no dictionary to attack and the lookup
// needs to be an indexed exact match rather than a per-row compare.

const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
const EMAIL_VERIFY_TTL_HOURS = Number(process.env.EMAIL_VERIFY_TTL_HOURS ?? 48);
const PASSWORD_RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 60);

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// --- Refresh sessions -------------------------------------------------------

export interface IssuedRefresh {
  refreshToken: string;
  expiresAt: Date;
}

export async function issueRefreshToken(
  userId: string,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<IssuedRefresh> {
  const refreshToken = newToken();
  const expiresAt = daysFromNow(REFRESH_TTL_DAYS);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    },
  });
  return { refreshToken, expiresAt };
}

/**
 * Exchange a refresh token for a new one, revoking the old.
 *
 * Rotation is what makes theft detectable: a token is valid exactly once. If a
 * revoked token is presented again, that means either the real client or an
 * attacker replayed it, and we cannot tell which — so every session for that
 * user is killed and they must sign in again. Losing a session is an acceptable
 * cost for shutting down a live theft.
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<{ userId: string } & IssuedRefresh> {
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!existing) {
    throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Invalid session. Please sign in again.");
  }

  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    console.warn(
      `[auth] refresh-token reuse detected for user ${existing.userId}; all sessions revoked`,
    );
    throw new ApiError(
      ErrorCodes.UNAUTHORIZED,
      401,
      "This session is no longer valid. Please sign in again.",
    );
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Session expired. Please sign in again.");
  }

  const issued = await issueRefreshToken(existing.userId, meta);
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedByHash: hashToken(issued.refreshToken) },
  });

  return { userId: existing.userId, ...issued };
}

/** Sign-out. Unknown or already-revoked tokens are a no-op, never an error. */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// --- Single-use tokens (verify email / reset password) ----------------------

export async function issueAuthToken(
  userId: string,
  purpose: AuthTokenPurpose,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt =
    purpose === AuthTokenPurpose.EMAIL_VERIFY
      ? new Date(Date.now() + EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1000)
      : new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

  // Only the newest token of a purpose should work; requesting a new reset
  // link must invalidate the previous one.
  await prisma.authToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.authToken.create({
    data: { userId, purpose, tokenHash: hashToken(token), expiresAt },
  });
  return { token, expiresAt };
}

/**
 * Validate and burn a single-use token. Consuming it in the same call is what
 * prevents a reset link working twice.
 */
export async function consumeAuthToken(
  rawToken: string,
  purpose: AuthTokenPurpose,
): Promise<{ userId: string }> {
  const row = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });

  const invalid = new ApiError(
    ErrorCodes.BAD_REQUEST,
    400,
    "This link is invalid or has expired. Request a new one.",
  );

  if (!row || row.purpose !== purpose || row.usedAt) throw invalid;
  if (row.expiresAt.getTime() <= Date.now()) throw invalid;

  await prisma.authToken.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  return { userId: row.userId };
}
