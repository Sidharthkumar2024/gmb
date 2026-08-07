import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";

// Authorization-boundary contract tests: drive the real app end to end with a
// SIGNED token, mocking only the user row requireAuth reads. This proves the
// server enforces roles itself (not just the UI): a customer token cannot reach
// admin/partner actions, an inactive user is rejected, a suspended workspace is
// blocked. requireAuth authorizes by the DB role (not the token), so the mocked
// user row is what the role check sees.

const deps = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  wlcFindFirst: vi.fn().mockResolvedValue(null),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      user: { findUnique: deps.userFindUnique },
      $queryRaw: deps.queryRaw,
      whiteLabelConfig: { findFirst: deps.wlcFindFirst },
    },
  };
});

import { app } from "./app";
import { signAccessToken } from "./middleware/auth";

let server: Server;
let base = "";

const activeUser = (role: string) => ({
  id: "u1",
  tenantId: "t1",
  role,
  isActive: true,
  emailVerified: true,
  tenant: { status: "ACTIVE" },
});

function tokenFor(role: string): string {
  // requireAuth ignores the token's role (re-reads from the DB), but the payload
  // type requires it. Authorization is driven by the mocked user row's role.
  return signAccessToken({ sub: "u1", tenantId: "t1", role: role as never });
}

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", "test-jwt-secret-0123456789-abcdef");
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  vi.unstubAllEnvs();
  server?.close();
});

afterEach(() => vi.clearAllMocks());

function get(path: string, role: string) {
  return fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tokenFor(role)}` } });
}

describe("app authorization boundary", () => {
  it("forbids a customer (BUSINESS_ADMIN) from the admin console (403, server-enforced)", async () => {
    deps.userFindUnique.mockResolvedValue(activeUser("BUSINESS_ADMIN"));
    const res = await get("/api/v1/admin/overview", "BUSINESS_ADMIN");
    expect(res.status).toBe(403);
  });

  it("forbids a customer from the partner portal (403)", async () => {
    deps.userFindUnique.mockResolvedValue(activeUser("BUSINESS_ADMIN"));
    const res = await get("/api/v1/partner/overview", "BUSINESS_ADMIN");
    expect(res.status).toBe(403);
  });

  it("forbids a partner (WHITE_LABEL_ADMIN) from the admin console (403)", async () => {
    deps.userFindUnique.mockResolvedValue(activeUser("WHITE_LABEL_ADMIN"));
    const res = await get("/api/v1/admin/overview", "WHITE_LABEL_ADMIN");
    expect(res.status).toBe(403);
  });

  it("rejects a valid token whose user is no longer active (401)", async () => {
    deps.userFindUnique.mockResolvedValue({ ...activeUser("SUPER_ADMIN"), isActive: false });
    const res = await get("/api/v1/auth/me", "SUPER_ADMIN");
    expect(res.status).toBe(401);
  });

  it("blocks a user whose workspace is suspended (403)", async () => {
    deps.userFindUnique.mockResolvedValue({ ...activeUser("BUSINESS_ADMIN"), tenant: { status: "SUSPENDED" } });
    const res = await get("/api/v1/auth/me", "BUSINESS_ADMIN");
    expect(res.status).toBe(403);
  });
});
