import { prisma, PlanInterval, PlanStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// Subscription plan catalog + entitlement checks.
//
// A plan defines what a workspace is ENTITLED to, not what it is charged —
// this build has no payment ledger, so `priceCents` is display-only. The limit
// fields ARE enforced (see assertWithinLocationLimit); a null limit means
// unlimited, and a workspace with no plan is unlimited too, so existing
// behaviour is unchanged until an admin assigns a limited plan.

export interface SafePlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: PlanInterval;
  monthlyCredits: number;
  maxLocations: number | null;
  maxKeywords: number | null;
  maxUsers: number | null;
  features: string[];
  status: PlanStatus;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

interface PlanRow extends Omit<SafePlan, never> {}

function toSafePlan(row: PlanRow): SafePlan {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    priceCents: row.priceCents,
    currency: row.currency,
    interval: row.interval,
    monthlyCredits: row.monthlyCredits,
    maxLocations: row.maxLocations,
    maxKeywords: row.maxKeywords,
    maxUsers: row.maxUsers,
    features: row.features,
    status: row.status,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** URL-safe slug from a plan name. */
export function slugifyPlanName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface ListPlansOptions {
  includeArchived?: boolean;
}

export async function listPlans(opts: ListPlansOptions = {}): Promise<
  Array<SafePlan & { tenantCount: number }>
> {
  const rows = await prisma.plan.findMany({
    where: opts.includeArchived ? {} : { status: PlanStatus.ACTIVE },
    orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }],
    include: { _count: { select: { tenants: true } } },
  });
  return rows.map((r) => ({ ...toSafePlan(r), tenantCount: r._count.tenants }));
}

export interface CreatePlanInput {
  name: string;
  description?: string | null;
  priceCents?: number;
  currency?: string;
  interval?: PlanInterval;
  monthlyCredits?: number;
  maxLocations?: number | null;
  maxKeywords?: number | null;
  maxUsers?: number | null;
  features?: string[];
  isDefault?: boolean;
  sortOrder?: number;
}

export async function createPlan(input: CreatePlanInput): Promise<SafePlan> {
  const name = input.name.trim();
  if (!name) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A plan name is required.");
  const slug = slugifyPlanName(name);
  if (!slug) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Plan name must contain letters or numbers.");

  const clash = await prisma.plan.findUnique({ where: { slug }, select: { id: true } });
  if (clash) throw new ApiError(ErrorCodes.CONFLICT, 409, `A plan named "${name}" already exists.`);

  const row = await prisma.plan.create({
    data: {
      name,
      slug,
      description: input.description?.trim() || null,
      priceCents: input.priceCents ?? 0,
      currency: (input.currency ?? "USD").toUpperCase(),
      interval: input.interval ?? PlanInterval.MONTH,
      monthlyCredits: input.monthlyCredits ?? 0,
      maxLocations: input.maxLocations ?? null,
      maxKeywords: input.maxKeywords ?? null,
      maxUsers: input.maxUsers ?? null,
      features: input.features ?? [],
      isDefault: input.isDefault ?? false,
      sortOrder: input.sortOrder ?? 100,
    },
  });
  if (row.isDefault) await clearOtherDefaults(row.id);
  return toSafePlan(row);
}

export interface UpdatePlanInput {
  name?: string;
  description?: string | null;
  priceCents?: number;
  currency?: string;
  interval?: PlanInterval;
  monthlyCredits?: number;
  maxLocations?: number | null;
  maxKeywords?: number | null;
  maxUsers?: number | null;
  features?: string[];
  status?: PlanStatus;
  isDefault?: boolean;
  sortOrder?: number;
}

async function findPlanOrThrow(id: string) {
  const row = await prisma.plan.findUnique({ where: { id } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Plan not found.");
  return row;
}

async function clearOtherDefaults(keepId: string): Promise<void> {
  await prisma.plan.updateMany({
    where: { id: { not: keepId }, isDefault: true },
    data: { isDefault: false },
  });
}

export async function updatePlan(id: string, input: UpdatePlanInput): Promise<SafePlan> {
  await findPlanOrThrow(id);
  const row = await prisma.plan.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
      ...(input.currency !== undefined ? { currency: input.currency.toUpperCase() } : {}),
      ...(input.interval !== undefined ? { interval: input.interval } : {}),
      ...(input.monthlyCredits !== undefined ? { monthlyCredits: input.monthlyCredits } : {}),
      ...(input.maxLocations !== undefined ? { maxLocations: input.maxLocations } : {}),
      ...(input.maxKeywords !== undefined ? { maxKeywords: input.maxKeywords } : {}),
      ...(input.maxUsers !== undefined ? { maxUsers: input.maxUsers } : {}),
      ...(input.features !== undefined ? { features: input.features } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
  if (row.isDefault) await clearOtherDefaults(row.id);
  return toSafePlan(row);
}

export async function deletePlan(id: string): Promise<void> {
  const row = await findPlanOrThrow(id);
  const assigned = await prisma.tenant.count({ where: { planId: id } });
  if (assigned > 0) {
    // Deleting would silently unassign live customers; make the admin archive
    // it (hides it from the catalog) or reassign first.
    throw new ApiError(
      ErrorCodes.CONFLICT,
      409,
      `"${row.name}" is assigned to ${assigned} workspace(s). Archive it or reassign them first.`,
    );
  }
  await prisma.plan.delete({ where: { id } });
}

/** Assign a plan to a workspace, or clear it (planId null). */
export async function assignPlan(tenantId: string, planId: string | null): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Workspace not found.");
  if (planId) await findPlanOrThrow(planId);
  await prisma.tenant.update({ where: { id: tenantId }, data: { planId } });
}

// ---------------------------------------------------------------------
// Entitlement checks (enforced at creation points)
// ---------------------------------------------------------------------

/**
 * Throw if adding one more location would exceed the workspace's plan limit.
 * No plan, or a null maxLocations, means unlimited — the common case, so this
 * is a single cheap query that usually short-circuits.
 */
export async function assertWithinLocationLimit(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: { select: { name: true, maxLocations: true } } },
  });
  const max = tenant?.plan?.maxLocations;
  if (max == null) return;
  const count = await prisma.gmbLocation.count({ where: { tenantId } });
  if (count >= max) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      `Your ${tenant!.plan!.name} plan allows ${max} location${max === 1 ? "" : "s"}. Upgrade to add more.`,
    );
  }
}

/** The plan a workspace is on, for read-only display (customer billing page). */
export async function getTenantPlan(tenantId: string): Promise<
  (SafePlan & { locationsUsed: number }) | null
> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true },
  });
  if (!tenant?.plan) return null;
  const locationsUsed = await prisma.gmbLocation.count({ where: { tenantId } });
  return { ...toSafePlan(tenant.plan), locationsUsed };
}
