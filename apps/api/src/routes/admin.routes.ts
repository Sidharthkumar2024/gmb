import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  prisma,
  TenantStatus,
  AiProviderKey,
  AiProviderKind,
  AiProviderStatus,
  SecretProvider,
  SecretScope,
  PlanInterval,
  PlanStatus,
  TicketStatus,
  TicketPriority,
  TicketAuthor,
  WalletTransactionType,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { requireAuth, signAccessToken, type RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import {
  getStorageConfig,
  saveStorageConfig,
  deleteStorageConfig,
  type StorageProvider,
} from "../services/storage.service";
import { getSafeGoogleOAuthConfig, saveGoogleOAuthConfig } from "../services/googleOAuthConfig.service";
import {
  listProviders,
  createProvider,
  updateProvider,
  setDefaultProvider,
  deleteProvider,
  testAiProviderKey,
} from "../services/aiProviderHub.service";
import {
  listSecrets,
  createSecret,
  rotateSecret,
  updateSecret,
  deleteSecret,
  testSecret,
} from "../services/secretVault.service";
import { hasConfiguredAiClient } from "../services/ai.service";
import {
  SMTP_VAULT_LABEL,
  SMTP_NO_AUTH_SENTINEL,
  sendTestEmail,
  resolveSmtpSettings,
} from "../services/email.service";
import {
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  assignPlan,
} from "../services/plan.service";
import {
  listTickets,
  getTicket,
  replyToTicket,
  updateTicket,
} from "../services/supportTicket.service";
import { listEmailTemplates, upsertEmailTemplate } from "../services/emailTemplate.service";
import { getGatewayStatus, setActiveProvider } from "../services/paymentGateway.service";
import { listPayments, refundPayment } from "../services/payment.service";
import { toCsv } from "../lib/csv";
import { listInvoices, getInvoice } from "../services/invoice.service";
import {
  queueDepth,
  getGmbAutopilotQueue,
  getGmbAutoSyncQueue,
  getGmbReportScheduleQueue,
  getGmbPostPublisherQueue,
} from "../lib/queue";

// SuperAdmin API (Adgrowly GMB Admin design).
//
// Everything here is platform-wide, so the guard is role, not tenant scope —
// and every route sits behind SUPER_ADMIN. The router only exposes what the
// schema can actually answer: accounts, users, audit, health, Google API
// telemetry and AI provider config. Plans/invoices/payments have no models in
// this build and are deliberately absent rather than stubbed with fake data.
//
// Admin reads cross tenant boundaries by design; that is the role's purpose.
// Admin MUTATIONS are still audited with the acting admin's user id.

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN"));

// --- overview ---------------------------------------------------------------

router.get("/overview", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const since30d = new Date(Date.now() - 30 * 86400000);
    const [tenants, activeTenants, users, locations, reviews, posts, aiCalls30d, aiSpend30d] =
      await Promise.all([
        prisma.tenant.count(),
        prisma.tenant.count({ where: { status: TenantStatus.ACTIVE } }),
        prisma.user.count(),
        prisma.gmbLocation.count(),
        prisma.gmbReview.count(),
        prisma.gmbPost.count(),
        prisma.aiUsage.count({ where: { createdAt: { gte: since30d } } }),
        prisma.aiUsage.aggregate({
          where: { createdAt: { gte: since30d } },
          _sum: { costInCents: true },
        }),
      ]);

    res.json({
      success: true,
      data: {
        tenants: { total: tenants, active: activeTenants },
        users,
        locations,
        reviews,
        posts,
        ai30d: {
          calls: aiCalls30d,
          costInCents: aiSpend30d._sum.costInCents ?? 0,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// --- accounts (tenants) -----------------------------------------------------

router.get("/tenants", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const pageSize = 50;
    const page = Math.max(1, Number(req.query.page) || 1);
    const where = q ? { name: { contains: q, mode: "insensitive" as const } } : undefined;
    const [rows, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { users: true, gmbLocations: true, gmbReviews: true, children: true } },
          wallets: { select: { balanceCredits: true }, take: 1 },
          plan: { select: { id: true, name: true } },
          parentTenant: { select: { name: true } },
        },
      }),
      prisma.tenant.count({ where }),
    ]);
    res.json({
      success: true,
      data: {
        total,
        page,
        pageSize,
        items: rows.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        industry: t.industry,
        status: t.status,
        type: t.type, // WHITE_LABEL partner vs DIRECT customer
        parentName: t.parentTenant?.name ?? null, // the partner this tenant belongs to
        customerCount: t._count.children, // for a partner, how many customers
        users: t._count.users,
        locations: t._count.gmbLocations,
        reviews: t._count.gmbReviews,
        credits: t.wallets[0]?.balanceCredits ?? 0,
        planId: t.plan?.id ?? null,
        planName: t.plan?.name ?? null,
        createdAt: t.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Mint a short-lived impersonation access token so a super admin can view a
 * workspace as one of its users (support/debugging). The token carries the
 * TARGET's sub/tenant/role — that's what grants the access — plus actorUserId
 * for the UI banner and audit trail. It is NOT refreshable: the client keeps the
 * admin's own refresh token, so the impersonation lapses back to the admin when
 * it expires. Every impersonation is audit-logged.
 */
router.post("/tenants/:id/impersonate", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, status: true },
    });
    if (!tenant) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Workspace not found.");
    if (tenant.status !== "ACTIVE") {
      throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Reactivate the workspace before viewing as it.");
    }
    // Prefer a BUSINESS_ADMIN; fall back to the oldest active user.
    const target =
      (await prisma.user.findFirst({
        where: { tenantId: tenant.id, isActive: true, role: "BUSINESS_ADMIN" },
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, role: true },
      })) ??
      (await prisma.user.findFirst({
        where: { tenantId: tenant.id, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, role: true },
      }));
    if (!target) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "This workspace has no user to view as.");

    const accessToken = signAccessToken(
      {
        sub: target.id,
        tenantId: tenant.id,
        role: target.role,
        actorUserId: req.userId!,
        actorRole: "SUPER_ADMIN",
      },
      "30m",
    );

    await logAudit({
      tenantId: tenant.id,
      userId: req.userId!,
      action: "IMPERSONATE",
      resource: "Tenant",
      resourceId: tenant.id,
      newValues: { targetUserId: target.id, targetEmail: target.email },
      ...extractRequestMeta(req),
    });

    res.json({
      success: true,
      data: { accessToken, expiresIn: 1800, tenantName: tenant.name, targetEmail: target.email },
    });
  } catch (err) {
    next(err);
  }
});

