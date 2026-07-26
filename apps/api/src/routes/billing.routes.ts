import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { requireAuth, requireTenantScope, type RequestWithAuth } from "../middleware/auth";
import { grantCredits } from "../services/billing.service";
import { createRazorpayOrder, verifyRazorpayWebhook } from "../services/razorpay.service";

const router = Router();

const topUpSchema = z.object({
  credits: z.number().int().positive().max(1_000_000),
});

/**
 * Start a top-up: create a Razorpay order for `credits`. The browser opens
 * Razorpay checkout with the returned orderId + keyId; the wallet is credited by
 * the webhook (below) after payment, never by the browser.
 */
router.post(
  "/top-up",
  requireAuth,
  requireTenantScope,
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { credits } = topUpSchema.parse(req.body);
      const order = await createRazorpayOrder({ tenantId: req.tenantId!, credits });
      res.json({ success: true, data: order });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Razorpay webhook (public — Razorpay calls it, no user auth). The signature is
 * verified against the RAW body (captured in index.ts's json `verify`), then the
 * wallet is credited idempotently keyed on the payment id, so a redelivered
 * webhook can't double-credit. Tenant + credits are read from the order `notes`
 * we set at creation, not from anything the caller controls.
 */
router.post(
  "/webhook",
  async (req: RequestWithAuth & { rawBody?: Buffer }, res: Response, next: NextFunction) => {
    try {
      if (!verifyRazorpayWebhook(req.rawBody, req.headers["x-razorpay-signature"])) {
        throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Invalid webhook signature.");
      }

      const event = req.body as {
        event?: string;
        payload?: { payment?: { entity?: { id?: string; notes?: Record<string, string> } } };
      };

      // Ack captured payments by crediting the wallet. Other events are ignored
      // (still 200, so Razorpay doesn't retry them forever).
      if (event.event === "payment.captured") {
        const payment = event.payload?.payment?.entity;
        const tenantId = payment?.notes?.tenantId;
        const credits = Number(payment?.notes?.credits ?? 0);
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
  },
);

export default router;
