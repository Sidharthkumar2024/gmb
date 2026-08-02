import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Response } from "express";

// The sole enforcer of GMB tenant isolation. Key invariants: identity is
// sourced from the DB (never the token's claims), a deactivated user/tenant is
// rejected even with a still-valid JWT, and the app refuses to run on a
// placeholder JWT secret rather than issue forgeable tokens.

const deps = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return { ...actual, prisma: { user: { findUnique: deps.findUnique } } };
});

import {
  accessTokenTtlSeconds,
  requireAuth,
  requireTenantScope,
  signAccessToken,
  type RequestWithAuth,
} from "./auth";

const GOOD_SECRET = "a-strong-test-secret-of-adequate-length";

async function runAuth(token: string | null): Promise<{ req: RequestWithAuth; err: unknown }> {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} } as RequestWithAuth;
  const next = vi.fn();
  await requireAuth(req, {} as Response, next as NextFunction);
  return { req, err: next.mock.calls[0]?.[0] };
}

beforeEach(() => vi.stubEnv("JWT_SECRET", GOOD_SECRET));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("accessTokenTtlSeconds", () => {
  it("parses the JWT_EXPIRES_IN units, defaulting to 3600 on a bad value", () => {
    vi.stubEnv("JWT_EXPIRES_IN", "1h"); expect(accessTokenTtlSeconds()).toBe(3600);
    vi.stubEnv("JWT_EXPIRES_IN", "30m"); expect(accessTokenTtlSeconds()).toBe(1800);
    vi.stubEnv("JWT_EXPIRES_IN", "45s"); expect(accessTokenTtlSeconds()).toBe(45);
    vi.stubEnv("JWT_EXPIRES_IN", "2d"); expect(accessTokenTtlSeconds()).toBe(172800);
    vi.stubEnv("JWT_EXPIRES_IN", "garbage"); expect(accessTokenTtlSeconds()).toBe(3600);
  });
});

describe("signAccessToken / jwtSecret", () => {
  it("refuses to sign on a missing or placeholder secret (500)", () => {
    vi.stubEnv("JWT_SECRET", "short");
    expect(() => signAccessToken({ sub: "u1", tenantId: "t1", role: "AGENT" })).toThrow();
    vi.stubEnv("JWT_SECRET", "change_me_please_now");
    expect(() => signAccessToken({ sub: "u1", tenantId: "t1", role: "AGENT" })).toThrow();
  });
});

describe("requireAuth", () => {
  const activeUser = {
    id: "u1", tenantId: "real-tenant", role: "BUSINESS_ADMIN", isActive: true,
    tenant: { status: "ACTIVE" },
  };

  it("401s with no bearer token", async () => {
    const { err } = await runAuth(null);
    expect(err).toMatchObject({ statusCode: 401 });
    expect(deps.findUnique).not.toHaveBeenCalled();
  });

  it("401s on a malformed token", async () => {
    const { err } = await runAuth("not.a.jwt");
    expect(err).toMatchObject({ statusCode: 401 });
  });

  it("401s on an expired token", async () => {
    const token = signAccessToken({ sub: "u1", tenantId: "t1", role: "AGENT" }, "-1s");
    const { err } = await runAuth(token);
    expect(err).toMatchObject({ statusCode: 401 });
  });

  it("401s when the user is missing or inactive", async () => {
    const token = signAccessToken({ sub: "u1", tenantId: "t1", role: "AGENT" });
    deps.findUnique.mockResolvedValueOnce(null);
    expect((await runAuth(token)).err).toMatchObject({ statusCode: 401 });
    deps.findUnique.mockResolvedValueOnce({ ...activeUser, isActive: false });
    expect((await runAuth(token)).err).toMatchObject({ statusCode: 401 });
  });

  it("403s when the workspace is not active", async () => {
    const token = signAccessToken({ sub: "u1", tenantId: "t1", role: "AGENT" });
    deps.findUnique.mockResolvedValue({ ...activeUser, tenant: { status: "SUSPENDED" } });
    expect((await runAuth(token)).err).toMatchObject({ statusCode: 403 });
  });

  it("attaches identity FROM THE DB, ignoring the token's tenant/role claims", async () => {
    // Token claims a different tenant + role than the DB row — the DB wins.
    const token = signAccessToken({ sub: "u1", tenantId: "spoofed-tenant", role: "SUPER_ADMIN" });
    deps.findUnique.mockResolvedValue(activeUser);
    const { req, err } = await runAuth(token);
    expect(err).toBeUndefined();
    expect(req.tenantId).toBe("real-tenant"); // NOT "spoofed-tenant"
    expect(req.userRole).toBe("BUSINESS_ADMIN"); // NOT "SUPER_ADMIN"
    expect(req.userId).toBe("u1");
  });
});

describe("requireTenantScope", () => {
  it("400s when no tenant is in scope", () => {
    const next = vi.fn();
    requireTenantScope({} as RequestWithAuth, {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });

  it("passes when a tenant is present", () => {
    const next = vi.fn();
    requireTenantScope({ tenantId: "t1" } as RequestWithAuth, {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeUndefined();
  });
});
