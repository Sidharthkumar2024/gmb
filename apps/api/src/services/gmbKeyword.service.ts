import { prisma, Prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { GMB_PROMPT_KEYS, keywordIdeasVariables, resolveFeaturePrompt } from "./gmbAiPrompts.service";
import { runTenantLlmJson } from "./ai.service";

// =====================================================================
// AdGrowly GMB — AI Keyword Finder (planning PDF §2). Generates local-SEO
// keyword ideas from category + city + services + competitors using
// deterministic local-intent patterns (LLM-swappable later, same contract).
// Chosen ideas feed the ranking tracker via the existing /keywords endpoint.
// The generation engine is pure and unit-tested; idea sets are stored as JSON.
// =====================================================================

export type KeywordKind = "category" | "service" | "city" | "competitor" | "long_tail";

export interface KeywordIdea {
  keyword: string;
  kind: KeywordKind;
  score: number;
}

export interface KeywordInput {
  category?: string;
  city?: string;
  region?: string;
  services?: string[];
  competitors?: string[];
  seedKeywords?: string[];
  limit?: number;
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * Generate ranked local-SEO keyword ideas. Deterministic: the same input
 * always yields the same set. Scores encode local intent (city + service
 * combinations rank highest; bare category lowest). De-duplicated
 * case-insensitively, keeping the highest score for each keyword.
 */
export function generateKeywordIdeas(input: KeywordInput): KeywordIdea[] {
  const byKey = new Map<string, KeywordIdea>();
  const add = (raw: string, kind: KeywordKind, score: number) => {
    const keyword = clean(raw);
    if (!keyword) return;
    const key = keyword.toLowerCase();
    const existing = byKey.get(key);
    if (!existing || score > existing.score) byKey.set(key, { keyword, kind, score });
  };

  const category = input.category ? clean(input.category) : "";
  const city = input.city ? clean(input.city) : "";
  const region = input.region ? clean(input.region) : "";
  const services = (input.services ?? []).map(clean).filter(Boolean);
  const competitors = (input.competitors ?? []).map(clean).filter(Boolean);
  const seeds = (input.seedKeywords ?? []).map(clean).filter(Boolean);

  const baseTerms = services.length ? services : category ? [category] : [];
  const baseKind: KeywordKind = services.length ? "service" : "category";

  for (const term of baseTerms) {
    add(term, baseKind, 40);
    add(`${term} near me`, "long_tail", 70);
    if (city) {
      add(`${term} in ${city}`, "city", 90);
      add(`best ${term} in ${city}`, "long_tail", 85);
      add(`${term} ${city}`, "city", 80);
      add(`affordable ${term} in ${city}`, "long_tail", 75);
    }
    if (region && region.toLowerCase() !== city.toLowerCase()) {
      add(`${term} ${region}`, "city", 60);
    }
  }

  if (category) {
    add(category, "category", 35);
    if (city) {
      add(`${category} ${city}`, "city", 78);
      add(`${category} services in ${city}`, "long_tail", 72);
    }
  }

  for (const c of competitors) {
    add(`${c} alternative`, "competitor", 65);
    add(`${c} vs`, "competitor", 50);
    if (city) add(`${c} ${city}`, "competitor", 55);
  }

  for (const s of seeds) add(s, "long_tail", 45);

  const ideas = [...byKey.values()].sort(
    (a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword),
  );
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  return ideas.slice(0, limit);
}

const KEYWORD_KINDS = new Set<KeywordKind>(["category", "service", "city", "competitor", "long_tail"]);

/**
 * Validate + normalize LLM-suggested ideas into the KeywordIdea contract:
 * trims keywords, drops empties, maps unknown kinds to long_tail, clamps
 * scores to 0–100 (default 50), dedupes case-insensitively keeping the
 * highest score, sorts by score, and caps at limit. Pure.
 */
export function sanitizeAiIdeas(
  raw: Array<{ keyword?: unknown; kind?: unknown; score?: unknown }> | undefined,
  limit: number,
): KeywordIdea[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, KeywordIdea>();
  for (const item of raw) {
    const keyword = typeof item?.keyword === "string" ? clean(item.keyword) : "";
    if (!keyword) continue;
    const kind = KEYWORD_KINDS.has(item?.kind as KeywordKind) ? (item.kind as KeywordKind) : "long_tail";
    const n = Number(item?.score);
    const score = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
    const key = keyword.toLowerCase();
    const existing = byKey.get(key);
    if (!existing || score > existing.score) byKey.set(key, { keyword, kind, score });
  }
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword))
    .slice(0, Math.min(Math.max(limit, 1), 200));
}

/**
 * Generate keyword ideas with the live LLM gateway, driven by the Super-Admin's
 * `gmb.keyword_finder` prompt (or its seed). Any failure — no provider key,
 * insufficient credits, provider/parse error, or an empty/unusable response —
 * falls back to the deterministic engine so the finder never breaks.
 */
