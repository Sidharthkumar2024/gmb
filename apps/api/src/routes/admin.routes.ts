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
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { requireAuth, type RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import { getSafeGoogleOAuthConfig } from "../services/googleOAuthConfig.service";
import {
  listProviders,
  createProvider,
  updateProvider,
  setDefaultProvider,
  deleteProvider,
} from "../services/aiProviderHub.service";
import {
  listSecrets,
  createSecret,
  rotateSecret,
  deleteSecret,
  testSecret,
} from "../services/secretVault.service";
import { hasConfiguredAiClient } from "../services/ai.service";

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
    const rows = await prisma.tenant.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        _count: { select: { users: true, gmbLocations: true, gmbReviews: true } },
        wallets: { select: { balanceCredits: true }, take: 1 },
      },
    });
    res.json({
      success: true,
      data: rows.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        industry: t.industry,
        status: t.status,
        users: t._count.users,
        locations: t._count.gmbLocations,
        reviews: t._count.gmbReviews,
        credits: t.wallets[0]?.balanceCredits ?? 0,
        createdAt: t.createdAt,
      })),
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
    const rows = await prisma.user.findMany({
      where: q ? { email: { contains: q, mode: "insensitive" } } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { tenant: { select: { name: true } } },
    });
    res.json({
      success: true,
      data: rows.map((u) => ({
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

export default router;
