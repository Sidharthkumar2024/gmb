import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { prisma, TenantStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { requireAuth, type RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import { getSafeGoogleOAuthConfig } from "../services/googleOAuthConfig.service";

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

export default router;
