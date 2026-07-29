import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderKey, AiProviderKind, AiProviderStatus } from "@nexaflow/db";

// The scoped AI-provider registry: fallback ordering (default first, then
// priority, then oldest), scope isolation on every read/write, a referenced
// secret must live in the caller's own vault scope, and a config can only ever
// be the single default for its scope+kind.

const deps = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  delete: vi.fn(),
  secretFindFirst: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      aiProviderConfig: {
        findMany: deps.findMany,
        findFirst: deps.findFirst,
        create: deps.create,
        update: deps.update,
        updateMany: deps.updateMany,
        delete: deps.delete,
      },
      secretVaultEntry: { findFirst: deps.secretFindFirst },
      $transaction: deps.transaction,
    },
  };
});

import {
  createProvider,
  getProvider,
  orderProviderChain,
  resolveProviderChain,
  setDefaultProvider,
  toSafeProviderConfig,
} from "./aiProviderHub.service";

const CTX = { scope: "PLATFORM", tenantId: null } as never;

function cfg(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    scope: "PLATFORM",
    tenantId: null,
    provider: AiProviderKey.OPENAI,
    kind: AiProviderKind.TEXT,
    label: "OpenAI",
    secretId: null,
    defaultModel: "gpt",
    models: [],
    baseUrl: null,
    priority: 100,
    isDefault: false,
    status: AiProviderStatus.ACTIVE,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("orderProviderChain", () => {
  it("drops disabled configs, puts the default first, then priority, then oldest", () => {
    const disabled = cfg({ id: "disabled", status: AiProviderStatus.DISABLED, isDefault: true });
    const def = cfg({ id: "default", isDefault: true, priority: 500 });
    const hi = cfg({ id: "hi", priority: 10, createdAt: new Date("2026-02-01") });
    const loOld = cfg({ id: "loOld", priority: 50, createdAt: new Date("2026-01-01") });
    const loNew = cfg({ id: "loNew", priority: 50, createdAt: new Date("2026-03-01") });

    const chain = orderProviderChain([loNew, hi, def, disabled, loOld]);
    expect(chain.map((c) => c.id)).toEqual(["default", "hi", "loOld", "loNew"]);
  });
});

describe("toSafeProviderConfig", () => {
  it("derives hasKey from secretId and parses metadata", () => {
    const safe = toSafeProviderConfig(cfg({ secretId: "sec-9", metadata: '{"region":"us"}' }) as never);
    expect(safe.hasKey).toBe(true);
    expect(safe.metadata).toEqual({ region: "us" });
    expect(toSafeProviderConfig(cfg({ secretId: null }) as never).hasKey).toBe(false);
  });
});

describe("createProvider", () => {
  it("rejects a blank label (400)", async () => {
    await expect(createProvider(CTX, { provider: AiProviderKey.OPENAI, label: "  " })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a secret that isn't in the caller's vault scope (400)", async () => {
    deps.secretFindFirst.mockResolvedValue(null); // not owned
    await expect(
      createProvider(CTX, { provider: AiProviderKey.OPENAI, label: "L", secretId: "foreign" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("409s on a duplicate provider+kind+label in scope", async () => {
    deps.findFirst.mockResolvedValue({ id: "existing" });
    await expect(
      createProvider(CTX, { provider: AiProviderKey.OPENAI, label: "OpenAI" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("applies defaults and, for a new default, clears other defaults in scope+kind", async () => {
    deps.findFirst.mockResolvedValue(null); // no clash
    deps.create.mockResolvedValue(cfg({ id: "new", isDefault: true }));
    await createProvider(CTX, { provider: AiProviderKey.OPENAI, label: "Primary", isDefault: true });
    const data = deps.create.mock.calls[0][0].data;
    expect(data.priority).toBe(100); // default
    expect(data.kind).toBe(AiProviderKind.TEXT); // default kind
    expect(deps.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: AiProviderKind.TEXT, id: { not: "new" } }),
        data: { isDefault: false },
      }),
    );
  });
});

describe("getProvider scope isolation", () => {
  it("404s when the id is outside the caller's scope", async () => {
    deps.findFirst.mockResolvedValue(null);
    await expect(getProvider(CTX, "x")).rejects.toMatchObject({ statusCode: 404 });
    expect(deps.findFirst).toHaveBeenCalledWith({
      where: { id: "x", scope: "PLATFORM", tenantId: null },
    });
  });
});

describe("setDefaultProvider", () => {
  it("clears other defaults and promotes this one to default+ACTIVE in a transaction", async () => {
    deps.findFirst.mockResolvedValue(cfg({ id: "p1", kind: AiProviderKind.IMAGE }));
    deps.transaction.mockResolvedValue([{ count: 2 }, cfg({ id: "p1", isDefault: true })]);
    const out = await setDefaultProvider(CTX, "p1");
    expect(deps.transaction).toHaveBeenCalledOnce();
    expect(deps.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ kind: AiProviderKind.IMAGE, id: { not: "p1" } }) }),
    );
    expect(deps.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isDefault: true, status: AiProviderStatus.ACTIVE } }),
    );
    expect(out.isDefault).toBe(true);
  });
});

describe("resolveProviderChain", () => {
  it("returns the ordered chain scoped to kind + ACTIVE, with hasKey flags", async () => {
    deps.findMany.mockResolvedValue([
      cfg({ id: "b", priority: 20, secretId: null }),
      cfg({ id: "a", isDefault: true, priority: 99, secretId: "sec-1" }),
    ]);
    const chain = await resolveProviderChain(CTX, AiProviderKind.TEXT);
    expect(chain.map((c) => c.id)).toEqual(["a", "b"]); // default first
    expect(chain[0].hasKey).toBe(true);
    expect(chain[1].hasKey).toBe(false);
    expect(deps.findMany.mock.calls[0][0].where).toMatchObject({
      scope: "PLATFORM",
      kind: AiProviderKind.TEXT,
      status: AiProviderStatus.ACTIVE,
    });
  });
});
