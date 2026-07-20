import { prisma, Prisma, GmbDescriptionTarget, GmbDescriptionStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { GMB_PROMPT_KEYS, descriptionVariables, resolveFeaturePrompt } from "./gmbAiPrompts.service";
import { runTenantLlmJson } from "./ai.service";

// =====================================================================
// AdGrowly GMB — AI Description Optimizer (planning PDF §2). Improves a
// business/service/product description against target keywords and a character
// limit. The analyze + optimize engine is pure and deterministic (LLM-swappable
// later); generate-then-approve drafts are stored with their analysis.
// =====================================================================

export interface KeywordStat {
  keyword: string;
  count: number;
  present: boolean;
  density: number;
}

export interface DescriptionAnalysis {
  length: number;
  wordCount: number;
  withinLimit: boolean;
  keywords: KeywordStat[];
  missingKeywords: string[];
  issues: string[];
}

const collapse = (s: string) => s.trim().replace(/\s+/g, " ");

/** Analyze a description for length, keyword presence/density and issues. */
export function analyzeDescription(
  text: string,
  opts: { keywords?: string[]; maxLength?: number } = {},
): DescriptionAnalysis {
  const value = collapse(text);
  const length = value.length;
  const words = value ? value.split(/\s+/) : [];
  const wordCount = words.length;
  const lower = value.toLowerCase();
  const keywordList = (opts.keywords ?? []).map((k) => k.trim()).filter(Boolean);

  const keywords: KeywordStat[] = keywordList.map((keyword) => {
    const needle = keyword.toLowerCase();
    const count = needle ? lower.split(needle).length - 1 : 0;
    return {
      keyword,
      count,
      present: count > 0,
      density: wordCount ? Math.round((count / wordCount) * 10000) / 10000 : 0,
    };
  });

  const missingKeywords = keywords.filter((k) => !k.present).map((k) => k.keyword);

  const issues: string[] = [];
  if (opts.maxLength && length > opts.maxLength) {
    issues.push(`Exceeds the ${opts.maxLength}-character limit by ${length - opts.maxLength}.`);
  }
  if (missingKeywords.length) issues.push(`Missing keyword(s): ${missingKeywords.join(", ")}.`);
  if (length > 0 && length < 50) issues.push("Description is very short (under 50 characters).");

  return {
    length,
    wordCount,
    withinLimit: opts.maxLength ? length <= opts.maxLength : true,
    keywords,
    missingKeywords,
    issues,
  };
}

export interface DescriptionScore {
  score: number;
  /** Share of tracked keywords present, 0–1 (1 when none are tracked). */
  keywordCoverage: number;
  lengthOk: boolean;
  issues: number;
}

/**
 * 0–100 quality score for a description analysis: keyword coverage (60),
 * a healthy length within the limit (25), and being issue-free (15). Pure —
 * gives the optimizer UI a single headline number.
 */
export function scoreDescription(a: DescriptionAnalysis): DescriptionScore {
  const total = a.keywords.length;
  const present = a.keywords.filter((k) => k.present).length;
  const keywordCoverage = total > 0 ? present / total : 1;
  const lengthOk = a.length >= 50 && a.withinLimit;
  const raw = keywordCoverage * 60 + (lengthOk ? 25 : 0) + (a.issues.length === 0 ? 15 : 0);
  return {
    score: Math.max(0, Math.min(100, Math.round(raw))),
    keywordCoverage: Math.round(keywordCoverage * 100) / 100,
    lengthOk,
    issues: a.issues.length,
  };
}

export interface OptimizeInput {
  text: string;
  keywords?: string[];
  maxLength?: number;
  businessName?: string;
  tone?: "professional" | "friendly";
}

function truncateAtWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Deterministically optimize a description: normalize whitespace, capitalize,
 * weave in missing keywords, ensure terminal punctuation, and enforce the
 * character limit. Returns the optimized text, a before/after-style analysis,
 * and a list of changes applied.
 */
export function optimizeDescription(input: OptimizeInput): {
  optimized: string;
  analysis: DescriptionAnalysis;
  changes: string[];
  score: DescriptionScore;
} {
  const changes: string[] = [];
  let out = collapse(input.text);

  if (out && out[0] !== out[0].toUpperCase()) {
    out = out[0].toUpperCase() + out.slice(1);
    changes.push("Capitalized the opening.");
  }

  const missing = analyzeDescription(out, { keywords: input.keywords }).missingKeywords;
  if (missing.length) {
    const lead = input.businessName?.trim()
      ? `${input.businessName.trim()} offers`
      : input.tone === "friendly"
        ? "We happily offer"
        : "We offer";
    out = `${out} ${lead} ${missing.join(", ")}.`.trim();
    changes.push(`Added missing keyword(s): ${missing.join(", ")}.`);
  }

  if (out && !/[.!?]$/.test(out)) {
    out += ".";
    changes.push("Added terminal punctuation.");
  }

  if (input.maxLength && out.length > input.maxLength) {
    out = truncateAtWord(out, input.maxLength);
    changes.push(`Trimmed to the ${input.maxLength}-character limit.`);
  }

  const analysis = analyzeDescription(out, { keywords: input.keywords, maxLength: input.maxLength });
  return {
    optimized: out,
    analysis,
    changes,
    score: scoreDescription(analysis),
  };
}

/**
 * Optimize with the live LLM gateway, driven by the Super-Admin's
 * `gmb.description_optimizer` prompt (or its seed). The deterministic
 * analyzer + quality score still measure the AI's output, so the headline
 * number stays objective. Any failure falls back to the deterministic
 * optimizer — the feature never breaks.
 */
export async function optimizeDescriptionWithAi(
  tenantId: string,
  input: OptimizeInput,
): Promise<ReturnType<typeof optimizeDescription> & { source: "ai" | "template" }> {
  const fallback = { ...optimizeDescription(input), source: "template" as const };
  try {
    const resolved = await resolveFeaturePrompt(
      GMB_PROMPT_KEYS.description,
      descriptionVariables({ businessName: input.businessName ?? "", keywords: input.keywords }),
    );
    const limit = input.maxLength ?? 750;
    const out = await runTenantLlmJson<{ description: string }>({
      tenantId,
      feature: "gmb_description_optimizer",
      system:
        "You optimize Google Business Profile descriptions. Use keywords naturally (no stuffing), write in first person plural, no URLs or phone numbers, stay within the character limit.",
      prompt: `${resolved.text}\nCurrent description: ${collapse(input.text)}\nTone: ${input.tone ?? "professional"}. Hard limit: ${limit} characters.\nReturn JSON: {"description":"..."}`,
      maxTokens: 500,
      temperature: 0.7,
    });
    let optimized = collapse(out?.description ?? "");
    if (!optimized) return fallback;
    const changes = ["Rewritten by AI using the admin's description prompt."];
    if (input.maxLength && optimized.length > input.maxLength) {
      optimized = truncateAtWord(optimized, input.maxLength);
      changes.push(`Trimmed to the ${input.maxLength}-character limit.`);
    }
    const analysis = analyzeDescription(optimized, { keywords: input.keywords, maxLength: input.maxLength });
    return { optimized, analysis, changes, score: scoreDescription(analysis), source: "ai" };
  } catch {
    return fallback;
  }
}

interface DescriptionRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  target: GmbDescriptionTarget;
  label: string | null;
  original: string;
  optimized: string | null;
  keywords: string[];
  maxLength: number | null;
  analysis: Prisma.JsonValue | null;
  status: GmbDescriptionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export function toSafeDescription(row: DescriptionRow) {
  return {
    id: row.id,
    locationId: row.locationId,
    target: row.target,
    label: row.label,
    original: row.original,
    optimized: row.optimized,
    keywords: row.keywords,
    maxLength: row.maxLength,
    analysis: row.analysis,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

export interface CreateDescriptionInput {
  target?: GmbDescriptionTarget;
  label?: string;
  original: string;
  keywords?: string[];
  maxLength?: number;
  businessName?: string;
  tone?: "professional" | "friendly";
  locationId?: string;
  createdByUserId?: string;
}

export async function createDescription(tenantId: string, input: CreateDescriptionInput) {
  if (!input.original.trim()) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A description to optimize is required.");
  }
  const keywords = (input.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const result = optimizeDescription({
    text: input.original,
    keywords,
    maxLength: input.maxLength,
    businessName: input.businessName,
    tone: input.tone,
  });

  const row = await prisma.gmbDescription.create({
    data: {
      tenantId,
      locationId: input.locationId?.trim() || null,
      target: input.target ?? GmbDescriptionTarget.BUSINESS,
      label: input.label?.trim() || null,
      original: input.original.trim(),
      optimized: result.optimized,
      keywords,
      maxLength: input.maxLength ?? null,
      analysis: result.analysis as unknown as Prisma.InputJsonValue,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return { ...toSafeDescription(row), changes: result.changes };
}

export interface ListDescriptionsFilter {
  locationId?: string;
  status?: GmbDescriptionStatus;
  target?: GmbDescriptionTarget;
}

export async function listDescriptions(tenantId: string, filter: ListDescriptionsFilter = {}) {
  const rows = await prisma.gmbDescription.findMany({
    where: {
      tenantId,
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.target ? { target: filter.target } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSafeDescription);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbDescription.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Description not found.");
  return row;
}

export async function getDescription(tenantId: string, id: string) {
  return toSafeDescription(await findOwnedOrThrow(tenantId, id));
}

export interface UpdateDescriptionInput {
  optimized?: string;
  label?: string | null;
  status?: GmbDescriptionStatus;
}

export async function updateDescription(tenantId: string, id: string, input: UpdateDescriptionInput) {
  const current = await findOwnedOrThrow(tenantId, id);

  // If the operator hand-edits the optimized text, refresh its analysis.
  let analysis: Prisma.InputJsonValue | undefined;
  if (input.optimized !== undefined) {
    analysis = analyzeDescription(input.optimized, {
      keywords: current.keywords,
      maxLength: current.maxLength ?? undefined,
    }) as unknown as Prisma.InputJsonValue;
  }

  const row = await prisma.gmbDescription.update({
    where: { id },
    data: {
      ...(input.optimized !== undefined ? { optimized: input.optimized } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(analysis !== undefined ? { analysis } : {}),
    },
  });
  return toSafeDescription(row);
}

export async function deleteDescription(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  await prisma.gmbDescription.delete({ where: { id } });
}
