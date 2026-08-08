import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireVerifiedEmailForMutation, type RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  getPartnerOverview,
  getBranding,
  saveBranding,
  verifyBrandingDomain,
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
  reorderPartnerPlans,
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
  createPartnerInvoiceCheckout,
} from "../services/partnerInvoice.service";
import {
  getPartnerGatewayStatus,
  savePartnerGatewayKeys,
  setPartnerActiveProvider,
  disconnectPartnerGateway,
} from "../services/partnerGateway.service";
import { prisma, UserRole, PlanStatus, SecretProvider, SecretScope } from "@nexaflow/db";
import {
  listSecrets,
  createSecret,
  updateSecret,
  rotateSecret,
  deleteSecret,
} from "../services/secretVault.service";
import {
  PARTNER_SMTP_VAULT_LABEL,
  SMTP_NO_AUTH_SENTINEL,
  resolveSmtpSettings,
  sendTestEmail,
} from "../services/email.service";
import {
  listPartnerEmailTemplates,
  upsertPartnerEmailTemplate,
} from "../services/emailTemplate.service";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// Partner (white-label reseller) portal API. Every route is a WHITE_LABEL_ADMIN
// acting within their own tenant, so req.tenantId is the partner tenant and its
// customers are that tenant's children. Scope is enforced by role + tenant, the
// same boundary the rest of the app uses.

const router = Router();
router.use(requireAuth, requireRole("WHITE_LABEL_ADMIN"), requireVerifiedEmailForMutation);

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
  senderName: z.string().max(120).nullable().optional(),
  senderEmail: z.string().email().max(254).nullable().optional(),
});

router.post("/branding/verify-domain", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await verifyBrandingDomain(req.tenantId!) });
  } catch (err) {
    next(err);
  }
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

router.post("/plans/reorder", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { orderedIds } = z.object({ orderedIds: z.array(z.string().cuid()).max(100) }).parse(req.body);
    res.json({ success: true, data: await reorderPartnerPlans(req.tenantId!, orderedIds) });
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

router.post("/invoices/:id/checkout", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await createPartnerInvoiceCheckout(req.tenantId!, req.params.id) });
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

// --- SMTP & transactional email -------------------------------------------
// Partner relay credentials live in the PARTNER vault scope. sendEmail()
// resolves these settings for the partner and every child customer before it
// falls back to platform SMTP, so the saved configuration is operational.

const partnerSecretContext = (tenantId: string) => ({
  scope: SecretScope.PARTNER,
  tenantId,
});

interface PartnerSmtpMeta {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string | null;
  fromEmail?: string;
  fromName?: string | null;
  hasPassword?: boolean;
}

async function findPartnerSmtpEntry(tenantId: string) {
  const entries = await listSecrets(partnerSecretContext(tenantId), {
    provider: SecretProvider.SMTP,
  });
  return entries.find((entry) => entry.label === PARTNER_SMTP_VAULT_LABEL) ?? null;
}

router.get("/smtp", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const entry = await findPartnerSmtpEntry(req.tenantId!);
    const meta = (entry?.metadata ?? {}) as PartnerSmtpMeta;
    const active = await resolveSmtpSettings(req.tenantId!);
    res.json({
      success: true,
      data: {
        partner: entry
          ? {
              host: meta.host ?? null,
              port: meta.port ?? 587,
              secure: meta.secure ?? (meta.port ?? 587) === 465,
              user: meta.user ?? null,
              fromEmail: meta.fromEmail ?? null,
              fromName: meta.fromName ?? null,
              passwordLast4: meta.hasPassword ? entry.last4 : null,
            }
          : null,
        fallback: entry || !active
          ? null
          : { source: active.source, host: active.host, fromEmail: active.fromEmail },
      },
    });
  } catch (err) {
    next(err);
  }
});

const partnerSmtpSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().optional(),
  user: z.string().max(255).optional(),
  password: z.string().max(500).optional(),
  fromEmail: z.string().email().max(255),
  fromName: z.string().max(120).optional(),
});

