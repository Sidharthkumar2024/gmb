import { afterEach, describe, expect, it, vi } from "vitest";

// Platform Google OAuth config: the client secret is encrypted at rest and
// never returned raw (only hasSecret + last4), a blank secret on update
// preserves the stored one, and the sync cache only serves creds when the
// config is enabled AND complete — otherwise callers fall back to env.

const deps = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return { ...actual, prisma: { googleOAuthConfig: { findUnique: deps.findUnique, upsert: deps.upsert } } };
});

vi.mock("../lib/tokenCrypto", () => ({
  encryptToken: (v: string) => `cipher:${v}`,
  decryptToken: (c: string) => c.replace(/^cipher:/, ""),
}));

import {
  getCachedGoogleClientConfig,
  getSafeGoogleOAuthConfig,
  normalizeGoogleConfigInput,
  primeGoogleOAuthCache,
  saveGoogleOAuthConfig,
} from "./googleOAuthConfig.service";

const DEFAULT_SCOPE = "https://www.googleapis.com/auth/business.manage";

afterEach(() => vi.clearAllMocks());

describe("normalizeGoogleConfigInput", () => {
  it("trims fields, defaults the scope, and coerces enabled", () => {
    expect(normalizeGoogleConfigInput({ clientId: "  cid  ", redirectUri: " uri ", scope: "  " })).toEqual({
      clientId: "cid",
      redirectUri: "uri",
      scope: DEFAULT_SCOPE,
      enabled: false,
    });
    expect(normalizeGoogleConfigInput({ scope: "custom", enabled: true }).scope).toBe("custom");
  });
});

describe("getSafeGoogleOAuthConfig", () => {
  it("returns empty defaults when no row exists", async () => {
    deps.findUnique.mockResolvedValue(null);
    expect(await getSafeGoogleOAuthConfig()).toEqual({
      clientId: "",
      redirectUri: "",
      scope: DEFAULT_SCOPE,
      enabled: false,
      hasSecret: false,
      secretLast4: null,
    });
  });

  it("never leaks the encrypted secret — only hasSecret + last4", async () => {
    deps.findUnique.mockResolvedValue({
      clientId: "cid",
      redirectUri: "uri",
      scope: DEFAULT_SCOPE,
      enabled: true,
      clientSecretCipher: "cipher:the-secret",
      clientSecretLast4: "cret",
    });
    const safe = await getSafeGoogleOAuthConfig();
    expect(safe).toMatchObject({ hasSecret: true, secretLast4: "cret" });
    expect(JSON.stringify(safe)).not.toContain("the-secret");
    expect(safe).not.toHaveProperty("clientSecretCipher");
  });
});

describe("saveGoogleOAuthConfig", () => {
  it("encrypts and stores a supplied secret with its last4", async () => {
    deps.upsert.mockResolvedValue({
      clientId: "cid", redirectUri: "uri", scope: DEFAULT_SCOPE, enabled: true,
      clientSecretCipher: "cipher:abcd1234", clientSecretLast4: "1234",
    });
    deps.findUnique.mockResolvedValue(null); // prime cache read
    await saveGoogleOAuthConfig({ clientId: "cid", clientSecret: "abcd1234", enabled: true });
    const update = deps.upsert.mock.calls[0][0].update;
    expect(update.clientSecretCipher).toBe("cipher:abcd1234");
    expect(update.clientSecretLast4).toBe("1234");
  });

  it("preserves the stored secret when none is supplied (no secret fields written)", async () => {
    deps.upsert.mockResolvedValue({
      clientId: "cid", redirectUri: "uri", scope: DEFAULT_SCOPE, enabled: false,
      clientSecretCipher: "cipher:old", clientSecretLast4: "old4",
    });
    deps.findUnique.mockResolvedValue(null);
    await saveGoogleOAuthConfig({ clientId: "cid" });
    const update = deps.upsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty("clientSecretCipher");
    expect(update).not.toHaveProperty("clientSecretLast4");
  });
});

describe("google oauth cache", () => {
  it("serves decrypted creds only when enabled AND complete", async () => {
    deps.findUnique.mockResolvedValue({
      enabled: true, clientId: "cid", clientSecretCipher: "cipher:sekret",
    });
    await primeGoogleOAuthCache();
    expect(getCachedGoogleClientConfig()).toEqual({ clientId: "cid", clientSecret: "sekret" });
  });

  it("caches null when disabled (caller falls back to env)", async () => {
    deps.findUnique.mockResolvedValue({ enabled: false, clientId: "cid", clientSecretCipher: "cipher:x" });
    await primeGoogleOAuthCache();
    expect(getCachedGoogleClientConfig()).toBeNull();
  });

  it("caches null when the DB read throws (never propagates)", async () => {
    deps.findUnique.mockRejectedValue(new Error("db down"));
    await expect(primeGoogleOAuthCache()).resolves.toBeUndefined();
    expect(getCachedGoogleClientConfig()).toBeNull();
  });
});
