import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { requireAuth, requireTenantScope, requireVerifiedEmailForMutation, type RequestWithAuth } from "../middleware/auth";
import { grantCredits } from "../services/billing.service";
import { verifyRazorpayWebhook, fetchRazorpayOrderNotes } from "../services/razorpay.service";
import { verifyStripeWebhook } from "../services/stripe.service";
import { createTopUpOrder } from "../services/paymentGateway.service";
import { recordPayment } from "../services/payment.service";
import { markPartnerInvoicePaid } from "../services/partnerInvoice.service";
import { getPartnerGatewayById, isPartnerCustomer } from "../services/partnerCharge.service";

const router = Router();

const topUpSchema = z.object({
  credits: z.number().int().positive().max(1_000_000),
});

/**
 * Start a top-up. createTopUpOrder decides the gateway: a partner's customer is
 * routed to the partner's own account, everyone else to the platform's. The
 * response carries what that provider's browser step needs. The wallet is
 * credited by the webhook after payment, never by the browser.
 */
router.post(
  "/top-up",
  requireAuth,
  requireTenantScope,
  requireVerifiedEmailForMutation,
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { credits } = topUpSchema.parse(req.body);
      const order = await createTopUpOrder({ tenantId: req.tenantId!, credits });
      res.json({ success: true, data: order });
    } catch (err) {
      next(err);
    }
  },
);

// Optional per-partner credentials for a routed webhook. When absent, the
// platform env credentials are used (the default endpoints below).
interface WebhookCreds {
  webhookSecret?: string | null;
  razorpayApi?: { keyId?: string; keySecret: string };
  // When set (per-partner endpoint), the resolved tenant MUST be this partner's
  // customer before we credit — the partner controls its own webhook secret and
  // order notes, so without this it could name (and credit) any tenant.
  scopePartnerId?: string;
}

/**
 * A partner-routed webhook may only credit that partner's own customers. Returns
 * true when crediting is allowed (no partner scope = platform webhook = allowed).
 */
async function creditAllowed(creds: WebhookCreds | undefined, tenantId: string): Promise<boolean> {
  if (!creds?.scopePartnerId) return true;
  const ok = await isPartnerCustomer(creds.scopePartnerId, tenantId);
  if (!ok) {
    console.warn(
      `[billing] partner ${creds.scopePartnerId} webhook resolved non-customer tenant ${tenantId}; refusing to credit.`,
    );
  }
  return ok;
}

/**
 * Razorpay webhook (public — no user auth). The signature is verified against the
 * RAW body under the platform secret, or a partner's webhook secret for a routed
 * endpoint. The wallet is credited idempotently keyed on the payment id, so a
 * redelivered webhook can't double-credit. Tenant + credits come from the order
 * `notes` we set, not from anything the caller controls.
 */
