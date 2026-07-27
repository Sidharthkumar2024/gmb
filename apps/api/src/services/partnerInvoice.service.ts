import { Worker } from "bullmq";
import { prisma, TenantType } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  getQueueConnection,
  getPartnerInvoiceQueue,
  QueueNames,
  trackWorker,
  type PartnerInvoiceJobData,
} from "../lib/queue";
import { getPartnerStatement, type PartnerStatement } from "./partnerBilling.service";

// Finalised partner invoices. A monthly job snapshots each partner's statement
// for the just-finished month into an immutable PartnerInvoice, so the document
// doesn't drift as later data changes. Finalisation is idempotent per
// (partner, year, month): re-running never creates a duplicate and never
// rewrites an already-finalised snapshot.

/** Stable invoice number derived from the period + partner id. */
function invoiceNumber(partnerTenantId: string, year: number, month: number): string {
  const suffix = partnerTenantId.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
  return `PINV-${year}${String(month).padStart(2, "0")}-${suffix}`;
}

export interface PartnerInvoiceView {
  id: string;
  number: string;
  year: number;
  month: number; // 1-based
  issuedAt: Date;
  statement: PartnerStatement;
}

function toView(row: {
  id: string;
  number: string;
  year: number;
  month: number;
  issuedAt: Date;
  snapshot: unknown;
}): PartnerInvoiceView {
  return {
    id: row.id,
    number: row.number,
    year: row.year,
    month: row.month,
    issuedAt: row.issuedAt,
    statement: row.snapshot as PartnerStatement,
  };
}

/**
 * Finalise one partner's invoice for a given month (month is 1-based). Computes
 * the statement for that period and stores it, idempotently. Returns the stored
 * (possibly pre-existing) invoice.
 */
export async function finalisePartnerInvoice(
  partnerTenantId: string,
  year: number,
  month: number,
): Promise<PartnerInvoiceView> {
  const existing = await prisma.partnerInvoice.findUnique({
    where: { partnerTenantId_year_month: { partnerTenantId, year, month } },
  });
  if (existing) return toView(existing); // immutable — keep the first finalisation

  const statement = await getPartnerStatement(partnerTenantId, { year, month0: month - 1 });
  const row = await prisma.partnerInvoice.create({
    data: {
      partnerTenantId,
      year,
      month,
      number: invoiceNumber(partnerTenantId, year, month),
      snapshot: statement as unknown as object,
    },
  });
  return toView(row);
}

export interface InvoiceSweepResult {
  partners: number;
  finalised: number;
  failed: number;
}

/**
 * Finalise the PREVIOUS calendar month's invoice for every partner. Runs at the
 * top of each month. Idempotent, so a repeated run in the same month is a no-op.
 */
export async function sweepPartnerInvoices(now = new Date()): Promise<InvoiceSweepResult> {
  // Previous month (UTC).
  const y = now.getUTCFullYear();
  const m0 = now.getUTCMonth();
  const prev = new Date(Date.UTC(y, m0 - 1, 1));
  const year = prev.getUTCFullYear();
  const month = prev.getUTCMonth() + 1; // 1-based

  const partners = await prisma.tenant.findMany({
    where: { type: TenantType.WHITE_LABEL },
    select: { id: true },
    take: 1000,
  });

  const result: InvoiceSweepResult = { partners: partners.length, finalised: 0, failed: 0 };
  for (const p of partners) {
    try {
      await finalisePartnerInvoice(p.id, year, month);
      result.finalised += 1;
    } catch (err) {
      console.error(`[partner-invoice] partner ${p.id} finalise failed:`, (err as Error).message);
      result.failed += 1;
    }
  }
  return result;
}

/** A partner's finalised invoices, newest first. Scoped to the partner. */
export async function listPartnerInvoices(partnerTenantId: string): Promise<PartnerInvoiceView[]> {
  const rows = await prisma.partnerInvoice.findMany({
    where: { partnerTenantId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 60,
  });
  return rows.map(toView);
}

/** One finalised invoice, scoped to the partner (404 if not theirs). */
export async function getPartnerInvoice(
  partnerTenantId: string,
  id: string,
): Promise<PartnerInvoiceView> {
  const row = await prisma.partnerInvoice.findFirst({ where: { id, partnerTenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Invoice not found.");
  return toView(row);
}

// --- Monthly worker ---------------------------------------------------------
// Sweeps once a day; the sweep itself only finalises the previous month and is
// idempotent, so running daily just means the invoice appears reliably soon
// after month close even if a single tick is missed.

const SWEEP_INTERVAL_MS = Number(
  process.env.PARTNER_INVOICE_INTERVAL_MS ?? `${24 * 60 * 60 * 1000}`,
);
const SWEEP_JOB_NAME = "sweep";

let partnerInvoiceWorker: Worker<PartnerInvoiceJobData> | null = null;

export async function startPartnerInvoiceWorker(): Promise<void> {
  if (partnerInvoiceWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[partner-invoice] database unavailable; worker not started.");
    return;
  }

  const q = getPartnerInvoiceQueue();
  try {
    await q.removeJobScheduler(SWEEP_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SWEEP_JOB_NAME,
      { every: SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: { kind: "sweep" } },
    );
  } catch (err) {
    console.warn("[partner-invoice] could not register sweep scheduler:", (err as Error).message);
    return;
  }

  partnerInvoiceWorker = new Worker<PartnerInvoiceJobData>(
    QueueNames.PARTNER_INVOICE,
    async () => {
      const r = await sweepPartnerInvoices();
      if (r.finalised || r.failed) {
        console.log(
          `[partner-invoice] sweep — partners=${r.partners} finalised=${r.finalised} failed=${r.failed}`,
        );
      }
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );

  partnerInvoiceWorker.on("failed", (job, err) => {
    console.error(`[partner-invoice] job ${job?.id} failed:`, err?.message);
  });
  partnerInvoiceWorker.on("error", (err) => {
    console.error("[partner-invoice] worker error:", err.message);
  });

  trackWorker(partnerInvoiceWorker);
}

export function stopPartnerInvoiceWorker(): void {
  if (partnerInvoiceWorker) {
    void partnerInvoiceWorker.close();
    partnerInvoiceWorker = null;
  }
}
