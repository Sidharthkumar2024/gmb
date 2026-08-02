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

function secretKey(override?: string): string {
  const key = override ?? process.env.STRIPE_SECRET_KEY;
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

export async function createStripeAmountCheckout(args: {
  amountCents: number;
  currency: string;
  productName: string;
  metadata: Record<string, string>;
  successPath: string;
  cancelPath: string;
}, secretOverride?: string) {
  const key = secretKey(secretOverride);
  const webUrl = process.env.WEB_URL ?? "http://localhost:3000";
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${webUrl}${args.successPath}`);
  form.set("cancel_url", `${webUrl}${args.cancelPath}`);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", args.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(args.amountCents));
  form.set("line_items[0][price_data][product_data][name]", args.productName);
  for (const [keyName, value] of Object.entries(args.metadata)) {
    form.set(`metadata[${keyName}]`, value);
    form.set(`payment_intent_data[metadata][${keyName}]`, value);
  }
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !body.url || !body.id) {
    throw new ApiError(ErrorCodes.INTERNAL_SERVER_ERROR, 502, body.error?.message ?? "Stripe checkout creation failed.");
  }
  return { sessionId: body.id, checkoutUrl: body.url, amountCents: args.amountCents, currency: args.currency.toLowerCase() };
}

/**
 * Create a Stripe Checkout Session for `credits`. tenantId + credits ride in the
 * session metadata so the webhook credits the right wallet without trusting the
 * browser. Success/cancel return to the billing page.
 */
export async function createStripeCheckout(
  args: {
    tenantId: string;
    credits: number;
  },
  secretOverride?: string,
): Promise<StripeCheckout> {
  const amountCents = args.credits * stripeCreditPriceCents();
  const session = await createStripeAmountCheckout({
    amountCents,
    currency: "usd",
    productName: `${args.credits} AI credits`,
    metadata: { tenantId: args.tenantId, credits: String(args.credits), kind: "topup" },
    successPath: "/gmb-billing?topup=success",
    cancelPath: "/gmb-billing?topup=cancelled",
  }, secretOverride);
  return { checkoutUrl: session.checkoutUrl, amountCents, currency: "usd", credits: args.credits };
}

export interface StripeWebhookResult {
  paymentId: string;
  tenantId: string;
  credits: number;
  amountMinor: number;
  currency: string;
  kind: "topup" | "partner_settlement";
  invoiceId?: string;
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
  secretOverride?: string,
): StripeWebhookResult | null {
  const secret = secretOverride ?? process.env.STRIPE_WEBHOOK_SECRET;
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
    const kind = obj?.metadata?.kind === "partner_settlement" ? "partner_settlement" : "topup";
    const credits = Number(obj?.metadata?.credits ?? 0);
    if (!obj?.id || !tenantId || (kind === "topup" && !(credits > 0))) return null;
    if (kind === "partner_settlement" && !obj?.metadata?.invoiceId) return null;
    return {
      paymentId: obj.id,
      tenantId,
      credits,
      amountMinor: Number(obj.amount_total ?? credits * stripeCreditPriceCents()),
      currency: (obj.currency ?? "usd").toUpperCase(),
      kind,
      ...(obj.metadata?.invoiceId ? { invoiceId: obj.metadata.invoiceId } : {}),
    };
  } catch {
    return null;
  }
}

/** Refund the PaymentIntent behind the stored Checkout Session id. */
export async function refundStripeCheckoutSession(
  checkoutSessionId: string,
  idempotencyKey: string,
  secretOverride?: string,
) {
  const key = secretKey(secretOverride);
  const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(checkoutSessionId)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const session = (await sessionRes.json().catch(() => ({}))) as {
    payment_intent?: string;
    error?: { message?: string };
  };
  if (!sessionRes.ok || !session.payment_intent) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 502, session.error?.message ?? "Stripe Checkout session has no refundable PaymentIntent.");
  }
  const form = new URLSearchParams({ payment_intent: session.payment_intent, reason: "requested_by_customer" });
  const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: form.toString(),
  });
  const refund = (await refundRes.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    error?: { message?: string };
  };
  if (!refundRes.ok || !refund.id) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 502, refund.error?.message ?? `Stripe refund failed (${refundRes.status}).`);
  }
  return { refundId: refund.id, status: refund.status ?? null };
}
