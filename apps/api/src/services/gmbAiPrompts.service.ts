import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { getTemplateByKey, renderPrompt, type PromptVars } from "./aiPromptTemplate.service";

// =====================================================================
// AdGrowly GMB — AI prompt binding (planning PDF: "no hardcoded AI prompts").
// Maps each AI feature to its admin-managed AiPromptTemplate key (module 6) and
// renders the template when one is configured + active, falling back to the
// feature's deterministic draft otherwise. This lets the GMB AI features pull
// their prompt from Super Admin without changing their route contracts. Pure +
// unit-tested; the LLM gateway call layers on top of `renderWithFallback`.
// =====================================================================

/** Canonical AiPromptTemplate keys per GMB AI feature (admin-curated). */
export const GMB_PROMPT_KEYS = {
  reviewReply: "gmb.review_reply",
  postCaption: "gmb.post_caption",
  description: "gmb.description_optimizer",
  keywordIdeas: "gmb.keyword_finder",
  rankingAdvice: "gmb.ranking_advisor",
  image: "gmb.image_generator",
  report: "gmb.report",
} as const;

export type GmbPromptKey = (typeof GMB_PROMPT_KEYS)[keyof typeof GMB_PROMPT_KEYS];

/** Variables for the `gmb.review_reply` template, derived from a review. */
export function reviewReplyVariables(input: {
  authorName?: string | null;
  rating: number;
  businessName: string;
  comment?: string | null;
}): PromptVars {
  const firstName = (input.authorName ?? "").trim().split(/\s+/)[0] || "there";
  return {
    author: firstName,
    rating: input.rating,
    business: input.businessName.trim() || "our team",
    comment: (input.comment ?? "").trim(),
  };
}

/** Variables for the `gmb.post_caption` template, derived from post inputs. */
export function postCaptionVariables(input: {
  businessName: string;
  topic?: string | null;
  tone?: string | null;
  niche?: string | null;
}): PromptVars {
  return {
    business: input.businessName.trim() || "our business",
    topic: (input.topic ?? "").trim(),
    tone: (input.tone ?? "friendly").trim(),
    niche: (input.niche ?? "").trim() || "local business",
  };
}

export interface PromptTemplateLike {
  template: string;
  isActive: boolean;
}

export interface RenderedPrompt {
  text: string;
  source: "template" | "fallback";
  missing: string[];
}

/**
 * Render the admin-managed template when it exists, is active and non-empty;
 * otherwise return the deterministic fallback the feature already produces.
 * `missing` lists placeholders left unfilled (caller may refuse to send).
 */
export function renderWithFallback(
  template: PromptTemplateLike | null | undefined,
  vars: PromptVars,
  fallback: string,
): RenderedPrompt {
  if (template && template.isActive && template.template.trim()) {
    const rendered = renderPrompt(template.template, vars);
    return { text: rendered.text, source: "template", missing: rendered.missing };
  }
  return { text: fallback, source: "fallback", missing: [] };
}

/** Variables for the `gmb.description_optimizer` template. */
export function descriptionVariables(input: {
  businessName: string;
  keywords?: string[];
}): PromptVars {
  return {
    business: input.businessName.trim() || "our business",
    keywords: (input.keywords ?? []).map((k) => k.trim()).filter(Boolean).join(", "),
  };
}

/** Variables for the `gmb.ranking_advisor` template. */
export function rankingAdviceVariables(input: { businessName?: string | null }): PromptVars {
  return { business: (input.businessName ?? "").trim() || "our business" };
}

/** Variables for the `gmb.report` template. */
export function reportVariables(input: { businessName?: string | null }): PromptVars {
  return { business: (input.businessName ?? "").trim() || "our business" };
}

/** Variables for the `gmb.keyword_finder` template. */
export function keywordIdeasVariables(input: {
  category?: string | null;
  city?: string | null;
  services?: string[];
}): PromptVars {
  return {
    category: (input.category ?? "").trim(),
    city: (input.city ?? "").trim(),
    services: (input.services ?? []).map((s) => s.trim()).filter(Boolean).join(", "),
  };
}

// Suggested starter templates per feature. Super Admin can adopt + edit these
// in AI Prompt Management — they are suggestions, not hardcoded runtime prompts
// (runtime still reads the admin's active AiPromptTemplate). Mirror the
// KNOWN_CREDIT_ACTIONS catalog pattern.
export const GMB_PROMPT_SEEDS: Record<GmbPromptKey, string> = {
  [GMB_PROMPT_KEYS.reviewReply]:
    "Hi {{author}}, thank you for your {{rating}}-star review of {{business}}. We appreciate your feedback and hope to welcome you again soon.",
  [GMB_PROMPT_KEYS.postCaption]:
    "Write a Google Business Profile post for {{business}}, a {{niche}}, about: {{topic}}. Use a {{tone}} tone and end with a clear invitation to act.",
  [GMB_PROMPT_KEYS.description]:
    "Write a compelling Google Business Profile description for {{business}}, naturally including: {{keywords}}.",
  [GMB_PROMPT_KEYS.keywordIdeas]:
    "List high-intent local SEO keywords for a {{category}} in {{city}} offering {{services}}.",
  [GMB_PROMPT_KEYS.rankingAdvice]:
    "Given this profile's gaps, suggest a prioritized weekly local-SEO task list for {{business}}.",
  [GMB_PROMPT_KEYS.image]:
    "A professional, brand-safe photo of {{subject}} for {{business}} in a {{style}} style.",
  [GMB_PROMPT_KEYS.report]:
    "Summarize this period's Google Business Profile performance for {{business}} with an action plan.",
};

