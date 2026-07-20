import { Worker } from "bullmq";
import { prisma, GmbPostStatus } from "@nexaflow/db";
import {
  getQueueConnection,
  getGmbPostPublisherQueue,
  QueueNames,
  trackWorker,
  type GmbPostPublisherJobData,
} from "../lib/queue";
import { publishDuePosts } from "./gmbScheduler.service";

// GMB scheduled-post publisher worker (planning PDF §3 Post Scheduler:
// "Queue system, scheduled posts, retry logic"). Sweeps every few minutes for
// tenants with due SCHEDULED posts and runs publishDuePosts per tenant —
// posts on Google-connected locations go live via the Business Profile API,
// the rest are recorded as local-only publishes. Failures land in FAILED on
// the post itself (set by publishDuePosts), so the next sweep retries nothing
// blindly and operators can see per-post reasons. The manual
// POST /gmb/posts/publish-due endpoint keeps working independently.

const SWEEP_INTERVAL_MS = Number(
  process.env.GMB_POST_PUBLISH_INTERVAL_MS ?? `${5 * 60 * 1000}`,
); // every 5 minutes by default
const SWEEP_JOB_NAME = "sweep";

export interface SweepResult {
  tenants: number;
  published: number;
  live: number;
  localOnly: number;
  failed: number;
}

/** Publish due posts across all tenants that have any. */
export async function sweepDueGmbPosts(now = new Date()): Promise<SweepResult> {
  const tenantRows = await prisma.gmbPost.findMany({
    where: { status: GmbPostStatus.SCHEDULED, scheduledAt: { lte: now } },
    select: { tenantId: true },
    distinct: ["tenantId"],
    take: 200,
  });

  const result: SweepResult = { tenants: 0, published: 0, live: 0, localOnly: 0, failed: 0 };
  for (const { tenantId } of tenantRows) {
    try {
      const r = await publishDuePosts(tenantId, now);
      result.tenants += 1;
      result.published += r.published;
      result.live += r.live;
      result.localOnly += r.localOnly;
      result.failed += r.failed;
    } catch (err) {
      console.error(`[gmb-post-publisher] tenant ${tenantId} sweep failed:`, (err as Error).message);
    }
  }
  return result;
}

let gmbPostPublisherWorker: Worker<GmbPostPublisherJobData> | null = null;

export async function startGmbPostPublisherWorker(): Promise<void> {
  if (gmbPostPublisherWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[gmb-post-publisher] database unavailable; worker not started.");
    return;
  }

  const q = getGmbPostPublisherQueue();
  try {
    await q.removeJobScheduler(SWEEP_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SWEEP_JOB_NAME,
      { every: SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: { kind: "sweep" } },
    );
  } catch (err) {
    console.warn(
      "[gmb-post-publisher] could not register sweep scheduler:",
      (err as Error).message,
    );
    return;
  }

  gmbPostPublisherWorker = new Worker<GmbPostPublisherJobData>(
    QueueNames.GMB_POST_PUBLISHER,
    async () => {
      const r = await sweepDueGmbPosts();
      if (r.published || r.failed) {
        console.log(
          `[gmb-post-publisher] sweep complete — tenants=${r.tenants} published=${r.published} (live=${r.live} local=${r.localOnly}) failed=${r.failed}`,
        );
      }
    },
    {
      connection: getQueueConnection(),
      concurrency: 1,
    },
  );

  gmbPostPublisherWorker.on("failed", (job, err) => {
    console.error(`[gmb-post-publisher] job ${job?.id} failed:`, err?.message);
  });
  gmbPostPublisherWorker.on("error", (err) => {
    console.error("[gmb-post-publisher] worker error:", err.message);
  });

  trackWorker(gmbPostPublisherWorker);
}

export function stopGmbPostPublisherWorker(): void {
  if (gmbPostPublisherWorker) {
    void gmbPostPublisherWorker.close();
    gmbPostPublisherWorker = null;
  }
}
