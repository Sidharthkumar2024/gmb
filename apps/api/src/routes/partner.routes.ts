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
  getCustomerGoogleStatus,
} from "../services/partner.service";
import {
  listBasePlans,
  listPartnerPlans,
  createPartnerPlan,
  updatePartnerPlan,
  deletePartnerPlan,
} from "../services/partnerPlan.service";
import { listPartnerTransactions } from "../services/partnerBilling.service";
import { UserRole, PlanStatus } from "@nexaflow/db";

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

// --- Customer Google connections --------------------------------------------

router.get("/google", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getCustomerGoogleStatus(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

// --- Resale plans -----------------------------------------------------------
// A partner resells platform plans (the wholesale) to its customers at a retail
// price it sets. All scoped to req.tenantId (the partner tenant).

router.get("/base-plans", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listBasePlans() });
  } catch (err) {
    next(err);
  }
});

router.get("/plans", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listPartnerPlans(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

const planSchema = z.object({
  name: z.string().min(1).max(80),
  basePlanId: z.string().min(1),
  retailCents: z.number().int().min(0).max(100_000_000),
  status: z.nativeEnum(PlanStatus).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

router.post("/plans", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = planSchema.parse(req.body);
    res.status(201).json({ success: true, data: await createPartnerPlan(req.tenantId!, input) });
  } catch (err) {
    next(err);
  }
});

router.patch("/plans/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = planSchema.parse(req.body);
    res.json({ success: true, data: await updatePartnerPlan(req.tenantId!, req.params.id, input) });
  } catch (err) {
    next(err);
  }
});

router.delete("/plans/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deletePartnerPlan(req.tenantId!, req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- Transactions -----------------------------------------------------------
// A partner sees only its child customers' payments (scoped by parentTenantId).

router.get("/transactions", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listPartnerTransactions(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

export default router;
