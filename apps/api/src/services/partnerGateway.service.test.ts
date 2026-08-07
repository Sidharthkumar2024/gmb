import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretStatus } from "@nexaflow/db";

// Partner-owned gateway credentials (PARTNER-scope Secret Vault). Invariants:
//  - a provider is only "ready" to route LIVE charges once BOTH its API key and
//    its webhook secret are stored (a key alone must not enable live routing)
//  - keys can't be saved without the required fields; a provider can't be made
//    active before its keys exist
//  - getActivePartnerGatewayCreds returns decrypted creds only for a ready,
//    active provider — otherwise null (so charge routing fails closed)

const deps = vi.hoisted(() => ({
  listSecrets: vi.fn(),
  createSecret: vi.fn(),
  updateSecret: vi.fn(),
  rotateSecret: vi.fn(),
  revealSecret: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return { ...actual, prisma: {} };
});
vi.mock("./secretVault.service", () => ({
  listSecrets: deps.listSecrets,
  createSecret: deps.createSecret,
  updateSecret: deps.updateSecret,
  rotateSecret: deps.rotateSecret,
  revealSecret: deps.revealSecret,
}));

import {
  getPartnerGatewayStatus,
  savePartnerGatewayKeys,
  setPartnerActiveProvider,
  disconnectPartnerGateway,
  getActivePartnerGatewayCreds,
} from "./partnerGateway.service";

const P = "partner-1";
const keyEntry = (over = {}) => ({
  id: "k",
  label: "Partner Razorpay secret",
  status: SecretStatus.ACTIVE,
  last4: "1234",
  metadata: { keyId: "rzp_pk_live", keyIdLast4: "live" },
  ...over,
});
const webhookEntry = (over = {}) => ({
  id: "w",
  label: "Partner Razorpay webhook",
  status: SecretStatus.ACTIVE,
  last4: "9999",
  metadata: null,
  ...over,
});
const configEntry = (activeProvider: string | null) => ({
  id: "c",
  label: "Partner gateway config",
  status: SecretStatus.ACTIVE,
  last4: null,
  metadata: activeProvider ? { activeProvider } : {},
});

afterEach(() => vi.clearAllMocks());

describe("getPartnerGatewayStatus — live-routing readiness", () => {
  it("marks a provider ready only when BOTH key and webhook are present", async () => {
    deps.listSecrets.mockResolvedValue([keyEntry(), webhookEntry(), configEntry("razorpay")]);
    const status = await getPartnerGatewayStatus(P);
    const rzp = status.providers.find((p) => p.provider === "razorpay")!;
    expect(rzp).toMatchObject({ configured: true, webhookConfigured: true, ready: true, active: true });
    expect(rzp.last4).toBe("1234");
    expect(rzp.keyIdLast4).toBe("live");
    expect(status.liveRoutingEnabled).toBe(true);
  });

  it("does NOT enable live routing when only the API key is stored (no webhook)", async () => {
    deps.listSecrets.mockResolvedValue([keyEntry(), configEntry("razorpay")]);
    const status = await getPartnerGatewayStatus(P);
    const rzp = status.providers.find((p) => p.provider === "razorpay")!;
    expect(rzp).toMatchObject({ configured: true, webhookConfigured: false, ready: false });
    expect(status.liveRoutingEnabled).toBe(false);
  });
});

describe("savePartnerGatewayKeys — validation", () => {
  it("requires a secret", async () => {
    await expect(
      savePartnerGatewayKeys(P, { provider: "razorpay", secret: "  ", keyId: "pk" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.createSecret).not.toHaveBeenCalled();
  });

  it("requires a Razorpay key id for Razorpay", async () => {
    await expect(
      savePartnerGatewayKeys(P, { provider: "razorpay", secret: "sk_live" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("stores the key with a masked key-id and creates when none exists", async () => {
    deps.listSecrets.mockResolvedValue([]); // nothing stored → create path
    deps.createSecret.mockResolvedValue({ id: "new" });
    await savePartnerGatewayKeys(P, { provider: "razorpay", secret: "sk_live", keyId: "rzp_pk_ABCD" });
    const call = deps.createSecret.mock.calls[0][1];
    expect(call.label).toBe("Partner Razorpay secret");
    expect(call.value).toBe("sk_live");
    expect(call.metadata).toEqual({ keyId: "rzp_pk_ABCD", keyIdLast4: "ABCD" });
  });
});

describe("setPartnerActiveProvider — refuses an unconfigured provider", () => {
  it("throws 400 when the provider has no stored key", async () => {
    deps.listSecrets.mockResolvedValue([]); // no key for stripe
    await expect(setPartnerActiveProvider(P, "stripe")).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.createSecret).not.toHaveBeenCalled();
  });

  it("persists the active choice when the key exists", async () => {
    deps.listSecrets.mockResolvedValue([keyEntry()]); // key present, no config yet
    deps.createSecret.mockResolvedValue({ id: "cfg" });
    await setPartnerActiveProvider(P, "razorpay");
    expect(deps.createSecret).toHaveBeenCalledTimes(1);
    expect(deps.createSecret.mock.calls[0][1].metadata).toEqual({ activeProvider: "razorpay" });
  });
});

describe("getActivePartnerGatewayCreds — fails closed", () => {
  it("returns null when no active provider is set", async () => {
    deps.listSecrets.mockResolvedValue([keyEntry(), webhookEntry(), configEntry(null)]);
    expect(await getActivePartnerGatewayCreds(P)).toBeNull();
    expect(deps.revealSecret).not.toHaveBeenCalled();
  });

  it("returns decrypted creds for a ready, active provider", async () => {
    deps.listSecrets.mockResolvedValue([keyEntry(), webhookEntry(), configEntry("razorpay")]);
    deps.revealSecret
      .mockResolvedValueOnce({ value: "sk_live_decrypted" }) // key
      .mockResolvedValueOnce({ value: "whsec_decrypted" }); // webhook
    const creds = await getActivePartnerGatewayCreds(P);
    expect(creds).toEqual({
      provider: "razorpay",
      apiSecret: "sk_live_decrypted",
      keyId: "rzp_pk_live",
      webhookSecret: "whsec_decrypted",
    });
  });
});

describe("disconnectPartnerGateway", () => {
  it("disables the key + webhook and clears the active choice if it was active", async () => {
    deps.listSecrets.mockResolvedValue([keyEntry(), webhookEntry(), configEntry("razorpay")]);
    await disconnectPartnerGateway(P, "razorpay");
    // key + webhook disabled
    const disabled = deps.updateSecret.mock.calls.filter(
      (c) => c[2]?.status === SecretStatus.DISABLED,
    );
    expect(disabled.map((c) => c[1]).sort()).toEqual(["k", "w"]);
    // active config cleared
    const cleared = deps.updateSecret.mock.calls.find((c) => c[1] === "c");
    expect(cleared?.[2]).toEqual({ metadata: {} });
  });
});
