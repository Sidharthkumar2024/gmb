import { beforeEach, describe, expect, it, vi } from "vitest";

// The security properties these pin, in order of how badly they'd hurt:
//   1. Nothing usable is stored — only SHA-256 hashes.
//   2. A refresh token works exactly once; replaying a revoked one kills every
//      session for that user, because we cannot tell victim from attacker.
//   3. Reset/verify links are single-use and expire.

const mocks = vi.hoisted(() => ({
  refreshCreate: vi.fn(),
  refreshFindUnique: vi.fn(),
  refreshUpdate: vi.fn(),
  refreshUpdateMany: vi.fn(),
  authCreate: vi.fn(),
  authFindUnique: vi.fn(),
  authUpdate: vi.fn(),
  authUpdateMany: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    refreshToken: {
      create: mocks.refreshCreate,
      findUnique: mocks.refreshFindUnique,
      update: mocks.refreshUpdate,
      updateMany: mocks.refreshUpdateMany,
    },
    authToken: {
      create: mocks.authCreate,
      findUnique: mocks.authFindUnique,
      update: mocks.authUpdate,
      updateMany: mocks.authUpdateMany,
    },
  },
  AuthTokenPurpose: { EMAIL_VERIFY: "EMAIL_VERIFY", PASSWORD_RESET: "PASSWORD_RESET" },
}));

import {
  hashToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  issueAuthToken,
  consumeAuthToken,
} from "./authToken.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refreshCreate.mockResolvedValue({});
  mocks.refreshUpdate.mockResolvedValue({});
  mocks.refreshUpdateMany.mockResolvedValue({ count: 0 });
  mocks.authCreate.mockResolvedValue({});
  mocks.authUpdate.mockResolvedValue({});
  mocks.authUpdateMany.mockResolvedValue({ count: 0 });
});

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe("token storage", () => {
  it("persists only the hash, never the plaintext", async () => {
    const { refreshToken } = await issueRefreshToken("u1");
    const stored = mocks.refreshCreate.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(hashToken(refreshToken));
    expect(JSON.stringify(stored)).not.toContain(refreshToken);
  });

  it("issues a different token every time", async () => {
    const a = await issueRefreshToken("u1");
    const b = await issueRefreshToken("u1");
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });
});

describe("rotateRefreshToken", () => {
  it("rejects an unknown token", async () => {
    mocks.refreshFindUnique.mockResolvedValue(null);
    await expect(rotateRefreshToken("nope")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects an expired token", async () => {
    mocks.refreshFindUnique.mockResolvedValue({
      id: "r1", userId: "u1", revokedAt: null, expiresAt: past(),
    });
    await expect(rotateRefreshToken("old")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rotates: issues a new token and revokes the presented one", async () => {
    mocks.refreshFindUnique.mockResolvedValue({
      id: "r1", userId: "u1", revokedAt: null, expiresAt: future(),
    });
    const out = await rotateRefreshToken("good");
    expect(out.userId).toBe("u1");
    expect(out.refreshToken).toBeTruthy();
    const update = mocks.refreshUpdate.mock.calls[0][0];
    expect(update.where).toEqual({ id: "r1" });
    expect(update.data.revokedAt).toBeInstanceOf(Date);
    expect(update.data.replacedByHash).toBe(hashToken(out.refreshToken));
  });

  it("REVOKES EVERY SESSION when an already-revoked token is replayed", async () => {
    mocks.refreshFindUnique.mockResolvedValue({
      id: "r1", userId: "u1", revokedAt: new Date(), expiresAt: future(),
    });
    await expect(rotateRefreshToken("stolen")).rejects.toMatchObject({ statusCode: 401 });
    expect(mocks.refreshUpdateMany).toHaveBeenCalledWith({
      where: { userId: "u1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("does not issue a replacement when reuse is detected", async () => {
    mocks.refreshFindUnique.mockResolvedValue({
      id: "r1", userId: "u1", revokedAt: new Date(), expiresAt: future(),
    });
    await rotateRefreshToken("stolen").catch(() => undefined);
    expect(mocks.refreshCreate).not.toHaveBeenCalled();
  });
});

describe("revokeRefreshToken", () => {
  it("revokes by hash and never throws on an unknown token", async () => {
    await expect(revokeRefreshToken("whatever")).resolves.toBeUndefined();
    expect(mocks.refreshUpdateMany.mock.calls[0][0].where.tokenHash).toBe(hashToken("whatever"));
  });
});

describe("single-use auth tokens", () => {
  it("invalidates older tokens of the same purpose when issuing a new one", async () => {
    await issueAuthToken("u1", "PASSWORD_RESET" as never);
    expect(mocks.authUpdateMany).toHaveBeenCalledWith({
      where: { userId: "u1", purpose: "PASSWORD_RESET", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("consumes a valid token and marks it used", async () => {
    mocks.authFindUnique.mockResolvedValue({
      id: "a1", userId: "u1", purpose: "PASSWORD_RESET", usedAt: null, expiresAt: future(),
    });
    const out = await consumeAuthToken("tok", "PASSWORD_RESET" as never);
    expect(out.userId).toBe("u1");
    expect(mocks.authUpdate.mock.calls[0][0].data.usedAt).toBeInstanceOf(Date);
  });

  it("refuses a token already used (a reset link cannot work twice)", async () => {
    mocks.authFindUnique.mockResolvedValue({
      id: "a1", userId: "u1", purpose: "PASSWORD_RESET", usedAt: new Date(), expiresAt: future(),
    });
    await expect(consumeAuthToken("tok", "PASSWORD_RESET" as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("refuses an expired token", async () => {
    mocks.authFindUnique.mockResolvedValue({
      id: "a1", userId: "u1", purpose: "PASSWORD_RESET", usedAt: null, expiresAt: past(),
    });
    await expect(consumeAuthToken("tok", "PASSWORD_RESET" as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("refuses a token issued for a DIFFERENT purpose (no verify-link -> reset)", async () => {
    mocks.authFindUnique.mockResolvedValue({
      id: "a1", userId: "u1", purpose: "EMAIL_VERIFY", usedAt: null, expiresAt: future(),
    });
    await expect(consumeAuthToken("tok", "PASSWORD_RESET" as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("gives the same generic message for every failure mode", async () => {
    mocks.authFindUnique.mockResolvedValue(null);
    await expect(consumeAuthToken("tok", "PASSWORD_RESET" as never)).rejects.toThrow(
      /invalid or has expired/i,
    );
  });
});
