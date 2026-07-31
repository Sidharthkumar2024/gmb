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
  createPartnerCustomer,
  setPartnerCustomerStatus,
  setPartnerCustomerPlan,
  getPartnerCustomerDetail,
} from "../services/partner.service";
import {
  listBasePlans,
  listPartnerPlans,
  createPartnerPlan,
  updatePartnerPlan,
  deletePartnerPlan,
} from "../services/partnerPlan.service";
import {
  listPartnerTransactions,
  getPartnerStatement,
  refundPartnerPayment,
} from "../services/partnerBilling.service";
import { toCsv } from "../lib/csv";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import {
  listPartnerInvoices,
  getPartnerInvoice,
  finalisePartnerInvoice,
} from "../services/partnerInvoice.service";
import {
  getPartnerGatewayStatus,
  savePartnerGatewayKeys,
  setPartnerActiveProvider,
  disconnectPartnerGateway,
} from "../services/partnerGateway.service";
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

const createCustomerSchema = z.object({
  businessName: z.string().min(1).max(120),
  adminEmail: z.string().email().max(255),
  adminName: z.string().max(120).optional(),
  partnerPlanId: z.string().optional(),
});

router.post("/customers", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = createCustomerSchema.parse(req.body);
    const result = await createPartnerCustomer({
      partnerTenantId: req.tenantId!,
      createdByUserId: req.userId,
      ...input,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get("/customers/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getPartnerCustomerDetail(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/customers/:id/status", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { status } = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }).parse(req.body);
    res.json({ success: true, data: await setPartnerCustomerStatus(req.tenantId!, req.params.id, status) });
  } catch (err) {
    next(err);
  }
});

router.patch("/customers/:id/plan", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { partnerPlanId } = z
      .object({ partnerPlanId: z.string().nullable() })
      .parse(req.body);
    res.json({ success: true, data: await setPartnerCustomerPlan(req.tenantId!, req.params.id, partnerPlanId) });
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

// CSV export of the partner's customers' payments — for the reseller's books.
router.get("/transactions/export", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { payments } = await listPartnerTransactions(req.tenantId!);
    const csv = toCsv(
      ["Date", "Customer", "Gateway", "Credits", "Amount", "Currency", "Status", "Payment ID"],
      payments.map((p) => [
        p.createdAt.toISOString(),
        p.customerName,
        p.provider,
        p.credits,
        (p.amountMinor / 100).toFixed(2),
        p.currency,
        p.status,
        p.providerPaymentId,
      ]),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="transactions.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// Refund one of the partner's own customers' payments. Ownership-scoped to the
// partner's children; the partner issues the money-back from its own gateway.
router.post("/transactions/:id/refund", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const refunded = await refundPartnerPayment(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: refunded.tenantId,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Payment",
      resourceId: refunded.id,
      newValues: { status: "REFUNDED", credits: refunded.credits, by: "partner" },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: refunded });
  } catch (err) {
    next(err);
  }
});

// --- Monthly billing statement / invoices -----------------------------------

router.get("/statement", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getPartnerStatement(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

// Finalised past invoices (snapshots produced by the monthly job).
router.get("/invoices", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listPartnerInvoices(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

router.get("/invoices/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getPartnerInvoice(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

// Close the previous month now (ops/self-service; the monthly job does this
// automatically). Idempotent — re-closing returns the existing invoice.
router.post("/invoices/close-previous", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const invoice = await finalisePartnerInvoice(
      req.tenantId!,
      prev.getUTCFullYear(),
      prev.getUTCMonth() + 1,
    );
    res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    next(err);
  }
});

// --- Payment gateway (partner-owned keys, PARTNER-scope vault) ---------------

router.get("/gateway", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getPartnerGatewayStatus(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

const gatewayProviderSchema = z.enum(["razorpay", "stripe"]);
const saveKeysSchema = z.object({
  provider: gatewayProviderSchema,
  secret: z.string().min(1).max(500),
  keyId: z.string().max(200).optional(),
  webhookSecret: z.string().max(500).optional(),
});

router.put("/gateway/keys", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = saveKeysSchema.parse(req.body);
    res.json({ success: true, data: await savePartnerGatewayKeys(req.tenantId!, input, req.userId) });
  } catch (err) {
    next(err);
  }
});

router.put("/gateway/active", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { provider } = z.object({ provider: gatewayProviderSchema }).parse(req.body);
    res.json({ success: true, data: await setPartnerActiveProvider(req.tenantId!, provider, req.userId) });
  } catch (err) {
    next(err);
  }
});

router.delete("/gateway/:provider", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const provider = gatewayProviderSchema.parse(req.params.provider);
    res.json({ success: true, data: await disconnectPartnerGateway(req.tenantId!, provider) });
  } catch (err) {
    next(err);
  }
});

export default router;
