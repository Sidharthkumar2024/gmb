import { prisma, PlanStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// Partner resale plans. A white-label partner resells a platform Plan (the
// wholesale) to its own customers at a retail price it sets. Margin is DERIVED
// here from the base plan's CURRENT price — never stored — so it can't drift if
// the platform changes wholesale. Every function is scoped to the caller's
// partner tenant; a partner can only ever see or mutate its own resale plans.

export interface BasePlanOption {
  id: string;
  name: string;
  wholesaleCents: number;
  currency: string;
  monthlyCredits: number;
}

export interface PartnerPlanView {
  id: string;
  name: string;
  status: PlanStatus;
  retailCents: number;
  currency: string;
  basePlan: BasePlanOption;
  marginCents: number; // retail − wholesale, derived
  sortOrder: number;
  createdAt: Date;
}

/** Active platform plans a partner can resell (for the create/edit form). */
export async function listBasePlans(): Promise<BasePlanOption[]> {
  const rows = await prisma.plan.findMany({
    where: { status: PlanStatus.ACTIVE },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    wholesaleCents: p.priceCents,
    currency: p.currency,
    monthlyCredits: p.monthlyCredits,
  }));
}

function toView(p: {
  id: string;
  name: string;
  status: PlanStatus;
  retailCents: number;
  currency: string;
  sortOrder: number;
  createdAt: Date;
  basePlan: { id: string; name: string; priceCents: number; currency: string; monthlyCredits: number };
}): PartnerPlanView {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    retailCents: p.retailCents,
    currency: p.currency,
    basePlan: {
      id: p.basePlan.id,
      name: p.basePlan.name,
      wholesaleCents: p.basePlan.priceCents,
      currency: p.basePlan.currency,
      monthlyCredits: p.basePlan.monthlyCredits,
    },
    marginCents: p.retailCents - p.basePlan.priceCents,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
  };
}

const withBase = { basePlan: true } as const;

/** A partner's own resale plans, newest-priced ordering. */
export async function listPartnerPlans(partnerTenantId: string): Promise<PartnerPlanView[]> {
  const rows = await prisma.partnerPlan.findMany({
    where: { partnerTenantId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: withBase,
  });
  return rows.map(toView);
}

export interface UpsertPartnerPlanInput {
  name: string;
  basePlanId: string;
  retailCents: number;
  status?: PlanStatus;
  sortOrder?: number;
}

/**
 * The base plan must exist and be ACTIVE — a partner can't resell an archived or
 * nonexistent platform plan. Currency follows the base plan so retail and
 * wholesale are always comparable (margin is meaningless across currencies).
 */
async function requireActiveBasePlan(basePlanId: string) {
  const base = await prisma.plan.findUnique({ where: { id: basePlanId } });
  if (!base || base.status !== PlanStatus.ACTIVE) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Choose an active platform plan to resell.");
  }
  return base;
}

export async function createPartnerPlan(
  partnerTenantId: string,
  input: UpsertPartnerPlanInput,
): Promise<PartnerPlanView> {
  if (!input.name.trim()) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A plan name is required.");
  if (!Number.isInteger(input.retailCents) || input.retailCents < 0) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Retail price must be zero or more.");
  }
  const base = await requireActiveBasePlan(input.basePlanId);
  const created = await prisma.partnerPlan.create({
    data: {
      partnerTenantId,
      basePlanId: base.id,
      name: input.name.trim(),
      retailCents: input.retailCents,
      currency: base.currency,
      status: input.status ?? PlanStatus.ACTIVE,
      sortOrder: input.sortOrder ?? 100,
    },
    include: withBase,
  });
  return toView(created);
}

/** Ownership is enforced by matching BOTH id and partnerTenantId. */
async function requireOwnedPlan(partnerTenantId: string, id: string) {
  const existing = await prisma.partnerPlan.findFirst({ where: { id, partnerTenantId } });
  if (!existing) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Resale plan not found.");
  return existing;
}

export async function updatePartnerPlan(
  partnerTenantId: string,
  id: string,
  input: UpsertPartnerPlanInput,
): Promise<PartnerPlanView> {
  await requireOwnedPlan(partnerTenantId, id);
  if (!input.name.trim()) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A plan name is required.");
  if (!Number.isInteger(input.retailCents) || input.retailCents < 0) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Retail price must be zero or more.");
  }
  const base = await requireActiveBasePlan(input.basePlanId);
  const updated = await prisma.partnerPlan.update({
    where: { id },
    data: {
      basePlanId: base.id,
      name: input.name.trim(),
      retailCents: input.retailCents,
      currency: base.currency,
      status: input.status ?? PlanStatus.ACTIVE,
      sortOrder: input.sortOrder ?? undefined,
    },
    include: withBase,
  });
  return toView(updated);
}

export async function deletePartnerPlan(partnerTenantId: string, id: string): Promise<void> {
  await requireOwnedPlan(partnerTenantId, id);
  await prisma.partnerPlan.delete({ where: { id } });
}
