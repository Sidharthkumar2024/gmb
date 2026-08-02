import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderKey } from "@nexaflow/db";

// The billing-safety contract of the AI gateway: credits are reserved up front,
// a provider failure (or unusable output) RELEASES the hold and never bills, an
// unconfigured provider throws BEFORE reserving anything, and a ledger/settle
// failure still returns the caller's result (uncharged) rather than throwing.

const deps = vi.hoisted(() => ({
  create: vi.fn(), // Anthropic messages.create
  reserveAi: vi.fn(),
  settleAi: vi.fn(),
  releaseAi: vi.fn(),
  resolveProviderChain: vi.fn(),
  resolveSecretValue: vi.fn(),
  usageCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: deps.create };
  },
}));
vi.mock("./billing.service", () => ({
  reserveAi: deps.reserveAi,
  settleAi: deps.settleAi,
  releaseAi: deps.releaseAi,
}));
vi.mock("./aiProviderHub.service", () => ({ resolveProviderChain: deps.resolveProviderChain }));
vi.mock("./secretVault.service", () => ({ resolveSecretValue: deps.resolveSecretValue }));
vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return { ...actual, prisma: { aiUsage: { create: deps.usageCreate } } };
});

import { hasConfiguredAiClient, runTenantLlmJson } from "./ai.service";

const RESV = { id: "resv-1" };
const anthropicEntry = {
  id: "cfg-1",
  provider: AiProviderKey.ANTHROPIC,
  secretId: "sec-1",
  baseUrl: null,
  defaultModel: "claude-x",
  hasKey: true,
};
const okResponse = {
  content: [{ type: "text", text: 'here you go: {"title":"Hi","ok":true} thanks' }],
  usage: { input_tokens: 10, output_tokens: 20 },
};

function useRegistryClient() {
  deps.resolveProviderChain.mockResolvedValue([anthropicEntry]);
  deps.resolveSecretValue.mockResolvedValue("sk-ant-real");
  deps.reserveAi.mockResolvedValue(RESV);
}

beforeEach(() => {
  // These are always awaited-then-.catch()'d by the service, so they must
  // resolve even in the paths under test.
  deps.releaseAi.mockResolvedValue(undefined);
  deps.settleAi.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("hasConfiguredAiClient", () => {
  it("is true for a real key, false for absent or placeholder keys", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-real123");
    expect(hasConfiguredAiClient()).toBe(true);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(hasConfiguredAiClient()).toBe(false);
    vi.stubEnv("ANTHROPIC_API_KEY", "your_key_here");
    expect(hasConfiguredAiClient()).toBe(false);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-placeholder");
    expect(hasConfiguredAiClient()).toBe(false);
  });
});

describe("runTenantLlmJson happy path", () => {
  it("reserves, extracts JSON from prose, logs usage, and settles the hold", async () => {
    useRegistryClient();
    deps.create.mockResolvedValue(okResponse);
    deps.usageCreate.mockResolvedValue({ id: "usage-1" });

    const out = await runTenantLlmJson<{ title: string; ok: boolean }>({
      tenantId: "t1",
      feature: "caption",
      system: "sys",
      prompt: "write it",
    });

    expect(out).toEqual({ title: "Hi", ok: true }); // sliced out of the surrounding prose
    expect(deps.reserveAi).toHaveBeenCalledWith("t1", "caption");
    // cost = ceil((10*3/1e6 + 20*15/1e6)*100) = 1 cent
    expect(deps.usageCreate.mock.calls[0][0].data).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      costInCents: 1,
      model: "claude-x",
    });
    expect(deps.settleAi).toHaveBeenCalledWith(RESV, { aiUsageId: "usage-1" });
    expect(deps.releaseAi).not.toHaveBeenCalled();
  });
});

describe("runTenantLlmJson billing safety", () => {
  it("releases the reservation and never settles when the provider throws", async () => {
    useRegistryClient();
    deps.create.mockRejectedValue(new Error("provider 500"));
    await expect(
      runTenantLlmJson({ tenantId: "t1", feature: "f", system: "s", prompt: "p" }),
    ).rejects.toThrow("provider 500");
    expect(deps.releaseAi).toHaveBeenCalledWith(RESV);
    expect(deps.settleAi).not.toHaveBeenCalled();
    expect(deps.usageCreate).not.toHaveBeenCalled();
  });

  it("releases the reservation when the model returns non-JSON output", async () => {
    useRegistryClient();
    deps.create.mockResolvedValue({ content: [{ type: "text", text: "no json here" }], usage: { input_tokens: 1, output_tokens: 1 } });
    await expect(
      runTenantLlmJson({ tenantId: "t1", feature: "f", system: "s", prompt: "p" }),
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(deps.releaseAi).toHaveBeenCalledWith(RESV);
  });

  it("throws BEFORE reserving when no provider is configured", async () => {
    deps.resolveProviderChain.mockResolvedValue([]); // nothing in the registry
    vi.stubEnv("ANTHROPIC_API_KEY", ""); // and no env key
    await expect(
      runTenantLlmJson({ tenantId: "t1", feature: "f", system: "s", prompt: "p" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.reserveAi).not.toHaveBeenCalled();
  });

  it("still returns the result (uncharged) when settling fails", async () => {
    useRegistryClient();
    deps.create.mockResolvedValue(okResponse);
    deps.usageCreate.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await runTenantLlmJson<{ title: string }>({ tenantId: "t1", feature: "f", system: "s", prompt: "p" });
    expect(out).toMatchObject({ title: "Hi" });
    expect(deps.releaseAi).toHaveBeenCalledWith(RESV); // hold released, not stuck
    spy.mockRestore();
  });
});