const tenantStatusSchema = z.object({ status: z.nativeEnum(TenantStatus) });

router.patch("/tenants/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { status } = tenantStatusSchema.parse(req.body);
    const existing = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Workspace not found.");

    const updated = await prisma.tenant.update({
      where: { id: existing.id },
      data: { status },
    });

    // Suspending a workspace must end its live sessions — the requireAuth
    // check re-reads tenant status, but killing refresh tokens closes the
    // window to a single access-token lifetime.
    if (status !== TenantStatus.ACTIVE) {
      await prisma.refreshToken.updateMany({
        where: { user: { tenantId: existing.id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await logAudit({
      tenantId: existing.id,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Tenant",
      resourceId: existing.id,
      oldValues: { status: existing.status },
      newValues: { status },
      ...extractRequestMeta(req),
    });

    res.json({ success: true, data: { id: updated.id, status: updated.status } });
  } catch (err) {
    next(err);
  }
});

// --- users ------------------------------------------------------------------

router.get("/users", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const pageSize = 50;
    const page = Math.max(1, Number(req.query.page) || 1);
    const where = q ? { email: { contains: q, mode: "insensitive" as const } } : undefined;
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { tenant: { select: { name: true } } },
      }),
      prisma.user.count({ where }),
    ]);
    res.json({
      success: true,
      data: {
        total,
        page,
        pageSize,
        items: rows.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          isActive: u.isActive,
          emailVerified: u.emailVerified,
          tenantName: u.tenant.name,
          tenantId: u.tenantId,
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

const userPatchSchema = z.object({ isActive: z.boolean() });

router.patch("/users/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { isActive } = userPatchSchema.parse(req.body);
    if (req.params.id === req.userId) {
      // Locking yourself out of the admin is unrecoverable from the UI.
      throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "You cannot deactivate your own account.");
    }
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "User not found.");

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { isActive },
    });
    if (!isActive) {
      await prisma.refreshToken.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await logAudit({
      tenantId: existing.tenantId,
      userId: req.userId!,
      action: "UPDATE",
      resource: "User",
      resourceId: existing.id,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive },
      ...extractRequestMeta(req),
    });

    res.json({ success: true, data: { id: updated.id, isActive: updated.isActive } });
  } catch (err) {
    next(err);
  }
});

// --- audit ------------------------------------------------------------------

