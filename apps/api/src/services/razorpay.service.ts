import crypto from "node:crypto";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// Razorpay top-up adapter — SDK-free (one REST call + an HMAC check), so it adds
// no dependency. Credentials come from env; nothing here is hard-coded. Until
// the keys are set the routes fail closed with 503 rather than pretending to
// take money.

/** Paisa charged per credit. ₹1/credit by default (INR pricing). */
function creditPricePaisa(): number {
  const v = Number(process.env.RAZORPAY_CREDIT_PRICE_PAISA ?? 100);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 100;
}

function credentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new ApiError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      503,
      "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
    );
  }
  return { keyId, keySecret };
}

export interface TopUpOrder {
  orderId: string;
  amountPaisa: number;
  currency: "INR";
  credits: number;
  keyId: string; // public key the browser checkout widget needs
}

/**
 * Create a Razorpay order for `credits` worth of top-up. The tenant + credit
 * count are stored in the order `notes`, so the webhook can credit the right
 * wallet without trusting anything the browser sends back.
 */
export async function createRazorpayOrder(args: {
  tenantId: string;
  credits: number;
}): Promise<TopUpOrder> {
  const { keyId, keySecret } = credentials();
  const amountPaisa = args.credits * creditPricePaisa();

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountPaisa,
      currency: "INR",
      notes: { tenantId: args.tenantId, credits: String(args.credits) },
    }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      `Razorpay order creation failed (${res.status}): ${detail}`,
    );
  }

  const order = (await res.json()) as { id: string };
  return { orderId: order.id, amountPaisa, currency: "INR", credits: args.credits, keyId };
}

/**
 * Verify a Razorpay webhook: HMAC-SHA256 of the RAW request body under the
 * webhook secret must equal the `X-Razorpay-Signature` header. Constant-time
 * compare. Returns false (never throws) so the caller can 401 uniformly.
 */
export function verifyRazorpayWebhook(
  rawBody: Buffer | undefined,
  signature: string | string[] | undefined,
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const sig = Array.isArray(signature) ? signature[0] : signature;
  if (!secret || !rawBody || !sig) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
