import crypto from "node:crypto";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// Stripe top-up adapter — SDK-free (one REST call + the documented signature
// check), so it adds no dependency, mirroring razorpay.service. Credentials come
// from env; until they're set the routes fail closed with 503 rather than
// pretending to take money.

/** Cents charged per credit. 1¢/credit by default (USD pricing). */
export function stripeCreditPriceCents(): number {
  const v = Number(process.env.STRIPE_CREDIT_PRICE_CENTS ?? 1);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 1;
}

function secretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith("your_")) {
    throw new ApiError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      503,
      "Stripe is not configured. Set STRIPE_SECRET_KEY.",
    );
  }
  return key;
}

export function stripeConfigured(): boolean {
  const key = process.env.STRIPE_SECRET_KEY;
  return Boolean(key && !key.startsWith("your_"));
}

export interface StripeCheckout {
  checkoutUrl: string;
  amountCents: number;
  currency: "usd";
  credits: number;
}

/**
 * Create a Stripe Checkout Session for `credits`. tenantId + credits ride in the
 * session metadata so the webhook credits the right wallet without trusting the
 * browser. Success/cancel return to the billing page.
 */
export async function createStripeCheckout(args: {
  tenantId: string;
  credits: number;
}): Promise<StripeCheckout> {
  const key = secretKey();
  const amountCents = args.credits * stripeCreditPriceCents();
  const webUrl = process.env.WEB_URL ?? "http://localhost:3000";

  // Stripe expects application/x-www-form-urlencoded with bracketed nesting.
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${webUrl}/gmb-billing?topup=success`);
  form.set("cancel_url", `${webUrl}/gmb-billing?topup=cancelled`);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(amountCents));
  form.set("line_items[0][price_data][product_data][name]", `${args.credits} AI credits`);
  form.set("metadata[tenantId]", args.tenantId);
  form.set("metadata[credits]", String(args.credits));
  // Mirror onto the PaymentIntent so it survives to the webhook event too.
  form.set("payment_intent_data[metadata][tenantId]", args.tenantId);
  form.set("payment_intent_data[metadata][credits]", String(args.credits));

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      `Stripe checkout creation failed (${res.status}): ${detail}`,
    );
  }
  const session = (await res.json()) as { url?: string };
  if (!session.url) {
    throw new ApiError(ErrorCodes.INTERNAL_SERVER_ERROR, 502, "Stripe returned no checkout URL.");
  }
  return { checkoutUrl: session.url, amountCents, currency: "usd", credits: args.credits };
}

export interface StripeWebhookResult {
  paymentId: string;
  tenantId: string;
  credits: number;
  amountMinor: number;
  currency: string;
}

/**
 * Verify a Stripe webhook per the documented scheme: the `Stripe-Signature`
 * header is `t=<ts>,v1=<sig>` where sig = HMAC-SHA256(`<ts>.<rawBody>`) under the
 * webhook signing secret. Constant-time compare. Returns the credited event's
 * data only for a completed checkout, else null (never throws).
 */
export function verifyStripeWebhook(
  rawBody: Buffer | undefined,
  signature: string | string[] | undefined,
): StripeWebhookResult | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sigHeader = Array.isArray(signature) ? signature[0] : signature;
  if (!secret || !rawBody || !sigHeader) return null;

  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => kv.split("=", 2) as [string, string]),
  );
  const ts = parts["t"];
  const v1 = parts["v1"];
  if (!ts || !v1) return null;

  // Reject events whose timestamp is outside a 5-minute window to blunt replay.
  // Idempotency (stripe:<sessionId>) already prevents double-credit; this is
  // defense-in-depth, matching Stripe's recommended tolerance.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
    return null;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${rawBody.toString("utf8")}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const event = JSON.parse(rawBody.toString("utf8")) as {
      type?: string;
      data?: {
        object?: {
          id?: string;
          payment_status?: string;
          amount_total?: number;
          currency?: string;
          metadata?: Record<string, string>;
        };
      };
    };
    if (event.type !== "checkout.session.completed") return null;
    const obj = event.data?.object;
    // Only credit a settled payment. checkout.session.completed can fire before
    // an async payment method actually settles; crediting then would grant
    // credits for a payment that may still fail.
    if (obj?.payment_status !== "paid") return null;
    const tenantId = obj?.metadata?.tenantId;
    const credits = Number(obj?.metadata?.credits ?? 0);
    if (!obj?.id || !tenantId || !(credits > 0)) return null;
    return {
      paymentId: obj.id,
      tenantId,
      credits,
      amountMinor: Number(obj.amount_total ?? credits * stripeCreditPriceCents()),
      currency: (obj.currency ?? "usd").toUpperCase(),
    };
  } catch {
    return null;
  }
}
