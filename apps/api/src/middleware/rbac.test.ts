import { describe, expect, it, vi } from "vitest";
import { Permissions, UserRole } from "@nexaflow/shared";
import type { NextFunction, Response } from "express";
import type { RequestWithAuth } from "./auth";
import { requirePermission, requireRole } from "./rbac";

// Authorization gates fail CLOSED: no authenticated role -> 401, wrong
// role/permission -> 403, and only an explicitly-allowed role calls next()
// cleanly (no error argument).

function run(mw: (r: RequestWithAuth, res: Response, n: NextFunction) => void, userRole?: string) {
  const next = vi.fn();
  mw({ userRole } as RequestWithAuth, {} as Response, next as NextFunction);
  return next.mock.calls[0]?.[0]; // the error passed to next(), or undefined on success
}

describe("requirePermission", () => {
  it("401s when no role is present (unauthenticated reached the gate)", () => {
    expect(run(requirePermission(Permissions.GMB_MANAGE), undefined)).toMatchObject({ statusCode: 401 });
  });

  it("403s when the role lacks the permission", () => {
    // AGENT has GMB_MANAGE but not SECRET_VAULT_MANAGE.
    expect(run(requirePermission(Permissions.SECRET_VAULT_MANAGE), UserRole.AGENT)).toMatchObject({ statusCode: 403 });
  });

  it("passes (no error) when the role has the permission", () => {
    expect(run(requirePermission(Permissions.GMB_MANAGE), UserRole.AGENT)).toBeUndefined();
    expect(run(requirePermission(Permissions.AI_PROVIDER_MANAGE), UserRole.SUPER_ADMIN)).toBeUndefined();
  });
});

describe("requireRole", () => {
  it("401s when no role is present", () => {
    expect(run(requireRole(UserRole.SUPER_ADMIN), undefined)).toMatchObject({ statusCode: 401 });
  });

  it("403s when the role is not in the allowed set", () => {
    expect(run(requireRole(UserRole.SUPER_ADMIN), UserRole.BUSINESS_ADMIN)).toMatchObject({ statusCode: 403 });
  });

  it("passes when the role is one of the allowed set", () => {
    expect(run(requireRole(UserRole.SUPER_ADMIN, UserRole.WHITE_LABEL_ADMIN), UserRole.WHITE_LABEL_ADMIN)).toBeUndefined();
  });
});
