import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { sendEmail } from "./email.service";

// Rank-drop alert rules (Adgrowly GMB Panel design — "Create alert rule").
//
// A rule watches one tracked keyword and fires when the newest rank crosses
// from OK (found at <= thresholdRank) to BAD (worse than the threshold, or
// not found at all). Crossing-only semantics keep the signal quiet: a keyword
// stuck at #40 alerts once when it drops, then re-arms automatically after it
// recovers — no repeat alert per scheduled check.
//
// Evaluation is fire-and-forget from the two snapshot write paths
// (gmbRanking.recordSnapshot + the grid capture's centre-point snapshot).
// An alerting failure must never break a rank check, so evaluateRankAlerts
// swallows and logs its own errors.

export interface TriggerInput {
  /** Rank before this check. Undefined = no prior snapshot. Null = not found. */
  previousRank: number | null | undefined;
  /** Rank from the snapshot that was just recorded. Null = not found. */
  currentRank: number | null;
  thresholdRank: number;
}

function isBad(rank: number | null, threshold: number): boolean {
  return rank === null || rank > threshold;
}

/**
 * Pure decision core. Fires only on an OK → BAD crossing:
 *   • current must be BAD (worse than threshold, or not found), AND
 *   • a previous snapshot must exist and have been OK.
 * First-ever checks never fire (no baseline to have "dropped" from), and a
 * keyword that stays bad stays quiet until it recovers and drops again.
 */
export function shouldTriggerRankAlert(input: TriggerInput): boolean {
  const { previousRank, currentRank, thresholdRank } = input;
  if (!Number.isInteger(thresholdRank) || thresholdRank < 1) return false;
  if (!isBad(currentRank, thresholdRank)) return false;
  if (previousRank === undefined) return false; // no baseline
  return !isBad(previousRank, thresholdRank);
}

// ----------------------------------------------------------------------------
// CRUD (tenant-scoped)
// ----------------------------------------------------------------------------

const MAX_RULES_PER_TENANT = 100;

export async function listRankAlertRules(tenantId: string) {
  return prisma.gmbRankAlertRule.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      keyword: { select: { id: true, keyword: true, locationId: true } },
    },
  });
}

export async function createRankAlertRule(
  tenantId: string,
  input: { keywordId: string; thresholdRank: number; notifyEmail?: string | null },
) {
  const keyword = await prisma.gmbTrackedKeyword.findFirst({
    where: { id: input.keywordId, tenantId },
    select: { id: true },
  });
  if (!keyword) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tracked keyword not found.");
  }
  const count = await prisma.gmbRankAlertRule.count({ where: { tenantId } });
  if (count >= MAX_RULES_PER_TENANT) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Rule limit reached (${MAX_RULES_PER_TENANT}). Delete unused rules first.`,
    );
  }
  return prisma.gmbRankAlertRule.create({
    data: {
      tenantId,
      keywordId: input.keywordId,
      thresholdRank: input.thresholdRank,
      notifyEmail: input.notifyEmail?.trim() || null,
    },
    include: {
      keyword: { select: { id: true, keyword: true, locationId: true } },
    },
  });
}

export async function updateRankAlertRule(
  tenantId: string,
  id: string,
  input: { thresholdRank?: number; notifyEmail?: string | null; isActive?: boolean },
) {
  const existing = await prisma.gmbRankAlertRule.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Alert rule not found.");
  }
  return prisma.gmbRankAlertRule.update({
    where: { id },
    data: {
      ...(input.thresholdRank !== undefined ? { thresholdRank: input.thresholdRank } : {}),
      ...(input.notifyEmail !== undefined
        ? { notifyEmail: input.notifyEmail?.trim() || null }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    include: {
      keyword: { select: { id: true, keyword: true, locationId: true } },
    },
  });
}

export async function deleteRankAlertRule(tenantId: string, id: string) {
  const existing = await prisma.gmbRankAlertRule.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Alert rule not found.");
  }
  await prisma.gmbRankAlertRule.delete({ where: { id } });
}

// ----------------------------------------------------------------------------
// Evaluation — called after a snapshot write
// ----------------------------------------------------------------------------

/**
 * Evaluate every active rule on a keyword against the snapshot that was just
 * recorded. `currentRank` is passed by the caller (the row it just wrote);
 * "previous" is the second-newest snapshot. Best-effort by design: errors are
 * logged, never thrown, so alerting can't break a rank check.
 */
export async function evaluateRankAlerts(
  tenantId: string,
  keywordId: string,
  currentRank: number | null,
): Promise<void> {
  try {
    const rules = await prisma.gmbRankAlertRule.findMany({
      where: { tenantId, keywordId, isActive: true },
    });
    if (rules.length === 0) return;

    // Second-newest snapshot = the state before this check.
    const prior = await prisma.gmbRankSnapshot.findMany({
      where: { keywordId },
      orderBy: { checkedAt: "desc" },
      skip: 1,
      take: 1,
      select: { rank: true },
    });
    const previousRank = prior.length > 0 ? prior[0].rank : undefined;

    for (const rule of rules) {
      if (
        !shouldTriggerRankAlert({
          previousRank,
          currentRank,
          thresholdRank: rule.thresholdRank,
        })
      ) {
        continue;
      }
      const kw = await prisma.gmbTrackedKeyword.findUnique({
        where: { id: keywordId },
        select: { keyword: true },
      });
      await prisma.gmbRankAlertRule.update({
        where: { id: rule.id },
        data: { lastTriggeredAt: new Date(), lastTriggeredRank: currentRank },
      });
      if (rule.notifyEmail) {
        const rankLabel = currentRank === null ? "not found in results" : `#${currentRank}`;
        try {
          await sendEmail({
            to: rule.notifyEmail,
            subject: `Rank alert: "${kw?.keyword ?? "keyword"}" dropped to ${rankLabel}`,
            text: [
              `Your tracked keyword "${kw?.keyword ?? keywordId}" just crossed its alert threshold.`,
              ``,
              `Current position: ${rankLabel}`,
              `Alert threshold: top ${rule.thresholdRank}`,
              ``,
              `Open the GMB Suite ranking page to see the trend and grid heat-map.`,
            ].join("\n"),
          });
        } catch (err) {
          console.warn(
            "[gmb-rank-alert] email notify failed (alert still recorded):",
            (err as Error).message,
          );
        }
      }
    }
  } catch (err) {
    console.error("[gmb-rank-alert] evaluation failed:", (err as Error).message);
  }
}