router.get("/audit", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        user: { select: { email: true } },
        tenant: { select: { name: true } },
      },
    });
    res.json({
      success: true,
      data: rows.map((a) => ({
        id: a.id,
        action: a.action,
        resource: a.resource,
        resourceId: a.resourceId,
        userEmail: a.user.email,
        tenantName: a.tenant.name,
        ipAddress: a.ipAddress,
        createdAt: a.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// --- health -----------------------------------------------------------------

router.get("/health", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    let database = "ok";
    let dbLatencyMs = 0;
    try {
      const t0 = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - t0;
    } catch (e) {
      database = (e as Error).message;
    }

    res.json({
      success: true,
      data: {
        database: { status: database === "ok" ? "ok" : "error", latencyMs: dbLatencyMs, detail: database === "ok" ? null : database },
        workers: {
          enabled: (process.env.ENABLE_WORKERS ?? "false").toLowerCase() === "true",
        },
        uptime: process.uptime(),
        node: process.version,
      },
    });
  } catch (err) {
    next(err);
  }
});

// --- Integrations status board (Providers & keys) ---------------------------
//
// A consolidated "is the platform wired up?" view of the integrations this
// build actually uses. NEVER returns secret values — only configured booleans
// and safe identifiers (masked client id, secret last4, host). Each row links
// to its dedicated config screen where one exists. Integrations the design
// mocks but this build doesn't wire (DataForSEO, Stripe) are deliberately
// omitted rather than shown as fake-connected.

router.get("/integrations", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const [oauth, smtp] = await Promise.all([getSafeGoogleOAuthConfig(), resolveSmtpSettings()]);
    const placesKey = process.env.GOOGLE_PLACES_API_KEY;

    res.json({
      success: true,
      data: {
        integrations: [
          {
            key: "google_business",
            name: "Google Business Profile",
            purpose: "Import locations, sync reviews & insights, publish updates",
            configured: Boolean(oauth.clientId) && oauth.enabled,
            detail: oauth.clientId ? `Client …${oauth.clientId.slice(-12)}` : "No OAuth client saved",
            manageHref: "/admin/google",
          },
          {
            key: "google_places",
            name: "Google Places API",
            purpose: "Rank-grid geocoding and citation lookups",
            configured: Boolean(placesKey && !placesKey.startsWith("your_")),
            detail:
              placesKey && !placesKey.startsWith("your_")
                ? "Key set in server env"
                : "GOOGLE_PLACES_API_KEY not set",
            manageHref: null,
          },
          {
            key: "anthropic",
            name: "Anthropic (AI)",
            purpose: "AI review replies, Q&A answers, advisor & descriptions",
            configured: hasConfiguredAiClient(),
            detail: hasConfiguredAiClient()
              ? `Env key · ${process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022"}`
              : "No env key — a registry key in AI models also works",
            manageHref: "/admin/ai",
          },
          {
            key: "smtp",
            name: "Email (SMTP)",
            purpose: "Verification, password reset & alert emails",
            configured: smtp !== null,
            detail: smtp ? `${smtp.host}:${smtp.port} · ${smtp.source} settings` : "Email is off",
            manageHref: "/admin/email",
          },
        ],
      },
    });
  } catch (err) {
    next(err);
  }
});

// --- Background queues -------------------------------------------------------
//
// Depth of the GMB background queues, read live from BullMQ/Redis. Reading
// counts needs Redis but NOT running workers, so this reports true backlog even
// when workers are disabled. If Redis is unreachable the whole screen degrades
// to redisOk:false rather than 500-ing — an admin monitor must not itself fail.

const GMB_QUEUES: Array<{ label: string; get: () => import("bullmq").Queue }> = [
  { label: "Autopilot sweeps", get: getGmbAutopilotQueue },
  { label: "Profile sync", get: getGmbAutoSyncQueue },
  { label: "Scheduled reports", get: getGmbReportScheduleQueue },
  { label: "Post publisher", get: getGmbPostPublisherQueue },
];

router.get("/queues", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const queues = await Promise.all(
      GMB_QUEUES.map(async ({ label, get }) => {
        try {
          const q = get();
          const d = await queueDepth(q);
          return { name: q.name, label, ...d, error: null as string | null };
        } catch (e) {
          return {
            name: label,
            label,
            waiting: 0,
            active: 0,
            delayed: 0,
            failed: 0,
            completed: 0,
            error: (e as Error).message,
          };
        }
      }),
    );
    const redisOk = queues.every((q) => q.error === null);
    const totals = queues.reduce(
      (acc, q) => ({
        waiting: acc.waiting + q.waiting,
        active: acc.active + q.active,
        failed: acc.failed + q.failed,
      }),
      { waiting: 0, active: 0, failed: 0 },
    );
    res.json({ success: true, data: { redisOk, totals, queues } });
  } catch (err) {
    next(err);
  }
});

