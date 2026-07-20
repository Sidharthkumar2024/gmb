import { describe, expect, it } from "vitest";
import {
  GMB_PROMPT_KEYS,
  descriptionVariables,
  keywordIdeasVariables,
  listPromptSeeds,
  listSampleVars,
  postCaptionVariables,
  promptCoverage,
  renderWithFallback,
  resolvePromptText,
  reviewReplyVariables,
  sampleVarsFor,
  seedFor,
} from "./gmbAiPrompts.service";
import { renderPrompt } from "./aiPromptTemplate.service";

describe("GMB_PROMPT_KEYS", () => {
  it("defines a stable key per AI feature", () => {
    expect(GMB_PROMPT_KEYS.reviewReply).toBe("gmb.review_reply");
    expect(GMB_PROMPT_KEYS.description).toBe("gmb.description_optimizer");
    expect(Object.keys(GMB_PROMPT_KEYS)).toHaveLength(7);
  });
});

describe("reviewReplyVariables", () => {
  it("uses the author's first name and passes rating/comment", () => {
    expect(
      reviewReplyVariables({ authorName: "Priya Sharma", rating: 5, businessName: "Acme Cafe", comment: "Loved it" }),
    ).toEqual({ author: "Priya", rating: 5, business: "Acme Cafe", comment: "Loved it" });
  });

  it("falls back to safe defaults when author/business are missing", () => {
    const v = reviewReplyVariables({ rating: 2, businessName: "  " });
    expect(v.author).toBe("there");
    expect(v.business).toBe("our team");
    expect(v.comment).toBe("");
  });
});

describe("postCaptionVariables", () => {
  it("defaults tone to friendly and trims topic", () => {
    expect(postCaptionVariables({ businessName: "Acme", topic: " Diwali sale " })).toEqual({
      business: "Acme",
      topic: "Diwali sale",
      tone: "friendly",
      niche: "local business",
    });
  });
});

describe("renderWithFallback", () => {
  const vars = { author: "Sam", business: "Acme", rating: 5, comment: "great" };

  it("renders an active template and reports missing placeholders", () => {
    const r = renderWithFallback(
      { template: "Hi {{author}} — thanks from {{business}}! Ref {{ticket}}", isActive: true },
      vars,
      "FALLBACK",
    );
    expect(r.source).toBe("template");
    expect(r.text).toBe("Hi Sam — thanks from Acme! Ref {{ticket}}");
    expect(r.missing).toEqual(["ticket"]);
  });

  it("uses the deterministic fallback when no template is configured", () => {
    expect(renderWithFallback(null, vars, "FALLBACK")).toEqual({ text: "FALLBACK", source: "fallback", missing: [] });
  });

  it("uses the fallback when the template is inactive or empty", () => {
    expect(renderWithFallback({ template: "x", isActive: false }, vars, "FB").source).toBe("fallback");
    expect(renderWithFallback({ template: "   ", isActive: true }, vars, "FB").source).toBe("fallback");
  });
});

describe("descriptionVariables / keywordIdeasVariables", () => {
  it("joins keywords for the description template", () => {
    expect(descriptionVariables({ businessName: "Acme", keywords: [" coffee ", "", "pastries"] })).toEqual({
      business: "Acme",
      keywords: "coffee, pastries",
    });
  });
  it("joins services and trims category/city", () => {
    expect(keywordIdeasVariables({ category: " Cafe ", city: "Pune", services: ["espresso", " "] })).toEqual({
      category: "Cafe",
      city: "Pune",
      services: "espresso",
    });
  });
});

describe("prompt seeds", () => {
  it("provides a starter template for every feature key", () => {
    const seeds = listPromptSeeds();
    expect(seeds).toHaveLength(Object.keys(GMB_PROMPT_KEYS).length);
    for (const { template } of seeds) expect(template.length).toBeGreaterThan(0);
  });
  it("review-reply seed references author and business placeholders", () => {
    const seed = seedFor(GMB_PROMPT_KEYS.reviewReply);
    expect(seed).toContain("{{author}}");
    expect(seed).toContain("{{business}}");
  });
  it("a seed renders cleanly with its feature variables (no missing)", () => {
    const seed = seedFor(GMB_PROMPT_KEYS.reviewReply);
    const r = renderWithFallback({ template: seed, isActive: true }, reviewReplyVariables({ authorName: "Sam", rating: 5, businessName: "Acme" }), "FB");
    expect(r.source).toBe("template");
    expect(r.missing).toEqual([]);
  });
});

