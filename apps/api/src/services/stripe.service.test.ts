import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { stripeConfigured, stripeCreditPriceCents, verifyStripeWebhook } from "./stripe.service";

// Stripe webhook verification (t=<ts>,v1=<hmac(ts.body)>): the signature must
// match, the timestamp must be within a 5-minute replay window, and credits
// are returned ONLY for a completed AND settled ("paid") checkout — an
// unsettled session must not credit a wallet.

const SECRET = "whsec_stripe_test";
const nowTs = () => Math.floor(Date.now() / 1000);

function signed(bodyObj: unknown, ts: number = nowTs()) {
  const body = Buffer.from(JSON.stringify(bodyObj));
  const v1 = crypto.createHmac("sha256", SECRET).update(`${ts}.${body.toString("utf8")}`).digest("hex");
  return { body, header: `t=${ts},v1=${v1}` };
}

const paidEvent = {
  type: "checkout.session.completed",
  data: { object: { id: "cs_1", payment_status: "paid", amount_total: 500, currency: "usd", metadata: { tenantId: "t1", credits: "500" } } },
};

afterEach(() => vi.unstubAllEnvs());

describe("stripeCreditPriceCents", () => {
  it("defaults to 1 and falls back on non-positive/non-numeric env", () => {
    vi.stubEnv("STRIPE_CREDIT_PRICE_CENTS", ""); expect(stripeCreditPriceCents()).toBe(1);
    vi.stubEnv("STRIPE_CREDIT_PRICE_CENTS", "5"); expect(stripeCreditPriceCents()).toBe(5);
    vi.stubEnv("STRIPE_CREDIT_PRICE_CENTS", "-3"); expect(stripeCreditPriceCents()).toBe(1);
    vi.stubEnv("STRIPE_CREDIT_PRICE_CENTS", "abc"); expect(stripeCreditPriceCents()).toBe(1);
  });
});

describe("stripeConfigured", () => {
  it("is true only for a real (non-placeholder) secret key", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123"); expect(stripeConfigured()).toBe(true);
    vi.stubEnv("STRIPE_SECRET_KEY", "your_key"); expect(stripeConfigured()).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", ""); expect(stripeConfigured()).toBe(false);
  });
});

describe("verifyStripeWebhook", () => {
  it("returns the credited event data for a valid, paid, completed checkout", () => {
    const { body, header } = signed(paidEvent);
    expect(verifyStripeWebhook(body, header, SECRET)).toEqual({
      paymentId: "cs_1",
      tenantId: "t1",
      credits: 500,
      amountMinor: 500,
      currency: "USD",
      kind: "topup",
    });
  });

  it("returns null on a wrong signature, missing secret/body/header, or malformed header", () => {
    const { body, header } = signed(paidEvent);
    expect(verifyStripeWebhook(body, header, "wrong-secret")).toBeNull();
    expect(verifyStripeWebhook(undefined, header, SECRET)).toBeNull();
    expect(verifyStripeWebhook(body, undefined, SECRET)).toBeNull();
    expect(verifyStripeWebhook(body, "garbage-no-parts", SECRET)).toBeNull();
  });

  it("rejects a stale timestamp outside the 5-minute replay window", () => {
    const { body, header } = signed(paidEvent, nowTs() - 600);
    expect(verifyStripeWebhook(body, header, SECRET)).toBeNull();
  });

  it("does not credit an unsettled session (payment_status !== 'paid')", () => {
    const unpaid = { ...paidEvent, data: { object: { ...paidEvent.data.object, payment_status: "unpaid" } } };
    const { body, header } = signed(unpaid);
    expect(verifyStripeWebhook(body, header, SECRET)).toBeNull();
  });

  it("ignores non-completion event types even when correctly signed", () => {
    const other = { ...paidEvent, type: "payment_intent.created" };
    const { body, header } = signed(other);
    expect(verifyStripeWebhook(body, header, SECRET)).toBeNull();
  });

  it("returns null when tenantId or credits metadata is missing", () => {
    const noMeta = { ...paidEvent, data: { object: { ...paidEvent.data.object, metadata: {} } } };
    const { body, header } = signed(noMeta);
    expect(verifyStripeWebhook(body, header, SECRET)).toBeNull();
  });
});
