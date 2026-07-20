import type { NextFunction, Response } from "express";
import {
  ApiError,
  ErrorCodes,
  roleHasPermission,
  type Permission,
  type RoleName,
} from "@nexaflow/shared";
import type { RequestWithAuth } from "./auth";

/**
 * Permission gate. Must run after `requireAuth`, which is what populates
 * `userRole` from the database. An unauthenticated request reaching here is a
 * wiring bug, so it fails closed with 401 rather than silently allowing.
 */
export function requirePermission(permission: Permission) {
  return (req: RequestWithAuth, _res: Response, next: NextFunction): void => {
    const role = req.userRole;
    if (!role) {
      next(
        new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Authentication required."),
      );
      return;
    }
    if (!roleHasPermission(role, permission)) {
      next(
        new ApiError(
          ErrorCodes.FORBIDDEN,
          403,
          "You do not have permission to perform this action.",
        ),
      );
      return;
    }
    next();
  };
}

/** Restrict a route to an explicit set of roles. */
export function requireRole(...roles: RoleName[]) {
  return (req: RequestWithAuth, _res: Response, next: NextFunction): void => {
    if (!req.userRole) {
      next(
        new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Authentication required."),
      );
      return;
    }
    if (!roles.includes(req.userRole)) {
      next(
        new ApiError(ErrorCodes.FORBIDDEN, 403, "Insufficient role."),
      );
      return;
    }
    next();
  };
}
