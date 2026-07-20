import { prisma } from "@nexaflow/db";

// =====================================================================
// GMB schema self-check (diagnostic for the exact failure mode where a new
// image ships a Prisma client ahead of the database — un-applied migrations
// make GMB endpoints throw at runtime). Probes every GMB table with a cheap
// `findFirst()` (LIMIT 1, all scalar columns) so a MISSING TABLE *or* MISSING
// COLUMN surfaces as a clear per-table error instead of a generic 500 later.
// Returns only ok/error flags — never row data — so it leaks nothing.
// =====================================================================

export interface GmbTableCheck {
  table: string;
  ok: boolean;
  error?: string;
}

export interface GmbHealthResult {
  ok: boolean;
  healthy: number;
  total: number;
  checks: GmbTableCheck[];
}

/** Pure: roll table-level probe results into an overall verdict. */
export function summarizeGmbHealth(checks: GmbTableCheck[]): Omit<GmbHealthResult, "checks"> {
  const healthy = checks.filter((c) => c.ok).length;
  return { ok: checks.length > 0 && healthy === checks.length, healthy, total: checks.length };
}

// One probe per GMB model. findFirst() (not count) so a dropped/renamed column
// also trips the check, not just a missing table.
const PROBES: Array<{ table: string; run: () => Promise<unknown> }> = [
  { table: "GmbLocation", run: () => prisma.gmbLocation.findFirst() },
  { table: "GmbReview", run: () => prisma.gmbReview.findFirst() },
  { table: "GmbTrackedKeyword", run: () => prisma.gmbTrackedKeyword.findFirst() },
  { table: "GmbRankSnapshot", run: () => prisma.gmbRankSnapshot.findFirst() },
  { table: "GmbInsightSnapshot", run: () => prisma.gmbInsightSnapshot.findFirst() },
  { table: "GmbCitation", run: () => prisma.gmbCitation.findFirst() },
  { table: "GmbPost", run: () => prisma.gmbPost.findFirst() },
  { table: "GmbReport", run: () => prisma.gmbReport.findFirst() },
  { table: "GmbKeywordIdeaSet", run: () => prisma.gmbKeywordIdeaSet.findFirst() },
  { table: "GmbDescription", run: () => prisma.gmbDescription.findFirst() },
  { table: "GmbAdvisorReport", run: () => prisma.gmbAdvisorReport.findFirst() },
  { table: "GmbImageRequest", run: () => prisma.gmbImageRequest.findFirst() },
];

/** Probe every GMB table; report which are reachable and which error (drift). */
export async function checkGmbSchema(): Promise<GmbHealthResult> {
  const checks: GmbTableCheck[] = [];
  for (const p of PROBES) {
    try {
      await p.run();
      checks.push({ table: p.table, ok: true });
    } catch (e) {
      checks.push({
        table: p.table,
        ok: false,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
    }
  }
  return { ...summarizeGmbHealth(checks), checks };
}
