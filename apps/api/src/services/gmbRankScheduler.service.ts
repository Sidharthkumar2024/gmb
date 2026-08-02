import { Worker } from "bullmq";
import { prisma } from "@nexaflow/db";
import {
  getGmbRankScheduleQueue,
  getQueueConnection,
  QueueNames,
  trackWorker,
  type GmbRankScheduleJobData,
} from "../lib/queue";
import { captureKeywordRank } from "./gmbGridRank.service";

const SWEEP_INTERVAL_MS = Number(process.env.GMB_RANK_SCHEDULE_INTERVAL_MS ?? 60 * 60 * 1000);
const SWEEP_JOB_NAME = "sweep";

export function isRankScheduleDue(now: Date, cadenceHours: number, lastRunAt: Date | null): boolean {
  return !lastRunAt || now.getTime() - lastRunAt.getTime() >= cadenceHours * 60 * 60 * 1000;
}

export async function getRankSchedule(tenantId: string) {
  const row = await prisma.gmbRankSchedule.findUnique({ where: { tenantId } });
  return {
    enabled: row?.enabled ?? false,
    cadenceHours: row?.cadenceHours ?? 24,
    lastRunAt: row?.lastRunAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

export async function setRankSchedule(tenantId: string, input: { enabled: boolean; cadenceHours: number }) {
  const row = await prisma.gmbRankSchedule.upsert({
    where: { tenantId },
    create: { tenantId, enabled: input.enabled, cadenceHours: input.cadenceHours },
    update: { enabled: input.enabled, cadenceHours: input.cadenceHours },
  });
  return { enabled: row.enabled, cadenceHours: row.cadenceHours, lastRunAt: row.lastRunAt, lastError: row.lastError };
}

export async function sweepScheduledRanks(now = new Date()) {
  const schedules = await prisma.gmbRankSchedule.findMany({
    where: { enabled: true },
    take: 500,
  });
  const result = { due: 0, captured: 0, failed: 0 };
  for (const schedule of schedules) {
    if (!isRankScheduleDue(now, schedule.cadenceHours, schedule.lastRunAt)) continue;
    result.due += 1;
    let lastError: string | null = null;
    const keywords = await prisma.gmbTrackedKeyword.findMany({
      where: { tenantId: schedule.tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true },
    });
    for (const keyword of keywords) {
      try {
        await captureKeywordRank(schedule.tenantId, keyword.id);
        result.captured += 1;
      } catch (err) {
        result.failed += 1;
        lastError = err instanceof Error ? err.message.slice(0, 500) : "Rank capture failed.";
      }
    }
    await prisma.gmbRankSchedule.update({
      where: { tenantId: schedule.tenantId },
      data: { lastRunAt: now, lastError },
    });
  }
  return result;
}

let worker: Worker<GmbRankScheduleJobData> | null = null;

export async function startGmbRankScheduleWorker(): Promise<void> {
  if (worker) return;
  try { await prisma.$queryRaw`SELECT 1`; } catch { return; }
  const queue = getGmbRankScheduleQueue();
  await queue.removeJobScheduler(SWEEP_JOB_NAME).catch(() => undefined);
  await queue.upsertJobScheduler(
    SWEEP_JOB_NAME,
    { every: SWEEP_INTERVAL_MS },
    { name: SWEEP_JOB_NAME, data: { kind: "sweep" } },
  );
  worker = new Worker<GmbRankScheduleJobData>(
    QueueNames.GMB_RANK_SCHEDULE,
    async () => { await sweepScheduledRanks(); },
    { connection: getQueueConnection(), concurrency: 1 },
  );
  worker.on("error", (err) => console.error("[gmb-rank-schedule] worker error:", err.message));
  trackWorker(worker);
}

export function stopGmbRankScheduleWorker(): void {
  if (worker) {
    void worker.close();
    worker = null;
  }
}