describe("resolvePromptText", () => {
  const vars = reviewReplyVariables({ authorName: "Sam", rating: 5, businessName: "Acme" });

  it("renders the admin template when present + active", () => {
    const r = resolvePromptText(
      { template: "Reply to {{author}} for {{business}}.", isActive: true },
      GMB_PROMPT_KEYS.reviewReply,
      vars,
    );
    expect(r.source).toBe("template");
    expect(r.text).toBe("Reply to Sam for Acme.");
    expect(r.missing).toEqual([]);
  });

  it("falls back to the rendered seed when no template is configured", () => {
    const r = resolvePromptText(null, GMB_PROMPT_KEYS.reviewReply, vars);
    expect(r.source).toBe("fallback");
    expect(r.text).toBe(renderPrompt(seedFor(GMB_PROMPT_KEYS.reviewReply), vars).text);
    expect(r.text).not.toContain("{{");
    expect(r.missing).toEqual([]);
  });

  it("falls back to the seed when the template is inactive or empty", () => {
    expect(resolvePromptText({ template: "x", isActive: false }, GMB_PROMPT_KEYS.postCaption, vars).source).toBe("fallback");
    expect(resolvePromptText({ template: "   ", isActive: true }, GMB_PROMPT_KEYS.postCaption, vars).source).toBe("fallback");
  });

  it("surfaces missing placeholders left unfilled by the template", () => {
    const r = resolvePromptText(
      { template: "Hi {{author}} — ref {{ticket}}", isActive: true },
      GMB_PROMPT_KEYS.reviewReply,
      vars,
    );
    expect(r.missing).toEqual(["ticket"]);
  });
});

describe("promptCoverage", () => {
  it("reports every feature as fallback when no template is active", () => {
    const rows = promptCoverage([]);
    expect(rows).toHaveLength(Object.keys(GMB_PROMPT_KEYS).length);
    expect(rows.every((r) => r.source === "fallback" && !r.hasActiveTemplate)).toBe(true);
  });

  it("marks a feature as template-backed when its key is active", () => {
    const rows = promptCoverage([GMB_PROMPT_KEYS.reviewReply]);
    const review = rows.find((r) => r.key === GMB_PROMPT_KEYS.reviewReply);
    expect(review).toMatchObject({ hasActiveTemplate: true, source: "template" });
    expect(rows.filter((r) => r.hasActiveTemplate)).toHaveLength(1);
  });

  it("matches keys case-insensitively and trimmed (mirrors getTemplateByKey)", () => {
    const rows = promptCoverage([`  ${GMB_PROMPT_KEYS.description.toUpperCase()}  `]);
    expect(rows.find((r) => r.key === GMB_PROMPT_KEYS.description)?.hasActiveTemplate).toBe(true);
  });

  it("ignores active keys that are not GMB feature keys", () => {
    const rows = promptCoverage(["some.other.key"]);
    expect(rows.every((r) => !r.hasActiveTemplate)).toBe(true);
  });
});

describe("sample variables", () => {
  it("provides sample variables for every feature key", () => {
    const list = listSampleVars();
    expect(list).toHaveLength(Object.keys(GMB_PROMPT_KEYS).length);
    for (const { variables } of list) expect(Object.keys(variables).length).toBeGreaterThan(0);
  });

  it("every seed renders with no missing placeholders using its sample vars", () => {
    for (const key of Object.values(GMB_PROMPT_KEYS)) {
      const r = resolvePromptText(null, key, sampleVarsFor(key));
      expect(r.source).toBe("fallback");
      expect(r.text, `seed for ${key} left a placeholder unfilled`).not.toContain("{{");
      expect(r.missing, `seed for ${key} reported missing vars`).toEqual([]);
    }
  });
});