// --- Google API telemetry ---------------------------------------------------

router.get("/google-apis", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const since7d = new Date(Date.now() - 7 * 86400000);
    const [oauth, byStatus, recent] = await Promise.all([
      getSafeGoogleOAuthConfig(),
      prisma.googleApiLog.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since7d } },
        _count: { _all: true },
      }),
      prisma.googleApiLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { tenant: { select: { name: true } } },
      }),
    ]);

    res.json({
      success: true,
      data: {
        oauth: {
          configured: Boolean(oauth.clientId) && oauth.enabled,
          clientIdMasked: oauth.clientId ? `…${oauth.clientId.slice(-12)}` : null,
          secretLast4: oauth.secretLast4 ?? null,
          redirectUri: oauth.redirectUri || null,
        },
        last7d: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
        recent: recent.map((r) => ({
          id: r.id,
          tenantName: r.tenant.name,
          operation: r.operation,
          status: r.status,
          statusCode: r.statusCode,
          durationMs: r.durationMs,
          createdAt: r.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// --- Google OAuth client configuration (settable from the console) ----------
// Lets a SUPER_ADMIN set the platform Google OAuth client id/secret/redirect
// without a redeploy. The secret is encrypted at rest and never returned; the
// service primes the sync cache so gmbGoogle.readClientConfig picks it up.

const googleConfigSchema = z.object({
  clientId: z.string().trim().max(300).optional(),
  // Optional on update — blank/omitted preserves the stored secret.
  clientSecret: z.string().trim().max(300).optional(),
  redirectUri: z.string().trim().max(500).optional(),
  scope: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
});

router.get("/google-config", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getSafeGoogleOAuthConfig() });
  } catch (err) {
    next(err);
  }
});

router.put("/google-config", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = googleConfigSchema.parse(req.body);
    const saved = await saveGoogleOAuthConfig(body, req.userId);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GoogleOAuthConfig",
      newValues: { enabled: saved.enabled, hasSecret: saved.hasSecret },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: saved });
  } catch (err) {
    next(err);
  }
});

// --- AI providers (platform scope) ------------------------------------------
//
// The registry + vault services are scope-aware; everything here pins the
// PLATFORM scope explicitly (SUPER_ADMIN's vault context). API keys go into
// the encrypted Secret Vault and only the last 4 characters ever come back.
//
// Honesty note: text generation walks ANTHROPIC entries (the only text SDK in
// this build) and image generation walks the IMAGE chain; other providers can
// be stored but are not yet callable — the UI says so.

const PLATFORM_CTX = { scope: SecretScope.PLATFORM, tenantId: null } as const;

/** Vault provider slot for an AI provider key; CUSTOM for the ones the vault enum lacks. */
function toSecretProvider(key: AiProviderKey): SecretProvider {
  switch (key) {
    case AiProviderKey.OPENAI:
      return SecretProvider.OPENAI;
    case AiProviderKey.ANTHROPIC:
      return SecretProvider.ANTHROPIC;
    case AiProviderKey.GEMINI:
      return SecretProvider.GEMINI;
    case AiProviderKey.REPLICATE:
      return SecretProvider.REPLICATE;
    default:
      return SecretProvider.CUSTOM;
  }
}

router.get("/ai", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const [providers, secrets] = await Promise.all([
      listProviders(PLATFORM_CTX, { includeDisabled: true }),
      listSecrets(PLATFORM_CTX, { includeDisabled: true }),
    ]);
    res.json({
      success: true,
      data: {
        env: {
          anthropicConfigured: hasConfiguredAiClient(),
          model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022",
        },
        providers,
        secrets,
      },
    });
  } catch (err) {
    next(err);
  }
});

const aiProviderCreateSchema = z.object({
  provider: z.nativeEnum(AiProviderKey),
  kind: z.nativeEnum(AiProviderKind).optional(),
  label: z.string().min(1).max(80),
  defaultModel: z.string().max(120).optional(),
  baseUrl: z.string().url().max(300).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  isDefault: z.boolean().optional(),
  apiKey: z.string().min(8).max(500).optional(),
});

