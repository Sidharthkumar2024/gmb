import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretProvider, SecretScope, SecretStatus } from "@nexaflow/db";
import { UserRole } from "@nexaflow/shared";

// The vault's security invariants: the scope + owning tenant are always derived
// from the caller (never the body), the ciphertext never leaks into a returned
// DTO, and every DB read/write is filtered by the caller's scope + tenant so one
// scope can't touch another's secrets.

const deps = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      secretVaultEntry: {
        findMany: deps.findMany,
        findFirst: deps.findFirst,
        create: deps.create,
        update: deps.update,
        delete: deps.delete,
      },
    },
  };
});

// Reversible fake crypto so tests can assert round-trips and that the stored
// ciphertext is the encrypted form, not the plaintext.
vi.mock("../lib/tokenCrypto", () => ({
  encryptToken: (v: string) => `cipher:${v}`,
  decryptToken: (c: string) => c.replace(/^cipher:/, ""),
}));

import {
  captureLast4,
  createSecret,
  deriveSecretContext,
  getSecret,
  resolveSecretValue,
  rotateSecret,
  safeParseMetadata,
  toSafeSecret,
} from "./secretVault.service";

const PLATFORM = { scope: SecretScope.PLATFORM, tenantId: null };
const PARTNER = { scope: SecretScope.PARTNER, tenantId: "t-partner" };

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sec-1",
    scope: SecretScope.PLATFORM,
    tenantId: null,
    provider: SecretProvider.CUSTOM,
    label: "OpenAI",
    ciphertext: "cipher:sk-secret-1234",
    last4: "1234",
    metadata: null,
    status: SecretStatus.ACTIVE,
    lastRotatedAt: null,
    lastTestedAt: null,
    lastTestOk: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("deriveSecretContext", () => {
  it("maps SuperAdmin to the PLATFORM scope with no tenant", () => {
    expect(deriveSecretContext(UserRole.SUPER_ADMIN, "ignored")).toEqual({
      scope: SecretScope.PLATFORM,
      tenantId: null,
    });
  });

  it("maps a partner to PARTNER scope carrying its tenant", () => {
    expect(deriveSecretContext(UserRole.WHITE_LABEL_ADMIN, "t9")).toEqual({
      scope: SecretScope.PARTNER,
      tenantId: "t9",
    });
  });

  it("maps a business admin to CUSTOMER scope carrying its tenant", () => {
    expect(deriveSecretContext(UserRole.BUSINESS_ADMIN, "t9")).toEqual({
      scope: SecretScope.CUSTOMER,
      tenantId: "t9",
    });
  });

  it("rejects a partner or customer with no tenant (403)", () => {
    expect(() => deriveSecretContext(UserRole.WHITE_LABEL_ADMIN, null)).toThrow();
    expect(() => deriveSecretContext(UserRole.BUSINESS_ADMIN, undefined)).toThrow();
  });

  it("rejects an unknown or missing role (403)", () => {
    expect(() => deriveSecretContext(undefined, "t9")).toThrow();
    expect(() => deriveSecretContext("SOMETHING_ELSE" as UserRole, "t9")).toThrow();
  });
});

describe("captureLast4", () => {
  it("returns the last four characters", () => {
    expect(captureLast4("sk-abcdef1234")).toBe("1234");
  });
  it("trims surrounding whitespace first", () => {
    expect(captureLast4("  abcd9999  ")).toBe("9999");
  });
  it("returns null for empty / whitespace-only values", () => {
    expect(captureLast4("")).toBeNull();
    expect(captureLast4("   ")).toBeNull();
  });
  it("returns the whole string when shorter than four", () => {
    expect(captureLast4("ab")).toBe("ab");
  });
});

describe("safeParseMetadata", () => {
  it("returns null for null input", () => {
    expect(safeParseMetadata(null)).toBeNull();
  });
  it("parses valid JSON", () => {
    expect(safeParseMetadata('{"bucket":"b","region":"r"}')).toEqual({ bucket: "b", region: "r" });
  });
  it("falls back to the raw string on invalid JSON", () => {
    expect(safeParseMetadata("not json")).toBe("not json");
  });
});

