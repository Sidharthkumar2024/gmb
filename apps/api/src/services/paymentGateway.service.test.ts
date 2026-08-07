import { afterEach, describe, expect, it, vi } from "vitest";

// Payment-gateway abstraction — backs the admin Gateways screen
// (getGatewayStatus / setActiveProvider) and the customer Billing/top-up flow
// (getCustomerTopupInfo / createTopUpOrder). Invariants under test:
//  - an admin cannot activate a provider whose keys aren't set (else top-up 503s)
//  - the customer page only offers top-up when the active provider is configured
//  - a top-up routes to the PARTNER's account when the tenant is partner-routed,
//    otherwise to the platform's active provider

const deps = vi.hoisted(() => ({
  listSecrets: vi.fn(),
  createSecret: vi.fn(),
  updateSecret: vi.fn(),
  stripeConfigured: vi.fn(),
  stripeCreditPriceCents: vi.fn(),
  createStripeCheckout: vi.fn(),
  createRazorpayOrder: vi.fn(),
  resolvePartnerGatewayForTenant: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return { ...actual, prisma: {} };
});
vi.mock("./secretVault.service", () => ({
  listSecrets: deps.listSecrets,
  createSecret: deps.createSecret,
  updateSecret: deps.updateSecret,
}));
vi.mock("./stripe.service", () => ({
  stripeConfigured: deps.stripeConfigured,
  stripeCreditPriceCents: deps.stripeCreditPriceCents,
  createStripeCheckout: deps.createStripeCheckout,
}));
vi.mock("./razorpay.service", () => ({ createRazorpayOrder: deps.createRazorpayOrder }));
vi.mock("./partnerCharge.service", () => ({
  resolvePartnerGatewayForTenant: deps.resolvePartnerGatewayForTenant,
}));

import {
  getActiveProvider,
  getCustomerTopupInfo,
  getGatewayStatus,
  setActiveProvider,
  createTopUpOrder,
  razorpayConfigured,
} from "./paymentGateway.service";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function withRazorpayEnv() {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_x");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "secret_x");
}

describe("razorpayConfigured", () => {
  it("is true only when both env keys are present", () => {
    withRazorpayEnv();
    expect(razorpayConfigured()).toBe(true);
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    expect(razorpayConfigured()).toBe(false);
  });
});

describe("getActiveProvider", () => {
  it("honours the stored admin choice", async () => {
    deps.listSecrets.mockResolvedValue([
      { id: "c", label: "Payment gateway config", metadata: { activeProvider: "stripe" } },
    ]);
    expect(await getActiveProvider()).toBe("stripe");
  });

  it("falls back to the configured env, preferring Razorpay, when no choice is stored", async () => {
    withRazorpayEnv();
    deps.stripeConfigured.mockReturnValue(true);
    deps.listSecrets.mockResolvedValue([]); // no stored choice
    expect(await getActiveProvider()).toBe("razorpay");
  });
});

describe("getCustomerTopupInfo — what the billing page shows", () => {
  it("offers top-up with a price label when the active provider is configured", async () => {
    withRazorpayEnv();
    vi.stubEnv("RAZORPAY_CREDIT_PRICE_PAISA", "150");
    deps.listSecrets.mockResolvedValue([]);
    deps.stripeConfigured.mockReturnValue(false);

    const info = await getCustomerTopupInfo();
    expect(info).toEqual({ available: true, provider: "razorpay", priceLabel: "₹1.50 / credit" });
  });

  it("hides top-up when the active provider has no keys (no broken checkout)", async () => {
    // no env keys at all → razorpay is the default but not configured
    deps.listSecrets.mockResolvedValue([]);
    deps.stripeConfigured.mockReturnValue(false);

    const info = await getCustomerTopupInfo();
    expect(info).toEqual({ available: false, provider: null, priceLabel: null });
  });
});

describe("getGatewayStatus — the admin Gateways screen", () => {
  it("reports per-provider configured/active flags", async () => {
    withRazorpayEnv();
    deps.stripeConfigured.mockReturnValue(false);
    deps.stripeCreditPriceCents.mockReturnValue(50);
    deps.listSecrets.mockResolvedValue([]); // defaults to razorpay

    const status = await getGatewayStatus();
    expect(status.activeProvider).toBe("razorpay");
    const rzp = status.providers.find((p) => p.provider === "razorpay")!;
    const stripe = status.providers.find((p) => p.provider === "stripe")!;
    expect(rzp).toMatchObject({ configured: true, active: true });
    expect(stripe).toMatchObject({ configured: false, active: false });
  });
});

describe("setActiveProvider — guard against activating an unconfigured gateway", () => {
  it("rejects a provider whose keys aren't set (400)", async () => {
    deps.stripeConfigured.mockReturnValue(false);
    await expect(setActiveProvider("stripe")).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.createSecret).not.toHaveBeenCalled();
    expect(deps.updateSecret).not.toHaveBeenCalled();
  });

  it("persists the choice when the provider is configured", async () => {
    withRazorpayEnv();
    deps.stripeConfigured.mockReturnValue(false);
    deps.stripeCreditPriceCents.mockReturnValue(50);
    deps.listSecrets.mockResolvedValue([]); // no existing config entry → create
    deps.createSecret.mockResolvedValue({ id: "new" });

    await setActiveProvider("razorpay", "admin-1");
    expect(deps.createSecret).toHaveBeenCalledTimes(1);
    expect(deps.createSecret.mock.calls[0][1].metadata).toEqual({ activeProvider: "razorpay" });
  });
});

describe("createTopUpOrder — routing", () => {
  it("routes to the PARTNER's own gateway account when the tenant is partner-routed", async () => {
    deps.resolvePartnerGatewayForTenant.mockResolvedValue({
      creds: { provider: "razorpay", keyId: "partner_pk", apiSecret: "partner_sk" },
    });
    deps.createRazorpayOrder.mockResolvedValue({
      orderId: "order_partner",
      amountPaisa: 15000,
      currency: "INR",
      keyId: "partner_pk",
    });

    const order = await createTopUpOrder({ tenantId: "t-cust", credits: 100 });
    expect(order.provider).toBe("razorpay");
    expect(order.razorpay?.orderId).toBe("order_partner");
    // the order was created on the partner's credentials, not the platform's
    expect(deps.createRazorpayOrder).toHaveBeenCalledWith(
      { tenantId: "t-cust", credits: 100 },
      { keyId: "partner_pk", keySecret: "partner_sk" },
    );
  });

  it("uses the platform's active provider when the tenant is not partner-routed", async () => {
    withRazorpayEnv();
    deps.resolvePartnerGatewayForTenant.mockResolvedValue(null);
    deps.listSecrets.mockResolvedValue([]); // platform default → razorpay
    deps.createRazorpayOrder.mockResolvedValue({
      orderId: "order_platform",
      amountPaisa: 10000,
      currency: "INR",
      keyId: "rzp_test_x",
    });

    const order = await createTopUpOrder({ tenantId: "t-direct", credits: 100 });
    expect(order.provider).toBe("razorpay");
    expect(order.razorpay?.orderId).toBe("order_platform");
    // platform path calls the single-arg form (no partner creds)
    expect(deps.createRazorpayOrder).toHaveBeenCalledWith({ tenantId: "t-direct", credits: 100 });
  });
});
