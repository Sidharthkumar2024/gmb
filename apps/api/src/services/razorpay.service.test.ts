import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { createRazorpayOrder, verifyRazorpayWebhook } from "./razorpay.service";

// Webhook signature verification is the trust boundary for crediting wallets:
// only a body whose HMAC-SHA256 matches the header (constant-time) is accepted,
// and a missing secret/body/signature fails closed (false, never throws).

const SECRET = "whsec_razorpay_test";
const sign = (body: Buffer | string) =>
  crypto.createHmac("sha256", SECRET).update(body).digest("hex");

afterEach(() => vi.unstubAllEnvs());

describe("verifyRazorpayWebhook", () => {
  const body = Buffer.from(JSON.stringify({ event: "payment.captured", id: "pay_1" }));

  it("accepts a correctly-signed body", () => {
    expect(verifyRazorpayWebhook(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(verifyRazorpayWebhook(body, "deadbeef", SECRET)).toBe(false);
  });

  it("rejects a tampered body (signature no longer matches)", () => {
    const sig = sign(body);
    const tampered = Buffer.from(JSON.stringify({ event: "payment.captured", id: "pay_HACKED" }));
    expect(verifyRazorpayWebhook(tampered, sig, SECRET)).toBe(false);
  });

  it("fails closed on a missing secret, body, or signature", () => {
    expect(verifyRazorpayWebhook(body, sign(body), "")).toBe(false);
    expect(verifyRazorpayWebhook(undefined, sign(body), SECRET)).toBe(false);
    expect(verifyRazorpayWebhook(body, undefined, SECRET)).toBe(false);
  });

  it("uses the first value when the signature header is an array", () => {
    expect(verifyRazorpayWebhook(body, [sign(body), "other"], SECRET)).toBe(true);
  });

  it("reads the secret from env when no override is given", () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", SECRET);
    expect(verifyRazorpayWebhook(body, sign(body))).toBe(true);
  });
});

describe("createRazorpayOrder", () => {
  it("fails closed with 503 when no credentials are configured", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    await expect(createRazorpayOrder({ tenantId: "t1", credits: 100 })).rejects.toMatchObject({ statusCode: 503 });
  });
});