router.post("/ai/providers", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = aiProviderCreateSchema.parse(req.body);

    // Key first, config second — and if the config fails (e.g. duplicate
    // label) the freshly created secret is removed rather than orphaned.
    let secretId: string | null = null;
    if (input.apiKey) {
      const secret = await createSecret(PLATFORM_CTX, {
        provider: toSecretProvider(input.provider),
        label: `${input.label.trim()} key`,
        value: input.apiKey,
        createdByUserId: req.userId,
      });
      secretId = secret.id;
    }

    let created;
    try {
      created = await createProvider(PLATFORM_CTX, {
        provider: input.provider,
        kind: input.kind,
        label: input.label,
        secretId,
        defaultModel: input.defaultModel ?? null,
        baseUrl: input.baseUrl ?? null,
        priority: input.priority,
        isDefault: input.isDefault,
        createdByUserId: req.userId,
      });
    } catch (err) {
      if (secretId) await deleteSecret(PLATFORM_CTX, secretId).catch(() => {});
      throw err;
    }

    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "AiProviderConfig",
      resourceId: created.id,
      newValues: { provider: created.provider, kind: created.kind, label: created.label, hasKey: created.hasKey },
      ...extractRequestMeta(req),
    });

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
});

const aiProviderPatchSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  defaultModel: z.string().max(120).nullable().optional(),
  baseUrl: z.string().url().max(300).nullable().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  status: z.nativeEnum(AiProviderStatus).optional(),
  apiKey: z.string().min(8).max(500).optional(),
});

router.patch("/ai/providers/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = aiProviderPatchSchema.parse(req.body);
    const before = await listProviders(PLATFORM_CTX, { includeDisabled: true }).then((rows) =>
      rows.find((r) => r.id === req.params.id),
    );
    if (!before) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Provider config not found.");

    // A new key rotates the existing vault entry in place, or creates one if
    // the config was previously running keyless.
    let secretId: string | undefined;
    if (input.apiKey) {
      if (before.secretId) {
        await rotateSecret(PLATFORM_CTX, before.secretId, input.apiKey);
      } else {
        const secret = await createSecret(PLATFORM_CTX, {
          provider: toSecretProvider(before.provider),
          label: `${(input.label ?? before.label).trim()} key`,
          value: input.apiKey,
          createdByUserId: req.userId,
        });
        secretId = secret.id;
      }
    }

    const updated = await updateProvider(PLATFORM_CTX, req.params.id, {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(secretId !== undefined ? { secretId } : {}),
    });

    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "AiProviderConfig",
      resourceId: updated.id,
      oldValues: { label: before.label, status: before.status, priority: before.priority, defaultModel: before.defaultModel },
      newValues: { label: updated.label, status: updated.status, priority: updated.priority, defaultModel: updated.defaultModel, keyRotated: Boolean(input.apiKey) },
      ...extractRequestMeta(req),
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/ai/providers/:id/default", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const updated = await setDefaultProvider(PLATFORM_CTX, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "AiProviderConfig",
      resourceId: updated.id,
      newValues: { isDefault: true, kind: updated.kind },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/ai/providers/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const rows = await listProviders(PLATFORM_CTX, { includeDisabled: true });
    const target = rows.find((r) => r.id === req.params.id);
    if (!target) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Provider config not found.");

    await deleteProvider(PLATFORM_CTX, req.params.id);

    // Clean up the key too — unless another config still references it.
    if (target.secretId) {
      const stillUsed = rows.some((r) => r.id !== target.id && r.secretId === target.secretId);
      if (!stillUsed) await deleteSecret(PLATFORM_CTX, target.secretId).catch(() => {});
    }

    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "AiProviderConfig",
      resourceId: target.id,
      oldValues: { provider: target.provider, kind: target.kind, label: target.label },
      ...extractRequestMeta(req),
    });

    res.json({ success: true, data: { id: target.id } });
  } catch (err) {
    next(err);
  }
});

router.post("/ai/secrets/:id/test", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await testSecret(PLATFORM_CTX, req.params.id) });
  } catch (err) {
    next(err);
  }
});

// Live provider ping for a configured AI provider (validates the stored key
// against the provider's own API).
router.post("/ai/providers/:id/test", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await testAiProviderKey(PLATFORM_CTX, req.params.id) });
  } catch (err) {
    next(err);
  }
});

// --- Email (SMTP) -----------------------------------------------------------
//
// One platform SMTP config, stored as a Secret Vault entry: metadata carries
// the non-secret fields, ciphertext carries the password (a sentinel for
// auth-less relays — the vault refuses empty values). Env SMTP_* stays as
// fallback; email.service resolves admin-first per send.

async function findSmtpEntry() {
  const entries = await listSecrets(PLATFORM_CTX, { provider: SecretProvider.SMTP });
  return entries.find((e) => e.label === SMTP_VAULT_LABEL) ?? null;
}

