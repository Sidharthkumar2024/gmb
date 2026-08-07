import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes, type RoleName } from "@nexaflow/shared";

// Authentication + tenant scoping for the standalone GMB app.
//
// The extracted GMB routes rely on two invariants that this file is the sole
// enforcer of:
//   1. `req.tenantId` comes from the verified JWT and NEVER from the body,
//      query or a header. Every GMB Prisma query filters on it, so letting a
//      client influence it would collapse tenant isolation.
//   2. `req.userId` is a real, active user — the GMB verification flow keys its
//      customer-initiated policy on it.

export interface RequestWithAuth extends Request {
  tenantId?: string;
  userId?: string;
  userRole?: RoleName;
  emailVerified?: boolean;
}

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  role: RoleName;
  // Set only on an impersonation token: the admin acting as this user. Recorded
  // for the UI banner + audit; the server still authorizes by sub/tenant/role.
  actorUserId?: string;
  actorRole?: RoleName;
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16 || secret.startsWith("change_me")) {
    // Refuse to run on a default/placeholder secret rather than issue tokens
    // anyone can forge.
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      500,
      "JWT_SECRET is not configured with a real value.",
    );
  }
  return secret;
}

export function signAccessToken(
  payload: AccessTokenPayload,
  expiresIn: string = process.env.JWT_EXPIRES_IN ?? "1h",
): string {
  return jwt.sign(payload, jwtSecret(), { expiresIn, algorithm: "HS256" } as jwt.SignOptions);
}

/**
 * Access-token lifetime in seconds, for the `expiresIn` the client uses to
 * schedule a refresh. Parsed from the same JWT_EXPIRES_IN the signer uses so
 * the two can never drift apart.
 */
export function accessTokenTtlSeconds(): number {
  const raw = process.env.JWT_EXPIRES_IN ?? "1h";
  const m = /^(\d+)([smhd])$/.exec(raw.trim());
  if (!m) return 3600;
  const n = Number(m[1]);
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "s" | "m" | "h" | "d"];
  return n * mult;
}

/**
 * Verify the bearer token and attach identity to the request. Rejects tokens
 * for users or tenants that have since been deactivated — a still-valid JWT
 * must not outlive the account it names.
 */
export async function requireAuth(
  req: RequestWithAuth,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Authentication required.");
    }

    let decoded: AccessTokenPayload;
    try {
      // Pin the algorithm: only HS256 (the one we sign with) is accepted, so a
      // token asserting a different `alg` can never be verified. Defence in
      // depth — jsonwebtoken@9 already restricts a string secret to HMAC and
      // rejects `alg:none`, but pinning removes any dependence on that default.
      decoded = jwt.verify(token, jwtSecret(), { algorithms: ["HS256"] }) as AccessTokenPayload;
    } catch {
      throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Invalid or expired token.");
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        tenantId: true,
        role: true,
        isActive: true,
        emailVerified: true,
        tenant: { select: { status: true } },
      },
    });

    if (!user || !user.isActive) {
      throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Account is not active.");
    }
    if (user.tenant.status !== "ACTIVE") {
      throw new ApiError(ErrorCodes.FORBIDDEN, 403, "This workspace is not active.");
    }

    // Sourced from the DB, not the token, so a re-parented or role-changed user
    // cannot keep acting on stale claims until their token expires.
    req.userId = user.id;
    req.tenantId = user.tenantId;
    req.userRole = user.role as RoleName;
    req.emailVerified = user.emailVerified;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Let an unverified member inspect their workspace, but block state-changing
 * product operations until they prove control of the login address. Auth's
 * verify/resend endpoints live on a separate router and remain reachable.
 */
export function requireVerifiedEmailForMutation(
  req: RequestWithAuth,
  _res: Response,
  next: NextFunction,
): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.userRole === "SUPER_ADMIN") {
    next();
    return;
  }
  if (!req.emailVerified) {
    next(new ApiError(ErrorCodes.FORBIDDEN, 403, "Verify your email before making changes."));
    return;
  }
  next();
}

/**
 * Assert a tenant is in scope. Separate from requireAuth so the ordering in the
 * extracted routes (`requireAuth, requireTenantScope, requirePermission`) keeps
 * working unchanged.
 */
export function requireTenantScope(
  req: RequestWithAuth,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.tenantId) {
    next(
      new ApiError(
        ErrorCodes.MULTI_TENANT_VIOLATION,
        400,
        "Tenant scope required.",
      ),
    );
    return;
  }
  next();
}
