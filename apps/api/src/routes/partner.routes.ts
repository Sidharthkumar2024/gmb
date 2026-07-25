import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { requireAuth, type RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  getPartnerOverview,
  getBranding,
  saveBranding,
  listTeam,
  inviteStaff,
  setStaffRole,
  removeStaff,
} from "../services/partner.service";
import { UserRole } from "@nexaflow/db";

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

// --- White-label branding ---------------------------------------------------

router.get("/branding", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getBranding(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

const brandingSchema = z.object({
  brandName: z.string().max(80).nullable().optional(),
  customDomain: z.string().max(255).nullable().optional(),
  brandColorHex: z.string().max(7).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  hidePoweredBy: z.boolean().optional(),
});

router.put("/branding", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = brandingSchema.parse(req.body);
    res.json({ success: true, data: await saveBranding(req.tenantId!, { ...input, updatedByUserId: req.userId }) });
  } catch (err) {
    next(err);
  }
});

// --- Team -------------------------------------------------------------------

const staffRoleSchema = z.enum([UserRole.WHITE_LABEL_ADMIN, UserRole.AGENT]);

router.get("/team", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listTeam(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

const inviteSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().max(120).optional(),
  role: staffRoleSchema,
});

router.post("/team/invite", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = inviteSchema.parse(req.body);
    const result = await inviteStaff({
      partnerTenantId: req.tenantId!,
      invitedByUserId: req.userId!,
      ...input,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.patch("/team/:id/role", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { role } = z.object({ role: staffRoleSchema }).parse(req.body);
    res.json({ success: true, data: await setStaffRole(req.tenantId!, req.userId!, req.params.id, role) });
  } catch (err) {
    next(err);
  }
});

router.delete("/team/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await removeStaff(req.tenantId!, req.userId!, req.params.id);
    res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    next(err);
  }
});

export default router;