interface SmtpMeta {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string | null;
  fromEmail?: string;
  fromName?: string | null;
  /** Whether the ciphertext is a real password (vs the no-auth sentinel). */
  hasPassword?: boolean;
}

router.get("/smtp", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const entry = await findSmtpEntry();
    const meta = (entry?.metadata ?? {}) as SmtpMeta;
    const envHost = process.env.SMTP_HOST;
    res.json({
      success: true,
      data: {
        admin: entry
          ? {
              host: meta.host ?? null,
              port: meta.port ?? 587,
              secure: meta.secure ?? (meta.port ?? 587) === 465,
              user: meta.user ?? null,
              fromEmail: meta.fromEmail ?? null,
              fromName: meta.fromName ?? null,
              // The sentinel is not a real credential — show "none", not a mask.
              passwordLast4: meta.hasPassword ? entry.last4 : null,
            }
          : null,
        env: { configured: Boolean(envHost && !envHost.startsWith("your_")), host: envHost && !envHost.startsWith("your_") ? envHost : null },
      },
    });
  } catch (err) {
    next(err);
  }
});

const smtpPutSchema = z.object({
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
    const input = smtpPutSchema.parse(req.body);
    const user = input.user?.trim() || null;
    const existing = await findSmtpEntry();

    // An authenticated relay needs a password — either supplied now or
    // already stored from a previous save.
    const hasStoredPassword = Boolean(
      existing && (existing.metadata as SmtpMeta | null)?.hasPassword,
    );
    if (user && !input.password && !hasStoredPassword) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        "A password is required when an SMTP user is set.",
      );
    }

    const metadata: SmtpMeta = {
      host: input.host.trim(),
      port: input.port,
      secure: input.secure ?? input.port === 465,
      user,
      fromEmail: input.fromEmail.trim(),
      fromName: input.fromName?.trim() || null,
      hasPassword: input.password ? true : user ? hasStoredPassword : false,
    };

    let entryId: string;
    if (existing) {
      await updateSecret(PLATFORM_CTX, existing.id, { metadata });
      // Rotate the stored password when a new one arrives, or drop to the
      // sentinel when auth was removed entirely.
      if (input.password) {
        await rotateSecret(PLATFORM_CTX, existing.id, input.password);
      } else if (!user && hasStoredPassword) {
        await rotateSecret(PLATFORM_CTX, existing.id, SMTP_NO_AUTH_SENTINEL);
      }
      entryId = existing.id;
    } else {
      const created = await createSecret(PLATFORM_CTX, {
        provider: SecretProvider.SMTP,
        label: SMTP_VAULT_LABEL,
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
      resource: "SmtpConfig",
      resourceId: entryId,
      newValues: { host: metadata.host, port: metadata.port, user: metadata.user, fromEmail: metadata.fromEmail, passwordChanged: Boolean(input.password) },
      ...extractRequestMeta(req),
    });

    res.json({ success: true, data: { saved: true } });
  } catch (err) {
    next(err);
  }
});

router.delete("/smtp", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const existing = await findSmtpEntry();
    if (!existing) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "No SMTP settings saved.");
    await deleteSecret(PLATFORM_CTX, existing.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "SmtpConfig",
      resourceId: existing.id,
      oldValues: { host: (existing.metadata as SmtpMeta | null)?.host ?? null },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- Object storage (S3 / R2) ------------------------------------------------
// Platform config for image uploads. Keys live in the Secret Vault; only a
// last-4 mask is ever returned, same as SMTP/AI keys.

const storagePutSchema = z.object({
  provider: z.enum(["S3", "R2"]),
  bucket: z.string().min(1).max(255),
  region: z.string().min(1).max(64),
  endpoint: z.string().max(255).optional(),
  publicBaseUrl: z.string().max(500).optional(),
  accessKeyId: z.string().min(1).max(255),
  secretAccessKey: z.string().max(500).optional(),
});

router.get("/storage", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getStorageConfig() });
  } catch (err) {
    next(err);
  }
});

router.put("/storage", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = storagePutSchema.parse(req.body);
    await saveStorageConfig(
      {
        provider: input.provider as StorageProvider,
        bucket: input.bucket,
        region: input.region,
        endpoint: input.endpoint,
        publicBaseUrl: input.publicBaseUrl,
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
      },
      req.userId,
    );
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "StorageConfig",
      newValues: { provider: input.provider, bucket: input.bucket, region: input.region },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: await getStorageConfig() });
  } catch (err) {
    next(err);
  }
});

