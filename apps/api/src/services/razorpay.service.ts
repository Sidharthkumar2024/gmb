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

// Credentials come from env (the platform account) unless an override is passed
// — a partner-owned account, resolved from the partner's vault. Every entry
// point takes an optional override so a partner's customer's top-up is captured
// on the partner's own gateway rather than the platform's.
export interface RazorpayCreds {
  keyId: string;
  keySecret: string;
}

function credentials(override?: RazorpayCreds): RazorpayCreds {
  const keyId = override?.keyId ?? process.env.RAZORPAY_KEY_ID;
  const keySecret = override?.keySecret ?? process.env.RAZORPAY_KEY_SECRET;
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

export async function createRazorpayAmountOrder(args: {
  amountPaisa: number;
  notes: Record<string, string>;
}, override?: RazorpayCreds) {
  const { keyId, keySecret } = credentials(override);
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: args.amountPaisa, currency: "INR", notes: args.notes }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
  if (!res.ok || !body.id) {
    throw new ApiError(ErrorCodes.INTERNAL_SERVER_ERROR, 502, body.error?.description ?? "Razorpay order creation failed.");
  }
  return { orderId: body.id, amountPaisa: args.amountPaisa, currency: "INR" as const, keyId };
}

/**
 * Create a Razorpay order for `credits` worth of top-up. The tenant + credit
 * count are stored in the order `notes`, so the webhook can credit the right
 * wallet without trusting anything the browser sends back.
 */
export async function createRazorpayOrder(
  args: {
    tenantId: string;
    credits: number;
  },
  override?: RazorpayCreds,
): Promise<TopUpOrder> {
  const amountPaisa = args.credits * creditPricePaisa();
  const order = await createRazorpayAmountOrder({
    amountPaisa,
    notes: { tenantId: args.tenantId, credits: String(args.credits), kind: "topup" },
  }, override);
  return { ...order, credits: args.credits };
}

/**
 * Verify a Razorpay webhook: HMAC-SHA256 of the RAW request body under the
 * webhook secret must equal the `X-Razorpay-Signature` header. Constant-time
 * compare. Returns false (never throws) so the caller can 401 uniformly.
 */
export function verifyRazorpayWebhook(
  rawBody: Buffer | undefined,
  signature: string | string[] | undefined,
  secretOverride?: string,
): boolean {
  const secret = secretOverride ?? process.env.RAZORPAY_WEBHOOK_SECRET;
  const sig = Array.isArray(signature) ? signature[0] : signature;
  if (!secret || !rawBody || !sig) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Fetch an order's `notes` from Razorpay. Needed because a payment entity does
 * NOT inherit the order's notes — so the `payment.captured` webhook can't read
 * tenantId/credits off `payment.notes`; it must resolve them from the order we
 * created (server-side, so the browser can't tamper with which tenant is
 * credited). Returns null on any failure so the caller can skip crediting.
 */
export async function fetchRazorpayOrderNotes(
  orderId: string,
  override?: RazorpayCreds,
): Promise<Record<string, string> | null> {
  const { keyId, keySecret } = credentials(override);
  const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    },
  });
  if (!res.ok) return null;
  const order = (await res.json()) as { notes?: Record<string, string> };
  return order.notes ?? null;
}

/** Full gateway refund. The stable payment-derived idempotency key makes retries safe. */
export async function refundRazorpayPayment(
  paymentId: string,
  idempotencyKey: string,
  override?: RazorpayCreds,
) {
  const { keyId, keySecret } = credentials(override);
  const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      "X-Refund-Idempotency": idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
    },
    body: JSON.stringify({ speed: "normal", notes: { source: "adgrowly" } }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; status?: string; error?: { description?: string } };
  if (!res.ok || !body.id) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 502, body.error?.description ?? `Razorpay refund failed (${res.status}).`);
  }
  return { refundId: body.id, status: body.status ?? null };
}
