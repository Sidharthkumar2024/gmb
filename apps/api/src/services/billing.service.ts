import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// Credit accounting for AI calls in the standalone GMB app.
//
// ── Deliberate scope limit, read before enabling billing ────────────────────
// The monorepo's billing.service is ledger-based: every debit writes a
// WalletTransaction through an idempotent adjust helper, with separate wallet
// types and admin-editable CreditRule rows. None of that was carried over,
// because the extracted GMB code reads only `balanceCredits` /
// `reservedCredits` and the slim Wallet here has no transaction table.
//
// So this implementation is balance-only: no ledger, no idempotency key, no
// refund path. That is safe *because billing is off by default* — with
// WALLET_BILLING_ENABLED unset every function below is a no-op, exactly as in
// the monorepo. Before charging real customers, a WalletTransaction model and
// an idempotent adjust must be added; a balance-only debit cannot be audited
// or reversed, and a retried request would double-charge.
// ───────────────────────────────────────────────────────────────────────────

function billingEnabled(): boolean {
  return (process.env.WALLET_BILLING_ENABLED ?? "false").toLowerCase() === "true";
}

/**
 * Per-feature AI cost in credits. In the monorepo these are admin-editable
 * CreditRule rows; here they are defaults overridable by env, so pricing can be
 * tuned without a schema until a rules table is justified.
 */
export const AI_FEATURE_COSTS: Record<string, { label: string; credits: number }> = {
  gmb_review_reply: { label: "AI review reply", credits: 1 },
  gmb_qanda_answer: { label: "AI Q&A answer", credits: 1 },
  gmb_post_caption: { label: "AI post caption", credits: 1 },
  gmb_keyword_finder: { label: "AI keyword ideas", credits: 2 },
  gmb_description_optimizer: { label: "AI description", credits: 1 },
  gmb_ranking_advisor: { label: "AI ranking advice", credits: 3 },
  gmb_report: { label: "AI report", credits: 3 },
  gmb_image_generation: { label: "AI image", credits: 5 },
};

const DEFAULT_AI_COST_CREDITS = 1;

export function resolveAiCostCredits(feature?: string): number {
  const envOverride = feature
    ? Number(process.env[`AI_COST_${feature.toUpperCase()}`])
    : NaN;
  // Credits are an integer column, and this value feeds both the afford-check's
  // `gte` guard and the `{ decrement }`. A fractional env override (e.g. 0.5)
  // would create rounding/precision mismatches between the two, so round to a
  // whole credit here.
  if (Number.isFinite(envOverride) && envOverride >= 0) return Math.round(envOverride);
  return feature
    ? (AI_FEATURE_COSTS[feature]?.credits ?? DEFAULT_AI_COST_CREDITS)
    : DEFAULT_AI_COST_CREDITS;
}

/** The pricing table the UI shows. Reports 0 across the board when billing is off. */
export async function listGmbAiCosts(): Promise<
  { feature: string; label: string; credits: number }[]
> {
  const charging = billingEnabled();
  return Object.entries(AI_FEATURE_COSTS).map(([feature, meta]) => ({
    feature,
    label: meta.label,
    credits: charging ? resolveAiCostCredits(feature) : 0,
  }));
}

/**
 * Pre-check before an AI call. Throws 402 when the wallet cannot cover it, so
 * the provider is never invoked for a call the customer can't pay for.
 * Reserved credits are treated as already spoken for.
 */
export async function assertCanAffordAi(
  tenantId: string,
  feature?: string,
): Promise<void> {
  if (!billingEnabled()) return;

  const cost = resolveAiCostCredits(feature);
  if (cost <= 0) return;

  // Read the tenant's primary (oldest) wallet deterministically, so the
  // afford-check and debitAi always look at the *same* wallet. (Matches the
  // UI's primaryWallet = wallets ordered createdAt asc.)
  const wallet = await prisma.wallet.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });
  const available = wallet
    ? wallet.balanceCredits - wallet.reservedCredits
    : 0;

  if (!wallet || available < cost) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      402,
      `Not enough AI credits for this action (needs ${cost}, available ${Math.max(available, 0)}). Top up to continue.`,
    );
  }
}

