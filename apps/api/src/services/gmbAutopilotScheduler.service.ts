// ============================================================================
// GMB autopilot scheduler — makes the "auto-draft, you approve" loop AUTOMATIC.
//
// The autopilot drafting services (draftAutopilotPosts, draftPendingReview
// replies) already exist and are tested; this worker fires them on a cadence
// for tenants who opted in (GmbAutopilotConfig.enabled). Nothing is published —
// posts land in PENDING_APPROVAL and reply drafts stay NEW, so the operator
// still approves. Uses its OWN dedicated queue (like gmbReportScheduler), NOT a
// piggyback — multiple competing workers on one queue would let a sweep job be
// consumed by the wrong worker and silently skipped.
// ============================================================================

import { Worker } from "bullmq";
import { prisma } from "@nexaflow/db";
import {
  getQueueConnection,
  getGmbAutopilotQueue,
  QueueNames,
  trackWorker,
  type GmbAutopilotJobData,
} from "../lib/queue";
import { draftAutopilotPosts, draftPendingReviewReplies } from "./gmbAutopilot.service";

const SWEEP_INTERVAL_MS = Number(
  process.env.GMB_AUTOPILOT_INTERVAL_MS ?? `${60 * 60 * 1000}`,
); // check hourly; each tenant fires only when its own cadence elapsed
const SWEEP_JOB_NAME = "sweep";
const MAX_TENANTS_PER_SWEEP = 500;

/** Pure: has `cadenceHours` elapsed since the last run? A null lastRunAt is due. */
export function isAutopilotDue(now: Date, cadenceHours: number, lastRunAt: Date | null): boolean {
  if (!lastRunAt) return true;
  return now.getTime() - lastRunAt.getTime() >= Math.max(1, cadenceHours) * 60 * 60 * 1000;
}

export interface AutopilotSweepSummary {
  due: number;
  postsDrafted: number;
  repliesDrafted: number;
  failed: number;
}

/** One pass: draft posts (+ optional review replies) for every opted-in tenant
 *  whose cadence has elapsed. Exported for tests + a manual "run now". */
export async function sweepGmbAutopilot(now = new Date()): Promise<AutopilotSweepSummary> {
  const configs = await prisma.gmbAutopilotConfig.findMany({
    where: { enabled: true },
    take: MAX_TENANTS_PER_SWEEP,
    orderBy: { lastRunAt: "asc" }, // stalest first
  });

  const summary: AutopilotSweepSummary = { due: 0, postsDrafted: 0, repliesDrafted: 0, failed: 0 };
  for (const cfg of configs) {
    if (!isAutopilotDue(now, cfg.cadenceHours, cfg.lastRunAt)) continue;
    summary.due += 1;
    try {
      const posts = await draftAutopilotPosts(cfg.tenantId, {
        businessName: cfg.businessName,
        niche: cfg.niche,
        tone: cfg.tone,
        count: cfg.postsPerRun,
      });
      summary.postsDrafted += posts.length;
      if (cfg.autoDraftReplies) {
        const r = await draftPendingReviewReplies(cfg.tenantId, {
          tone: cfg.replyTone === "professional" ? "professional" : "warm",
        });
        summary.repliesDrafted += r.drafted;
      }
      await prisma.gmbAutopilotConfig.update({
        where: { tenantId: cfg.tenantId },
        data: { lastRunAt: now },
      });
    } catch (err) {
      console.error(`[gmb-autopilot] tenant ${cfg.tenantId} sweep failed:`, (err as Error).message);
      summary.failed += 1;
    }
  }
  return summary;
}

export interface SafeAutopilotConfig {
  enabled: boolean;
  businessName: string;
  niche: string;
  tone: string;
  postsPerRun: number;
  cadenceHours: number;
  autoDraftReplies: boolean;
  replyTone: string;
  lastRunAt: Date | null;
}

const DEFAULT_CONFIG: SafeAutopilotConfig = {
  enabled: false,
  businessName: "",
  niche: "general",
  tone: "friendly",
  postsPerRun: 3,
  cadenceHours: 168,
  autoDraftReplies: true,
  replyTone: "warm",
  lastRunAt: null,
};

export async function getAutopilotConfig(tenantId: string): Promise<SafeAutopilotConfig> {
  const row = await prisma.gmbAutopilotConfig.findUnique({ where: { tenantId } });
  if (!row) return { ...DEFAULT_CONFIG };
  return {
    enabled: row.enabled,
    businessName: row.businessName,
    niche: row.niche,
    tone: row.tone,
    postsPerRun: row.postsPerRun,
    cadenceHours: row.cadenceHours,
    autoDraftReplies: row.autoDraftReplies,
    replyTone: row.replyTone,
    lastRunAt: row.lastRunAt,
  };
}

export interface SaveAutopilotInput {
  enabled: boolean;
  businessName: string;
  niche?: string;
  tone?: string;
  postsPerRun?: number;
  cadenceHours?: number;
  autoDraftReplies?: boolean;
  replyTone?: string;
}

export async function saveAutopilotConfig(
  tenantId: string,
  input: SaveAutopilotInput,
): Promise<SafeAutopilotConfig> {
  const data = {
    enabled: input.enabled,
    businessName: input.businessName.trim(),
    niche: input.niche?.trim() || "general",
    tone: input.tone?.trim() || "friendly",
    postsPerRun: Math.min(14, Math.max(1, input.postsPerRun ?? 3)),
    cadenceHours: Math.min(720, Math.max(1, input.cadenceHours ?? 168)),
    autoDraftReplies: input.autoDraftReplies ?? true,
    replyTone: input.replyTone?.trim() || "warm",
  };
  const row = await prisma.gmbAutopilotConfig.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  return getAutopilotConfig(row.tenantId);
}

let gmbAutopilotWorker: Worker<GmbAutopilotJobData> | null = null;

export async function startGmbAutopilotWorker(): Promise<void> {
  if (gmbAutopilotWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[gmb-autopilot] database unavailable; worker not started.");
    return;
  }

  const q = getGmbAutopilotQueue();
  try {
    await q.removeJobScheduler(SWEEP_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SWEEP_JOB_NAME,
      { every: SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: { kind: "sweep" } },
    );
  } catch (err) {
    console.warn("[gmb-autopilot] could not register scheduler:", (err as Error).message);
    return;
  }

  gmbAutopilotWorker = new Worker<GmbAutopilotJobData>(
    QueueNames.GMB_AUTOPILOT,
    async () => {
      const s = await sweepGmbAutopilot();
      if (s.due > 0) {
        console.log(
          `[gmb-autopilot] swept ${s.due} tenant(s): ${s.postsDrafted} posts, ${s.repliesDrafted} replies drafted, ${s.failed} failed`,
        );
      }
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
  gmbAutopilotWorker.on("failed", (job, err) => {
    console.error(`[gmb-autopilot] job ${job?.id} failed:`, err?.message);
  });
  gmbAutopilotWorker.on("error", (err) => {
    console.error("[gmb-autopilot] worker error:", err.message);
  });
  trackWorker(gmbAutopilotWorker);
}

export function stopGmbAutopilotWorker(): void {
  if (!gmbAutopilotWorker) return;
  void gmbAutopilotWorker.close();
  gmbAutopilotWorker = null;
}