router.delete("/storage", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteStorageConfig();
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "StorageConfig",
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- Payments + transactions ------------------------------------------------
// Platform-wide money views. Payments = captured gateway payments; transactions
// = the raw credit ledger across all workspaces. Read-only.

router.get("/payments", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listPayments() });
  } catch (err) {
    next(err);
  }
});

// Refund a payment: reverse its credits + mark it REFUNDED (idempotent). Records
// the refund in the ledger only — the operator issues the money-back in the
// gateway dashboard. Audit-logged.
router.post("/payments/:id/refund", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const refunded = await refundPayment(req.params.id);
    await logAudit({
      tenantId: refunded.tenantId,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Payment",
      resourceId: refunded.id,
      newValues: { status: "REFUNDED", credits: refunded.credits, providerPaymentId: refunded.providerPaymentId },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: refunded });
  } catch (err) {
    next(err);
  }
});

// CSV export of all captured payments — for the operator's accounting.
router.get("/payments/export", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const rows = await listPayments();
    const csv = toCsv(
      ["Date", "Workspace", "Gateway", "Credits", "Amount", "Currency", "Status", "Payment ID"],
      rows.map((p) => [
        p.createdAt.toISOString(),
        p.tenantName,
        p.provider,
        p.credits,
        (p.amountMinor / 100).toFixed(2),
        p.currency,
        p.status,
        p.providerPaymentId,
      ]),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="payments.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.get("/transactions", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    // Only accept a real ledger type; anything else (junk query param) is
    // ignored rather than passed to Prisma, which would 500 on an invalid enum.
    const raw = typeof req.query.type === "string" ? req.query.type : undefined;
    const type =
      raw && raw in WalletTransactionType ? (raw as WalletTransactionType) : undefined;
    const rows = await prisma.walletTransaction.findMany({
      where: type ? { type } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { wallet: { select: { tenant: { select: { name: true } } } } },
    });
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        tenantName: r.wallet.tenant.name,
        type: r.type,
        deltaCredits: r.deltaCredits,
        balanceAfter: r.balanceAfter,
        feature: r.feature,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// CSV export of the credit ledger — for reconciliation/accounting.
router.get("/transactions/export", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.walletTransaction.findMany({
      orderBy: { createdAt: "desc" },
      take: 5000,
      include: { wallet: { select: { tenant: { select: { name: true } } } } },
    });
    const csv = toCsv(
      ["Date", "Workspace", "Type", "Change", "Balance After", "Detail"],
      rows.map((r) => [
        r.createdAt.toISOString(),
        r.wallet.tenant.name,
        r.type,
        r.deltaCredits,
        r.balanceAfter,
        r.reason ?? r.feature ?? "",
      ]),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="transactions.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// --- Invoices ---------------------------------------------------------------
// Derived one-per-payment (see invoice.service). List + printable detail.

router.get("/invoices", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listInvoices() });
  } catch (err) {
    next(err);
  }
});

// CSV export of invoices — placed before /:id so "export" isn't read as an id.
router.get("/invoices/export", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const rows = await listInvoices();
    const csv = toCsv(
      ["Invoice", "Date", "Workspace", "Total", "Currency", "Status", "Payment ID"],
      rows.map((inv) => [
        inv.number,
        inv.issuedAt.toISOString(),
        inv.buyer.name,
        (inv.totalMinor / 100).toFixed(2),
        inv.currency,
        inv.status,
        inv.payment.providerPaymentId,
      ]),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="invoices.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.get("/invoices/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const invoice = await getInvoice(req.params.id);
    if (!invoice) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Invoice not found.");
    res.json({ success: true, data: invoice });
  } catch (err) {
    next(err);
  }
});

// --- Payment gateways -------------------------------------------------------
// Which gateway is active for top-ups. Keys live in the server env per provider
// (safest for payment secrets); only the active-provider choice is admin-set.

router.get("/gateways", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getGatewayStatus() });
  } catch (err) {
    next(err);
  }
});

const gatewaySchema = z.object({ activeProvider: z.enum(["razorpay", "stripe"]) });

router.put("/gateways", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { activeProvider } = gatewaySchema.parse(req.body);
    const status = await setActiveProvider(activeProvider, req.userId);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "PaymentGateway",
      resourceId: "active",
      newValues: { activeProvider },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
});

// --- Email templates --------------------------------------------------------
// Customise the transactional emails the platform sends. Overrides are opt-in
// per template (useCustom); with it off the built-in default is used, so an
// auth email can't be broken by a bad edit.

router.get("/email-templates", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listEmailTemplates() });
  } catch (err) {
    next(err);
  }
});