/** The suggested starter template for a feature key. */
export function seedFor(key: GmbPromptKey): string {
  return GMB_PROMPT_SEEDS[key];
}

/** Seed catalog as a list for the admin UI: [{ key, template }]. */
export function listPromptSeeds(): { key: GmbPromptKey; template: string }[] {
  return (Object.keys(GMB_PROMPT_SEEDS) as GmbPromptKey[]).map((key) => ({ key, template: GMB_PROMPT_SEEDS[key] }));
}

/**
 * Pure prompt resolution: render the admin's active template when present and
 * non-empty, otherwise render the feature's seed with the same variables. The
 * fallback is the *rendered seed* (deterministic) — never a hardcoded runtime
 * string — and `missing` always reflects whichever text was chosen, so callers
 * can decide whether the prompt is complete enough to send. Separated from the
 * DB read below to keep it unit-testable.
 */
export function resolvePromptText(
  template: PromptTemplateLike | null | undefined,
  key: GmbPromptKey,
  vars: PromptVars,
): RenderedPrompt {
  if (template && template.isActive && template.template.trim()) {
    const rendered = renderPrompt(template.template, vars);
    return { text: rendered.text, source: "template", missing: rendered.missing };
  }
  const rendered = renderPrompt(seedFor(key), vars);
  return { text: rendered.text, source: "fallback", missing: rendered.missing };
}

/**
 * Resolve the final prompt for a GMB AI feature: load the Super-Admin's active
 * AiPromptTemplate for `key` (module 6) and render it with `vars`, falling back
 * to the rendered seed when none is configured. This is the seam an AI feature
 * calls before handing the prompt to the LLM gateway — honoring "no hardcoded
 * prompts" while never failing just because an admin hasn't curated one yet.
 */
export async function resolveFeaturePrompt(key: GmbPromptKey, vars: PromptVars): Promise<RenderedPrompt> {
  const template = await getTemplateByKey(key).catch((err) => {
    if (err instanceof ApiError && err.code === ErrorCodes.NOT_FOUND) return null;
    throw err;
  });
  return resolvePromptText(template, key, vars);
}

// Realistic sample variables per feature — derived through the same mappers the
// runtime uses, so previewing a template with these fills exactly the
// placeholders the seed declares. Powers a one-click "fill sample" in preview.
const SAMPLE_VARS: Record<GmbPromptKey, PromptVars> = {
  [GMB_PROMPT_KEYS.reviewReply]: reviewReplyVariables({
    authorName: "Priya Sharma",
    rating: 5,
    businessName: "Acme Cafe",
    comment: "Loved the coffee and the service!",
  }),
  [GMB_PROMPT_KEYS.postCaption]: postCaptionVariables({
    businessName: "Acme Cafe",
    topic: "Diwali weekend special",
    tone: "friendly",
    niche: "Restaurant & Cafe",
  }),
  [GMB_PROMPT_KEYS.description]: descriptionVariables({
    businessName: "Acme Cafe",
    keywords: ["espresso", "fresh pastries", "free wifi"],
  }),
  [GMB_PROMPT_KEYS.keywordIdeas]: keywordIdeasVariables({
    category: "Cafe",
    city: "Pune",
    services: ["espresso", "cold brew", "pastries"],
  }),
  [GMB_PROMPT_KEYS.rankingAdvice]: { business: "Acme Cafe" },
  [GMB_PROMPT_KEYS.image]: { subject: "a latte with leaf art", business: "Acme Cafe", style: "warm, natural-light" },
  [GMB_PROMPT_KEYS.report]: { business: "Acme Cafe" },
};

/** Realistic sample variables for a feature key (for previewing templates). */
export function sampleVarsFor(key: GmbPromptKey): PromptVars {
  return SAMPLE_VARS[key];
}

/** Sample-variable catalog as a list for the admin UI: [{ key, variables }]. */
export function listSampleVars(): { key: GmbPromptKey; variables: PromptVars }[] {
  return (Object.keys(SAMPLE_VARS) as GmbPromptKey[]).map((key) => ({ key, variables: SAMPLE_VARS[key] }));
}

export interface PromptCoverageRow {
  key: GmbPromptKey;
  hasActiveTemplate: boolean;
  source: "template" | "fallback";
}

/**
 * Pure: given the keys that currently have an active admin template, report per
 * GMB feature whether resolveFeaturePrompt would use the admin template
 * ("template") or fall back to the built-in seed ("fallback"). Lets Super Admin
 * see prompt coverage at a glance. Key matching mirrors getTemplateByKey
 * (trim + lowercase).
 */
export function promptCoverage(activeKeys: Iterable<string>): PromptCoverageRow[] {
  const active = new Set(Array.from(activeKeys, (k) => k.trim().toLowerCase()));
  return (Object.values(GMB_PROMPT_KEYS) as GmbPromptKey[]).map((key) => {
    const hasActiveTemplate = active.has(key);
    return { key, hasActiveTemplate, source: hasActiveTemplate ? "template" : "fallback" };
  });
}