router.put("/smtp", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = partnerSmtpSchema.parse(req.body);
    const user = input.user?.trim() || null;
    const existing = await findPartnerSmtpEntry(req.tenantId!);
    const hasStoredPassword = Boolean(
      existing && (existing.metadata as PartnerSmtpMeta | null)?.hasPassword,
    );
    if (user && !input.password && !hasStoredPassword) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        "A password is required when an SMTP user is set.",
      );
    }

    const metadata: PartnerSmtpMeta = {
      host: input.host.trim(),
      port: input.port,
      secure: input.secure ?? input.port === 465,
      user,
      fromEmail: input.fromEmail.trim(),
      fromName: input.fromName?.trim() || null,
      hasPassword: input.password ? true : user ? hasStoredPassword : false,
    };
    const ctx = partnerSecretContext(req.tenantId!);
    let entryId: string;
    if (existing) {
      await updateSecret(ctx, existing.id, { metadata });
      if (input.password) {
        await rotateSecret(ctx, existing.id, input.password);
      } else if (!user && hasStoredPassword) {
        await rotateSecret(ctx, existing.id, SMTP_NO_AUTH_SENTINEL);
      }
      entryId = existing.id;
    } else {
      const created = await createSecret(ctx, {
        provider: SecretProvider.SMTP,
        label: PARTNER_SMTP_VAULT_LABEL,
        value: input.password || SMTP_NO_AUTH_SENTINEL,
        metadata,
        createdByUserId: req.userId,
      });
      entryId = created.id;
    }
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: existing ? "UPDATE" : "CREATE",
      resource: "PartnerSmtpConfig",
      resourceId: entryId,
      newValues: {
        host: metadata.host,
        port: metadata.port,
        fromEmail: metadata.fromEmail,
        passwordChanged: Boolean(input.password),
      },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { saved: true } });
  } catch (err) {
    next(err);
  }
});

router.delete("/smtp", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const existing = await findPartnerSmtpEntry(req.tenantId!);
    if (!existing) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "No partner SMTP settings saved.");
    await deleteSecret(partnerSecretContext(req.tenantId!), existing.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "PartnerSmtpConfig",
      resourceId: existing.id,
      oldValues: { host: (existing.metadata as PartnerSmtpMeta | null)?.host ?? null },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

router.post("/smtp/test", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { to } = z.object({ to: z.string().email() }).parse(req.body);
    res.json({ success: true, data: await sendTestEmail(to, req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

router.get("/email-templates", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listPartnerEmailTemplates(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

const partnerTemplateSchema = z.object({
  subject: z.string().max(300),
  body: z.string().max(20_000),
  useCustom: z.boolean(),
});

router.patch("/email-templates/:key", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = partnerTemplateSchema.parse(req.body);
    const template = await upsertPartnerEmailTemplate(req.tenantId!, req.params.key, {
      ...input,
      updatedByUserId: req.userId,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "PartnerEmailTemplate",
      resourceId: req.params.key,
      newValues: { useCustom: input.useCustom },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

// --- Audit & security -------------------------------------------------------

router.get("/audit", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = 50;
    const where = {
      OR: [
        { tenantId: req.tenantId! },
        { tenant: { parentTenantId: req.tenantId! } },
      ],
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { name: true, email: true } },
          tenant: { select: { name: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({
      success: true,
      data: {
        page,
        pageSize,
        total,
        items: items.map((item) => ({
          id: item.id,
          action: item.action,
          resource: item.resource,
          resourceId: item.resourceId,
          userName: item.user.name,
          userEmail: item.user.email,
          tenantName: item.tenant.name,
          ipAddress: item.ipAddress,
          createdAt: item.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/security", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const [user, activeSessions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.userId! },
        select: { email: true, emailVerified: true, lastLoginAt: true, updatedAt: true },
      }),
      prisma.refreshToken.count({
        where: { userId: req.userId!, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    res.json({
      success: true,
      data: {
        email: user?.email ?? null,
        emailVerified: user?.emailVerified ?? false,
        lastLoginAt: user?.lastLoginAt ?? null,
        passwordUpdatedAt: user?.updatedAt ?? null,
        activeSessions,
        twoFactorAvailable: false,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/security/revoke-sessions", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.refreshToken.updateMany({
      where: { userId: req.userId!, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "LOGOUT",
      resource: "RefreshToken",
      newValues: { revokedSessions: result.count },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { revokedSessions: result.count } });
  } catch (err) {
    next(err);
  }
});

export default router;