describe("toSafeSecret", () => {
  it("never leaks ciphertext into the returned DTO", () => {
    const dto = toSafeSecret(makeRow({ metadata: '{"k":1}' }) as never);
    expect(dto).not.toHaveProperty("ciphertext");
    expect(JSON.stringify(dto)).not.toContain("cipher:");
    expect(dto.last4).toBe("1234");
    expect(dto.metadata).toEqual({ k: 1 });
  });
});

describe("createSecret", () => {
  it("injects the caller's scope/tenant and stores ciphertext + last4 (not plaintext)", async () => {
    deps.findFirst.mockResolvedValue(null); // no label clash
    deps.create.mockResolvedValue(makeRow());
    await createSecret(PARTNER, {
      provider: SecretProvider.CUSTOM,
      label: "OpenAI",
      value: "sk-secret-1234",
    });
    const data = deps.create.mock.calls[0][0].data;
    expect(data.scope).toBe(SecretScope.PARTNER);
    expect(data.tenantId).toBe("t-partner");
    expect(data.ciphertext).toBe("cipher:sk-secret-1234");
    expect(data.last4).toBe("1234");
    expect(data.ciphertext).not.toBe("sk-secret-1234"); // stored encrypted, not raw
  });

  it("rejects a blank label or value (400)", async () => {
    await expect(
      createSecret(PLATFORM, { provider: SecretProvider.CUSTOM, label: "  ", value: "x" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      createSecret(PLATFORM, { provider: SecretProvider.CUSTOM, label: "L", value: "  " }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a duplicate active label in the same scope (409)", async () => {
    deps.findFirst.mockResolvedValue({ id: "existing" });
    await expect(
      createSecret(PLATFORM, { provider: SecretProvider.CUSTOM, label: "OpenAI", value: "v" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(deps.create).not.toHaveBeenCalled();
  });
});

describe("scope isolation", () => {
  it("getSecret 404s when the id is outside the caller's scope/tenant", async () => {
    deps.findFirst.mockResolvedValue(null);
    await expect(getSecret(PARTNER, "sec-x")).rejects.toMatchObject({ statusCode: 404 });
    // The lookup must be filtered by the caller's scope + tenant.
    expect(deps.findFirst).toHaveBeenCalledWith({
      where: { id: "sec-x", scope: SecretScope.PARTNER, tenantId: "t-partner" },
    });
  });
});

describe("resolveSecretValue", () => {
  it("returns null for a missing id without touching the DB", async () => {
    expect(await resolveSecretValue(PLATFORM, null)).toBeNull();
    expect(deps.findFirst).not.toHaveBeenCalled();
  });

  it("decrypts an active, in-scope secret", async () => {
    deps.findFirst.mockResolvedValue({ ciphertext: "cipher:sk-live-999" });
    expect(await resolveSecretValue(PLATFORM, "sec-1")).toBe("sk-live-999");
    expect(deps.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: SecretStatus.ACTIVE, scope: SecretScope.PLATFORM }),
      }),
    );
  });

  it("returns null when nothing matches the scoped, active filter", async () => {
    deps.findFirst.mockResolvedValue(null);
    expect(await resolveSecretValue(PLATFORM, "sec-missing")).toBeNull();
  });
});

describe("rotateSecret", () => {
  it("re-encrypts, refreshes last4, and stamps lastRotatedAt", async () => {
    deps.findFirst.mockResolvedValue(makeRow()); // ownership check passes
    deps.update.mockResolvedValue(makeRow({ last4: "8888" }));
    await rotateSecret(PLATFORM, "sec-1", "sk-rotated-8888");
    const data = deps.update.mock.calls[0][0].data;
    expect(data.ciphertext).toBe("cipher:sk-rotated-8888");
    expect(data.last4).toBe("8888");
    expect(data.lastRotatedAt).toBeInstanceOf(Date);
  });

  it("rejects an empty new value (400)", async () => {
    deps.findFirst.mockResolvedValue(makeRow());
    await expect(rotateSecret(PLATFORM, "sec-1", "   ")).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.update).not.toHaveBeenCalled();
  });
});