/**
 * Charge for a completed AI call. Called AFTER the provider succeeded, so a
 * failed generation is never billed.
 *
 * Failures here are swallowed by the caller (ai.service logs them) — losing a
 * debit must not lose the customer's result. That is another reason the ledger
 * above is required before this is used for real money: a silently dropped
 * debit is currently unrecoverable.
 */
export async function debitAi(
  tenantId: string,
  args: { aiUsageId?: string | null; feature?: string; reason?: string } = {},
): Promise<void> {
  if (!billingEnabled()) return;

  const cost = resolveAiCostCredits(args.feature);
  if (cost <= 0) return;

  // Debit exactly the tenant's primary (oldest) wallet — the same one the
  // afford-check reads — not every wallet the tenant owns. The previous
  // updateMany over `{ tenantId }` decremented *every* wallet clearing the
  // cost, so a tenant with more than one wallet was charged N times per call.
  // The id-scoped conditional decrement stays atomic (single UPDATE), and
  // guarding on balance >= cost + reservedCredits stops a debit from spending
  // credits reserved for a pending job.
  const wallet = await prisma.wallet.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true, reservedCredits: true },
  });
  const updated = wallet
    ? await prisma.wallet.updateMany({
        where: { id: wallet.id, balanceCredits: { gte: cost + wallet.reservedCredits } },
        data: { balanceCredits: { decrement: cost } },
      })
    : { count: 0 };

  if (updated.count === 0) {
    // Raced to empty between the afford-check and here. Log loudly: the work
    // was already done and delivered, so this is revenue lost, not an error to
    // surface to the customer.
    console.warn(
      `[billing] AI debit skipped — insufficient balance at debit time (tenant=${tenantId} feature=${args.feature ?? "generic"} cost=${cost})`,
    );
  }
}

/**
 * A held credit reservation — the wallet, tenant and cost, so settle/release can
 * write the matching ledger row. Null when billing is off or the feature is free.
 */
export interface AiReservation {
  walletId: string;
  tenantId: string;
  feature?: string;
  cost: number;
}

/**
 * Reserve credits BEFORE an AI call, closing the check-then-debit race:
 * `assertCanAffordAi` + `debitAi` were separate, so two concurrent calls both
 * passed the check, both invoked the (paid) provider, and only one debit landed
 * — the design's own comment calls that "revenue lost". Reserving up front means
 * the second call sees the credits already held (available = balance − reserved)
 * and is rejected with 402 before the provider runs.
 *
 * The reserve atomically checks `balance − reserved >= cost` and increments
 * `reserved` (one guarded raw UPDATE — Prisma's `where` can't compare two
 * columns), then records a RESERVE ledger row in the same transaction.
 *
 * NOTE: gated behind WALLET_BILLING_ENABLED (off today), so this path is dormant
 * and has not been exercised against a live wallet — verify before enabling.
 */