export async function draftKeywordIdeasWithAi(
  tenantId: string,
  input: KeywordInput,
): Promise<{ ideas: KeywordIdea[]; source: "ai" | "template" }> {
  const fallback = generateKeywordIdeas(input);
  try {
    const resolved = await resolveFeaturePrompt(GMB_PROMPT_KEYS.keywordIdeas, keywordIdeasVariables(input));
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const extras = [
      input.region ? `Region: ${input.region}.` : "",
      input.competitors?.length ? `Competitors: ${input.competitors.join(", ")}.` : "",
      input.seedKeywords?.length ? `Seed keywords: ${input.seedKeywords.join(", ")}.` : "",
    ].filter(Boolean);
    const out = await runTenantLlmJson<{ ideas: Array<{ keyword?: string; kind?: string; score?: number }> }>({
      tenantId,
      feature: "gmb_keyword_finder",
      system:
        "You are a local-SEO strategist for Google Business Profiles. Suggest realistic, high-intent local search keywords only.",
      prompt: `${resolved.text}\n${extras.join("\n")}\nReturn JSON: {"ideas":[{"keyword":"...","kind":"category|service|city|competitor|long_tail","score":0-100}]} — up to ${limit} ideas, highest local intent first.`,
      maxTokens: 900,
      temperature: 0.6,
    });
    const ideas = sanitizeAiIdeas(out?.ideas, limit);
    if (ideas.length === 0) return { ideas: fallback, source: "template" };
    return { ideas, source: "ai" };
  } catch {
    return { ideas: fallback, source: "template" };
  }
}

interface IdeaSetRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  category: string | null;
  city: string | null;
  region: string | null;
  services: string[];
  competitors: string[];
  ideas: Prisma.JsonValue;
  createdAt: Date;
}

export interface KeywordCluster {
  kind: KeywordKind;
  count: number;
  topKeywords: string[];
}

// Order clusters by local-SEO priority (service/city intent first, bare category last).
const CLUSTER_ORDER: KeywordKind[] = ["service", "city", "long_tail", "competitor", "category"];

/**
 * Group keyword ideas by kind with a count and the highest-scoring examples
 * (up to 5 each). Turns a flat list of 50 keywords into an at-a-glance strategy
 * view — "12 city-targeted, 8 long-tail, 5 competitor". Pure + deterministic.
 */
export function clusterKeywordIdeas(ideas: KeywordIdea[]): KeywordCluster[] {
  const byKind = new Map<KeywordKind, KeywordIdea[]>();
  for (const idea of ideas) {
    const list = byKind.get(idea.kind);
    if (list) list.push(idea);
    else byKind.set(idea.kind, [idea]);
  }
  const clusters: KeywordCluster[] = [];
  for (const kind of CLUSTER_ORDER) {
    const list = byKind.get(kind);
    if (!list || list.length === 0) continue;
    const topKeywords = [...list]
      .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword))
      .slice(0, 5)
      .map((i) => i.keyword);
    clusters.push({ kind, count: list.length, topKeywords });
  }
  return clusters;
}

export function toSafeIdeaSet(row: IdeaSetRow) {
  const ideas = Array.isArray(row.ideas) ? (row.ideas as unknown as KeywordIdea[]) : [];
  return {
    id: row.id,
    locationId: row.locationId,
    category: row.category,
    city: row.city,
    region: row.region,
    services: row.services,
    competitors: row.competitors,
    ideas,
    count: ideas.length,
    clusters: clusterKeywordIdeas(ideas),
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

export interface CreateIdeaSetInput extends KeywordInput {
  locationId?: string;
  createdByUserId?: string;
}

export async function createIdeaSet(tenantId: string, input: CreateIdeaSetInput) {
  const ideas = generateKeywordIdeas(input);
  if (ideas.length === 0) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Provide a category or at least one service to generate keyword ideas.",
    );
  }
  const row = await prisma.gmbKeywordIdeaSet.create({
    data: {
      tenantId,
      locationId: input.locationId?.trim() || null,
      category: input.category?.trim() || null,
      city: input.city?.trim() || null,
      region: input.region?.trim() || null,
      services: (input.services ?? []).map((s) => s.trim()).filter(Boolean),
      competitors: (input.competitors ?? []).map((s) => s.trim()).filter(Boolean),
      ideas: ideas as unknown as Prisma.InputJsonValue,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeIdeaSet(row);
}

export async function listIdeaSets(tenantId: string, locationId?: string) {
  const rows = await prisma.gmbKeywordIdeaSet.findMany({
    where: { tenantId, ...(locationId ? { locationId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSafeIdeaSet);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbKeywordIdeaSet.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Keyword idea set not found.");
  return row;
}

export async function getIdeaSet(tenantId: string, id: string) {
  return toSafeIdeaSet(await findOwnedOrThrow(tenantId, id));
}

export async function deleteIdeaSet(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  await prisma.gmbKeywordIdeaSet.delete({ where: { id } });
}
