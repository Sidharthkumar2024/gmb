// Shared contracts for the standalone GMB app.
//
// The extracted GMB code imports exactly three things from "@nexaflow/shared":
// ApiError, ErrorCodes and Permissions (verified by inventorying every import
// of this package). The package name is kept identical to the monorepo's so the
// 61 extracted service files need no import rewrites.

export const ErrorCodes = {
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  MULTI_TENANT_VIOLATION: "MULTI_TENANT_VIOLATION",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Error carrying an HTTP status. The API's error middleware reads `statusCode`
 * and `code`; anything else surfaces as a 500.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    statusCode: number,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }
}

/**
 * Permission keys. GMB_MANAGE is the only one the extracted routes reference;
 * the rest are kept so role definitions stay readable as the app grows.
 */
export const Permissions = {
  GMB_MANAGE: "gmb:manage",
  SECRET_VAULT_MANAGE: "secret_vault:manage",
  AI_PROVIDER_MANAGE: "ai_provider:manage",
  BILLING_VIEW: "billing:view",
  WALLET_VIEW: "wallet:view",
  TEAM_MANAGE: "team:manage",
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

export type RoleName =
  | "SUPER_ADMIN"
  | "WHITE_LABEL_ADMIN"
  | "BUSINESS_ADMIN"
  | "AGENT";

export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  SUPER_ADMIN: Object.values(Permissions),
  WHITE_LABEL_ADMIN: [
    Permissions.GMB_MANAGE,
    Permissions.BILLING_VIEW,
    Permissions.WALLET_VIEW,
    Permissions.TEAM_MANAGE,
  ],
  BUSINESS_ADMIN: [
    Permissions.GMB_MANAGE,
    Permissions.SECRET_VAULT_MANAGE,
    Permissions.AI_PROVIDER_MANAGE,
    Permissions.BILLING_VIEW,
    Permissions.WALLET_VIEW,
    Permissions.TEAM_MANAGE,
  ],
  // Agents work the review/Q&A queues but do not manage credentials or billing.
  AGENT: [Permissions.GMB_MANAGE],
};

export function roleHasPermission(role: RoleName, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}