export async function reserveAi(
  tenantId: string,
  feature?: string,
): Promise<AiReservation | null> {
  if (!billingEnabled()) return null;

  const cost = resolveAiCostCredits(feature);
  if (cost <= 0) return null;

  const wallet = await prisma.wallet.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!wallet) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      402,
      `Not enough AI credits for this action (needs ${cost}, available 0). Top up to continue.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const held = await tx.$executeRaw`
      UPDATE "Wallet"
      SET "reservedCredits" = "reservedCredits" + ${cost}
      WHERE "id" = ${wallet.id}
        AND ("balanceCredits" - "reservedCredits") >= ${cost}
    `;
    if (held === 0) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        402,
        `Not enough AI credits for this action (needs ${cost}). Top up to continue.`,
      );
    }
    const w = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { balanceCredits: true },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        tenantId,
        type: "RESERVE",
        deltaCredits: 0,
        deltaReserved: cost,
        balanceAfter: w.balanceCredits,
        feature: feature ?? null,
      },
    });
    return { walletId: wallet.id, tenantId, feature, cost };
  });
}

/**
 * Settle a reservation after the AI call succeeded: convert the held credits into
 * an actual spend (decrement balance and reserved) and record a SETTLE ledger
 * row — atomically, so the balance change and its audit row can't diverge.
 */
export async function settleAi(
  reservation: AiReservation | null,
  opts: { aiUsageId?: string | null } = {},
): Promise<void> {
  if (!reservation) return;
  await prisma.$transaction(async (tx) => {
    const w = await tx.wallet.update({
      where: { id: reservation.walletId },
      data: {
        balanceCredits: { decrement: reservation.cost },
        reservedCredits: { decrement: reservation.cost },
      },
      select: { balanceCredits: true },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: reservation.walletId,
        tenantId: reservation.tenantId,
        type: "SETTLE",
        deltaCredits: -reservation.cost,
        deltaReserved: -reservation.cost,
        balanceAfter: w.balanceCredits,
        feature: reservation.feature ?? null,
        aiUsageId: opts.aiUsageId ?? null,
      },
    });
  });
}

/**
 * Release a reservation without charging (the AI call failed): return the held
 * credits (decrement only `reserved`) and record a RELEASE ledger row.
 */
export async function releaseAi(reservation: AiReservation | null): Promise<void> {
  if (!reservation) return;
  await prisma.$transaction(async (tx) => {
    const w = await tx.wallet.update({
      where: { id: reservation.walletId },
      data: { reservedCredits: { decrement: reservation.cost } },
      select: { balanceCredits: true },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: reservation.walletId,
        tenantId: reservation.tenantId,
        type: "RELEASE",
        deltaCredits: 0,
        deltaReserved: -reservation.cost,
        balanceAfter: w.balanceCredits,
        feature: reservation.feature ?? null,
      },
    });
  });
}

/**
 * Add credits to a tenant's primary wallet and record a GRANT ledger row — the
 * gateway-agnostic core of top-up. A verified payment webhook (Stripe/Razorpay)
 * calls this with the provider's event id as `idempotencyKey` so a replayed
 * webhook can't double-credit: the unique key means a second attempt either
 * short-circuits (already recorded) or rolls back on the constraint. Also used
 * for signup bonuses and manual/plan grants.
 */
export async function grantCredits(
  tenantId: string,
  credits: number,
  opts: { reason?: string; idempotencyKey?: string } = {},
): Promise<void> {
  if (credits <= 0) return;

  // Provision a wallet on first grant if the tenant has none. Self-service
  // signups get a wallet up front, but a tenant created another way (e.g. a
  // partner-provisioned customer) may not — and a top-up must never fail just
  // because the wallet row doesn't exist yet.
  let wallet = await prisma.wallet.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { tenantId }, select: { id: true } });
  }

  // Fast path: this grant was already applied (replayed webhook).
  if (opts.idempotencyKey) {
    const existing = await prisma.walletTransaction.findUnique({
      where: { idempotencyKey: opts.idempotencyKey },
      select: { id: true },
    });
    if (existing) return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const w = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceCredits: { increment: credits } },
        select: { balanceCredits: true },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          tenantId,
          type: "GRANT",
          deltaCredits: credits,
          deltaReserved: 0,
          balanceAfter: w.balanceCredits,
          reason: opts.reason ?? null,
          idempotencyKey: opts.idempotencyKey ?? null,
        },
      });
    });
  } catch (e) {
    // Two webhooks with the same idempotencyKey raced — the unique constraint
    // rolls this one back (so the balance isn't double-incremented). Treat as
    // already-applied rather than an error.
    if ((e as { code?: string }).code === "P2002") return;
    throw e;
  }
}

/**
 * Reverse a prior grant (a refund). Debits `credits` and records a REFUND ledger
 * row, idempotency-keyed like grantCredits. The balance is allowed to go
 * negative: if the customer already spent the refunded credits, that debt is the
 * truthful record — and a negative balance simply blocks further paid usage
 * until it's topped back up. Never moves money; the gateway refund is issued
 * separately by the operator.
 */
export async function reverseCredits(
  tenantId: string,
  credits: number,
  opts: { reason?: string; idempotencyKey?: string } = {},
): Promise<void> {
  if (credits <= 0) return;

  let wallet = await prisma.wallet.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { tenantId }, select: { id: true } });
  }

  if (opts.idempotencyKey) {
    const existing = await prisma.walletTransaction.findUnique({
      where: { idempotencyKey: opts.idempotencyKey },
      select: { id: true },
    });
    if (existing) return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const w = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceCredits: { decrement: credits } },
        select: { balanceCredits: true },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          tenantId,
          type: "REFUND",
          deltaCredits: -credits,
          deltaReserved: 0,
          balanceAfter: w.balanceCredits,
          reason: opts.reason ?? null,
          idempotencyKey: opts.idempotencyKey ?? null,
        },
      });
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return;
    throw e;
  }
}
