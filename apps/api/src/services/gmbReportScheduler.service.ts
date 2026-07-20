import { Worker } from "bullmq";
import { prisma, GmbReportType } from "@nexaflow/db";
import {
  getQueueConnection,
  getGmbReportScheduleQueue,
  QueueNames,
  trackWorker,
  type GmbReportScheduleJobData,
} from "../lib/queue";
import { generateReport } from "./gmbReport.service";

// AdGrowly GMB — recurring report generator (planning PDF §2 "AI Monthly
// Report … frequency"). Opt-in per tenant (GmbReportSchedule.enabled, default
// off). A daily sweep generates the report for the just-finished period when
// one is due and stamps lastRunAt, so it runs at most once per period. Report
// generation reuses generateReport (deterministic narrative fallback when AI
// credits are unavailable), so it never hard-fails.

const SWEEP_INTERVAL_MS = Number(
  process.env.GMB_REPORT_SCHEDULE_INTERVAL_MS ?? `${6 * 60 * 60 * 1000}`,
); // every 6h by default
const SWEEP_JOB_NAME = "sweep";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Is a report due for `frequency` given the last run? Pure.
 * - MONTHLY: due when we haven't generated in the current calendar month (UTC).
 * - WEEKLY/CUSTOM: due when the last run was 7+ days ago.
 * A null lastRunAt is always due.
 */
export function isReportDue(now: Date, frequency: GmbReportType, lastRunAt: Date | null): boolean {
  if (!lastRunAt) return true;
  if (frequency === GmbReportType.MONTHLY) {
    return (
      lastRunAt.getUTCFullYear() !== now.getUTCFullYear() ||
      lastRunAt.getUTCMonth() !== now.getUTCMonth()
    );
  }
  return now.getTime() - lastRunAt.getTime() >= 7 * DAY_MS;
}

/**
 * The just-finished period to report on, as ISO strings. Pure (UTC).
 * - MONTHLY: the previous calendar month [first 00:00:00, last 23:59:59.999].
 * - WEEKLY/CUSTOM: the trailing 7 days ending now.
 */
export function reportPeriod(now: Date, frequency: GmbReportType): { periodStart: string; periodEnd: string } {
  if (frequency === GmbReportType.MONTHLY) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
    return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
  }
  const end = new Date(now.getTime());
  const start = new Date(now.getTime() - 7 * DAY_MS);
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

export interface ReportSweepResult {
  due: number;
  generated: number;
  failed: number;
}

/** Generate due reports for all opted-in tenants. */
export async function sweepScheduledReports(now = new Date()): Promise<ReportSweepResult> {
  const schedules = await prisma.gmbReportSchedule.findMany({
    where: { enabled: true },
    select: { tenantId: true, frequency: true, lastRunAt: true },
    take: 500,
  });

  const result: ReportSweepResult = { due: 0, generated: 0, failed: 0 };
  for (const s of schedules) {
    if (!isReportDue(now, s.frequency, s.lastRunAt)) continue;
    result.due += 1;
    const { periodStart, periodEnd } = reportPeriod(now, s.frequency);
    try {
      await generateReport(s.tenantId, { type: s.frequency, periodStart, periodEnd });
      await prisma.gmbReportSchedule.update({
        where: { tenantId: s.tenantId },
        data: { lastRunAt: now },
      });
      result.generated += 1;
    } catch (err) {
      console.error(`[gmb-report-schedule] tenant ${s.tenantId} report failed:`, (err as Error).message);
      result.failed += 1;
    }
  }
  return result;
}

export interface SafeReportSchedule {
  enabled: boolean;
  frequency: GmbReportType;
  lastRunAt: Date | null;
}

/** Read a tenant's schedule (defaults to disabled/monthly when none exists). */
export async function getReportSchedule(tenantId: string): Promise<SafeReportSchedule> {
  const row = await prisma.gmbReportSchedule.findUnique({ where: { tenantId } });
  return {
    enabled: row?.enabled ?? false,
    frequency: row?.frequency ?? GmbReportType.MONTHLY,
    lastRunAt: row?.lastRunAt ?? null,
  };
}

/** Upsert a tenant's schedule (enable/disable + cadence). */
export async function setReportSchedule(
  tenantId: string,
  input: { enabled: boolean; frequency?: GmbReportType },
): Promise<SafeReportSchedule> {
  const row = await prisma.gmbReportSchedule.upsert({
    where: { tenantId },
    create: { tenantId, enabled: input.enabled, frequency: input.frequency ?? GmbReportType.MONTHLY },
    update: { enabled: input.enabled, ...(input.frequency ? { frequency: input.frequency } : {}) },
  });
  return { enabled: row.enabled, frequency: row.frequency, lastRunAt: row.lastRunAt };
}

let gmbReportScheduleWorker: Worker<GmbReportScheduleJobData> | null = null;

export async function startGmbReportScheduleWorker(): Promise<void> {
  if (gmbReportScheduleWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[gmb-report-schedule] database unavailable; worker not started.");
    return;
  }

  const q = getGmbReportScheduleQueue();
  try {
    await q.removeJobScheduler(SWEEP_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SWEEP_JOB_NAME,
      { every: SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: { kind: "sweep" } },
    );
  } catch (err) {
    console.warn("[gmb-report-schedule] could not register sweep scheduler:", (err as Error).message);
    return;
  }

  gmbReportScheduleWorker = new Worker<GmbReportScheduleJobData>(
    QueueNames.GMB_REPORT_SCHEDULE,
    async () => {
      const r = await sweepScheduledReports();
      if (r.generated || r.failed) {
        console.log(`[gmb-report-schedule] sweep — due=${r.due} generated=${r.generated} failed=${r.failed}`);
      }
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );

  gmbReportScheduleWorker.on("failed", (job, err) => {
    console.error(`[gmb-report-schedule] job ${job?.id} failed:`, err?.message);
  });
  gmbReportScheduleWorker.on("error", (err) => {
    console.error("[gmb-report-schedule] worker error:", err.message);
  });

  trackWorker(gmbReportScheduleWorker);
}

export function stopGmbReportScheduleWorker(): void {
  if (gmbReportScheduleWorker) {
    void gmbReportScheduleWorker.close();
    gmbReportScheduleWorker = null;
  }
}
