import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { requireAuth, requireTenantScope, type RequestWithAuth } from "../middleware/auth";
import { grantCredits } from "../services/billing.service";
import { verifyRazorpayWebhook, fetchRazorpayOrderNotes } from "../services/razorpay.service";
import { verifyStripeWebhook } from "../services/stripe.service";
import { createTopUpOrder } from "../services/paymentGateway.service";

const router = Router();

const topUpSchema = z.object({
  credits: z.number().int().positive().max(1_000_000),
});

/**
 * Start a top-up with whichever gateway is active. The response says which
 * provider and carries what that provider's browser step needs (Razorpay order +
 * keyId, or a Stripe Checkout URL). The wallet is credited by the webhook after
 * payment, never by the browser.
 */
router.post(
  "/top-up",
  requireAuth,
  requireTenantScope,
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

/**
 * Razorpay webhook (public — no user auth). The signature is verified against the
 * RAW body (captured in index.ts's json `verify`), then the wallet is credited
 * idempotently keyed on the payment id, so a redelivered webhook can't
 * double-credit. Tenant + credits come from the order `notes` we set, not from
 * anything the caller controls.
 */
async function razorpayWebhook(
  req: RequestWithAuth & { rawBody?: Buffer },
  res: Response,
  next: NextFunction,
) {
  try {
    if (!verifyRazorpayWebhook(req.rawBody, req.headers["x-razorpay-signature"])) {
      throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Invalid webhook signature.");
    }
    const event = req.body as {
      event?: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
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
      // path in case a future checkout also sets them.
      let tenantId = payment?.notes?.tenantId;
      let credits = Number(payment?.notes?.credits ?? 0);
      if ((!tenantId || !(credits > 0)) && payment?.order_id) {
        const orderNotes = await fetchRazorpayOrderNotes(payment.order_id);
        tenantId = orderNotes?.tenantId ?? tenantId;
        credits = Number(orderNotes?.credits ?? credits);
      }
      if (tenantId && credits > 0 && payment?.id) {
        await grantCredits(tenantId, credits, {
          reason: "Razorpay top-up",
          idempotencyKey: `razorpay:${payment.id}`,
        });
      }
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

router.post("/webhook/razorpay", razorpayWebhook);

/**
 * Stripe webhook (public). Verified via the Stripe-Signature scheme against the
 * raw body; on a completed checkout the wallet is credited idempotently keyed on
 * the session id. tenant + credits come from the session metadata we set.
 */
router.post(
  "/webhook/stripe",
  async (req: RequestWithAuth & { rawBody?: Buffer }, res: Response, next: NextFunction) => {
    try {
      const result = verifyStripeWebhook(req.rawBody, req.headers["stripe-signature"]);
      // A verified-but-uninteresting event (or a bad signature) both return null;
      // ack with 200 so Stripe stops retrying, but only credit on a real result.
      if (result) {
        await grantCredits(result.tenantId, result.credits, {
          reason: "Stripe top-up",
          idempotencyKey: `stripe:${result.paymentId}`,
        });
      }
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// Back-compat: the original Razorpay-only webhook path.
router.post("/webhook", razorpayWebhook);

export default router;
