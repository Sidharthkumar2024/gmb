import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { getPartnerOverview } from "../services/partner.service";

// Partner (white-label reseller) portal API. Every route is a WHITE_LABEL_ADMIN
// acting within their own tenant, so req.tenantId is the partner tenant and its
// customers are that tenant's children. Scope is enforced by role + tenant, the
// same boundary the rest of the app uses.

const router = Router();
router.use(requireAuth, requireRole("WHITE_LABEL_ADMIN"));

router.get("/overview", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getPartnerOverview(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

export default router;