const emailTemplateSchema = z.object({
  subject: z.string().max(200),
  body: z.string().max(5000),
  useCustom: z.boolean(),
});

router.patch("/email-templates/:key", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = emailTemplateSchema.parse(req.body);
    const tpl = await upsertEmailTemplate(req.params.key, { ...input, updatedByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "EmailTemplate",
      resourceId: req.params.key,
      newValues: { useCustom: tpl.useCustom },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: tpl });
  } catch (err) {
    next(err);
  }
});

const smtpTestSchema = z.object({ to: z.string().email() });

router.post("/smtp/test", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { to } = smtpTestSchema.parse(req.body);
    res.json({ success: true, data: await sendTestEmail(to) });
  } catch (err) {
    next(err);
  }
});

// --- Plans ------------------------------------------------------------------
//
// A plan catalog defines entitlements (limits, credit allotment), not charges —
// no invoice/payment model ships here, so price is display-only. Limits are
// enforced at creation points (e.g. locations); a null limit is unlimited.

router.get("/plans", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listPlans({ includeArchived: true }) });
  } catch (err) {
    next(err);
  }
});

// A limit is a positive integer or null (unlimited); coerce "" / undefined to null.
const nullableLimit = z
  .union([z.number().int().min(0), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v));

const planBodySchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().length(3).optional(),
  interval: z.nativeEnum(PlanInterval).optional(),
  monthlyCredits: z.number().int().min(0).max(10_000_000).optional(),
  maxLocations: nullableLimit,
  maxKeywords: nullableLimit,
  maxUsers: nullableLimit,
  features: z.array(z.string().max(120)).max(20).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

router.post("/plans", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = planBodySchema.parse(req.body);
    const plan = await createPlan(input);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "Plan",
      resourceId: plan.id,
      newValues: { name: plan.name, priceCents: plan.priceCents, maxLocations: plan.maxLocations },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    next(err);
  }
});

const planPatchSchema = planBodySchema.partial().extend({
  status: z.nativeEnum(PlanStatus).optional(),
});

router.patch("/plans/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = planPatchSchema.parse(req.body);
    const plan = await updatePlan(req.params.id, input);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Plan",
      resourceId: plan.id,
      newValues: { name: plan.name, status: plan.status, priceCents: plan.priceCents, maxLocations: plan.maxLocations },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: plan });
  } catch (err) {
    next(err);
  }
});

router.delete("/plans/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deletePlan(req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "Plan",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    next(err);
  }
});

// --- Support tickets (admin side) -------------------------------------------
// Staff see every workspace's tickets and reply as STAFF. Reads span all
// tenants (tenantId null); replies/status changes are audited.

router.get("/tickets", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const status =
      typeof req.query.status === "string" && req.query.status in TicketStatus
        ? (req.query.status as TicketStatus)
        : undefined;
    res.json({ success: true, data: await listTickets({ status }) });
  } catch (err) {
    next(err);
  }
});

router.get("/tickets/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getTicket(req.params.id, null) });
  } catch (err) {
    next(err);
  }
});

const adminReplySchema = z.object({ body: z.string().min(1).max(5000) });

router.post("/tickets/:id/reply", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { body } = adminReplySchema.parse(req.body);
    const ticket = await replyToTicket({
      ticketId: req.params.id,
      tenantId: null,
      author: TicketAuthor.STAFF,
      authorUserId: req.userId,
      body,
    });
    await logAudit({
      tenantId: ticket.tenantId,
      userId: req.userId!,
      action: "REPLY",
      resource: "SupportTicket",
      resourceId: ticket.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
});

const ticketPatchSchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
});

router.patch("/tickets/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const patch = ticketPatchSchema.parse(req.body);
    const ticket = await updateTicket(req.params.id, patch);
    await logAudit({
      tenantId: ticket.tenantId,
      userId: req.userId!,
      action: "UPDATE",
      resource: "SupportTicket",
      resourceId: ticket.id,
      newValues: { status: ticket.status, priority: ticket.priority },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
});

const assignPlanSchema = z.object({ planId: z.string().min(1).nullable() });

router.post("/tenants/:id/plan", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { planId } = assignPlanSchema.parse(req.body);
    const existing = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { planId: true },
    });
    if (!existing) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Workspace not found.");

    await assignPlan(req.params.id, planId);
    await logAudit({
      tenantId: req.params.id,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Tenant",
      resourceId: req.params.id,
      oldValues: { planId: existing.planId },
      newValues: { planId },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { tenantId: req.params.id, planId } });
  } catch (err) {
    next(err);
  }
});

export default router;