async function handleRazorpay(
  req: RequestWithAuth & { rawBody?: Buffer },
  res: Response,
  next: NextFunction,
  creds?: WebhookCreds,
) {
  try {
    if (
      !verifyRazorpayWebhook(
        req.rawBody,
        req.headers["x-razorpay-signature"],
        creds?.webhookSecret ?? undefined,
      )
    ) {
      throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Invalid webhook signature.");
    }
    const event = req.body as {
      event?: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            amount?: number;
            currency?: string;
            notes?: Record<string, string>;
          };
        };
      };
    };
    if (event.event === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      // tenantId/credits live in the ORDER's notes — a Razorpay payment does NOT
      // inherit them, so payment.notes is normally empty. Resolve from the order
      // (server-side, untamperable) via order_id; keep payment.notes as a fast
      // path. For a partner-routed webhook, the order lives on the partner's
      // account, so the order fetch uses the partner's API keys.
      let tenantId = payment?.notes?.tenantId;
      let credits = Number(payment?.notes?.credits ?? 0);
      let orderNotes = payment?.notes;
      if ((!tenantId || !(credits > 0)) && payment?.order_id) {
        orderNotes = (await fetchRazorpayOrderNotes(
          payment.order_id,
          creds?.razorpayApi?.keyId
            ? { keyId: creds.razorpayApi.keyId, keySecret: creds.razorpayApi.keySecret }
            : undefined,
        )) ?? undefined;
        tenantId = orderNotes?.tenantId ?? tenantId;
        credits = Number(orderNotes?.credits ?? credits);
      }
      if (orderNotes?.kind === "partner_settlement" && orderNotes.invoiceId && tenantId && payment?.id && !creds?.scopePartnerId) {
        await markPartnerInvoicePaid({
          invoiceId: orderNotes.invoiceId,
          partnerTenantId: tenantId,
          provider: "RAZORPAY",
          providerPaymentId: payment.id,
        });
      } else if (tenantId && credits > 0 && payment?.id && (await creditAllowed(creds, tenantId))) {
        await grantCredits(tenantId, credits, {
          reason: "Razorpay top-up",
          idempotencyKey: `razorpay:${payment.id}`,
        });
        await recordPayment({
          tenantId,
          provider: "RAZORPAY",
          providerPaymentId: payment.id,
          credits,
          amountMinor: Number(payment.amount ?? 0),
          currency: (payment.currency ?? "INR").toUpperCase(),
        });
      }
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Stripe webhook (public). Verified via the Stripe-Signature scheme against the
 * raw body (platform secret, or a partner's for a routed endpoint). On a
 * completed checkout the wallet is credited idempotently keyed on the session id.
 */
async function handleStripe(
  req: RequestWithAuth & { rawBody?: Buffer },
  res: Response,
  next: NextFunction,
  creds?: WebhookCreds,
) {
  try {
    const result = verifyStripeWebhook(
      req.rawBody,
      req.headers["stripe-signature"],
      creds?.webhookSecret ?? undefined,
    );
    // A verified-but-uninteresting event (or a bad signature) both return null;
    // ack with 200 so Stripe stops retrying, but only credit on a real result.
    if (result?.kind === "partner_settlement" && result.invoiceId && !creds?.scopePartnerId) {
      await markPartnerInvoicePaid({
        invoiceId: result.invoiceId,
        partnerTenantId: result.tenantId,
        provider: "STRIPE",
        providerPaymentId: result.paymentId,
      });
    } else if (result && (await creditAllowed(creds, result.tenantId))) {
      await grantCredits(result.tenantId, result.credits, {
        reason: "Stripe top-up",
        idempotencyKey: `stripe:${result.paymentId}`,
      });
      await recordPayment({
        tenantId: result.tenantId,
        provider: "STRIPE",
        providerPaymentId: result.paymentId,
        credits: result.credits,
        amountMinor: result.amountMinor,
        currency: result.currency,
      });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// --- Platform webhooks (default env credentials) ----------------------------
router.post("/webhook/razorpay", (req, res, next) => handleRazorpay(req, res, next));
router.post("/webhook/stripe", (req, res, next) => handleStripe(req, res, next));
// Back-compat: the original Razorpay-only webhook path.
router.post("/webhook", (req, res, next) => handleRazorpay(req, res, next));

// --- Per-partner webhooks ---------------------------------------------------
// A partner points its own gateway's webhook at /webhook/<provider>/<partnerId>,
// so the inbound event self-identifies the partner. We verify with THAT
// partner's webhook secret and (for Razorpay) resolve the order with the
// partner's API keys. An unknown/unready partner id 404s.
async function loadPartnerCreds(
  partnerId: string,
  provider: "razorpay" | "stripe",
): Promise<WebhookCreds> {
  const creds = await getPartnerGatewayById(partnerId);
  if (!creds || creds.provider !== provider || !creds.webhookSecret) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Unknown gateway endpoint.");
  }
  return {
    webhookSecret: creds.webhookSecret,
    razorpayApi: provider === "razorpay" ? { keyId: creds.keyId, keySecret: creds.apiSecret } : undefined,
    scopePartnerId: partnerId,
  };
}

router.post("/webhook/razorpay/:partnerId", async (req: RequestWithAuth & { rawBody?: Buffer }, res, next) => {
  try {
    const creds = await loadPartnerCreds(req.params.partnerId, "razorpay");
    await handleRazorpay(req, res, next, creds);
  } catch (err) {
    next(err);
  }
});

router.post("/webhook/stripe/:partnerId", async (req: RequestWithAuth & { rawBody?: Buffer }, res, next) => {
  try {
    const creds = await loadPartnerCreds(req.params.partnerId, "stripe");
    await handleStripe(req, res, next, creds);
  } catch (err) {
    next(err);
  }
});

export default router;
