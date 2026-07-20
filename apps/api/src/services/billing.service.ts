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
  if (Number.isFinite(envOverride) && envOverride >= 0) return envOverride;
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

  const wallet = await prisma.wallet.findFirst({ where: { tenantId } });
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

  // Atomic decrement so concurrent AI calls can't interleave a read-modify-write.
  const updated = await prisma.wallet.updateMany({
    where: { tenantId, balanceCredits: { gte: cost } },
    data: { balanceCredits: { decrement: cost } },
  });

  if (updated.count === 0) {
    // Raced to empty between the afford-check and here. Log loudly: the work
    // was already done and delivered, so this is revenue lost, not an error to
    // surface to the customer.
    console.warn(
      `[billing] AI debit skipped — insufficient balance at debit time (tenant=${tenantId} feature=${args.feature ?? "generic"} cost=${cost})`,
    );
  }
}
