import { afterEach, describe, expect, it, vi } from "vitest";

// The pure template engine (placeholder extraction / render / variable diff)
// plus platform-scoped, version-aware DB ops: keys are normalised and unique,
// the version bumps only when the body actually changes, and variables are
// re-derived from the body when the caller doesn't supply them.

const deps = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      aiPromptTemplate: {
        findMany: deps.findMany,
        findUnique: deps.findUnique,
        create: deps.create,
        update: deps.update,
        delete: deps.delete,
      },
    },
  };
});

import {
  createTemplate,
  diffVariables,
  extractPlaceholders,
  getTemplateByKey,
  previewTemplate,
  renderPrompt,
  toSafeTemplate,
  updateTemplate,
} from "./aiPromptTemplate.service";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tpl-1",
    key: "review_reply",
    name: "Review reply",
    description: null,
    category: "reviews",
    template: "Reply to {{author}}",
    variables: ["author"],
    model: null,
    isActive: true,
    version: 3,
    updatedByUserId: "u-secret",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("extractPlaceholders", () => {
  it("returns unique names in first-seen order, tolerating whitespace and dots", () => {
    expect(extractPlaceholders("Hi {{ name }}, {{loc.city}} — {{name}} again")).toEqual([
      "name",
      "loc.city",
    ]);
  });
  it("returns an empty list when there are no placeholders", () => {
    expect(extractPlaceholders("no tokens here")).toEqual([]);
  });
});

describe("renderPrompt", () => {
  it("substitutes values and stringifies numbers", () => {
    const r = renderPrompt("{{a}} of {{n}}", { a: "star", n: 5 });
    expect(r.text).toBe("star of 5");
    expect(r.missing).toEqual([]);
  });
  it("leaves unfilled placeholders intact and reports them once each", () => {
    const r = renderPrompt("{{x}} {{y}} {{x}}", { y: "" });
    expect(r.text).toBe("{{x}} {{y}} {{x}}"); // empty string counts as missing
    expect(r.missing).toEqual(["x", "y"]);
  });
});

describe("diffVariables", () => {
  it("splits declared vs actual placeholders into undeclared and unused", () => {
    const d = diffVariables("{{a}} {{b}}", ["a", "c"]);
    expect(d.placeholders).toEqual(["a", "b"]);
    expect(d.undeclared).toEqual(["b"]); // in body, not declared
    expect(d.unused).toEqual(["c"]); // declared, not in body
  });
});

describe("toSafeTemplate", () => {
  it("omits the internal updatedByUserId", () => {
    const safe = toSafeTemplate(makeRow() as never);
    expect(safe).not.toHaveProperty("updatedByUserId");
    expect(safe.key).toBe("review_reply");
  });
});

describe("createTemplate", () => {
  it("normalises the key, rejects blanks, and 409s on a duplicate", async () => {
    await expect(createTemplate({ key: "  ", name: "n", template: "t" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(createTemplate({ key: "k", name: "n", template: "   " })).rejects.toMatchObject({ statusCode: 400 });

    deps.findUnique.mockResolvedValue({ id: "existing" });
    await expect(createTemplate({ key: "DUP", name: "n", template: "t" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("auto-derives variables from the body when none are supplied", async () => {
    deps.findUnique.mockResolvedValue(null);
    deps.create.mockResolvedValue(makeRow());
    await createTemplate({ key: "  Greeting ", name: "G", template: "Hi {{name}} in {{city}}" });
    const data = deps.create.mock.calls[0][0].data;
    expect(data.key).toBe("greeting"); // trimmed + lowercased
    expect(data.variables).toEqual(["name", "city"]);
    expect(data.isActive).toBe(true); // default
  });
});

describe("updateTemplate", () => {
  it("bumps the version and re-derives variables when the body changes", async () => {
    deps.findUnique.mockResolvedValue(makeRow({ version: 3, template: "old {{a}}" }));
    deps.update.mockResolvedValue(makeRow());
    await updateTemplate("tpl-1", { template: "new {{a}} {{b}}" });
    const data = deps.update.mock.calls[0][0].data;
    expect(data.version).toBe(4);
    expect(data.variables).toEqual(["a", "b"]);
  });

  it("does not bump the version when the body is unchanged", async () => {
    deps.findUnique.mockResolvedValue(makeRow({ version: 3, template: "same {{a}}" }));
    deps.update.mockResolvedValue(makeRow());
    await updateTemplate("tpl-1", { name: "Renamed", template: "same {{a}}" });
    const data = deps.update.mock.calls[0][0].data;
    expect(data.version).toBeUndefined(); // no bump
    expect(data.name).toBe("Renamed");
  });

  it("404s when the template id is unknown", async () => {
    deps.findUnique.mockResolvedValue(null);
    await expect(updateTemplate("missing", { name: "x" })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("getTemplateByKey", () => {
  it("looks up by the normalised key and 404s when absent", async () => {
    deps.findUnique.mockResolvedValue(null);
    await expect(getTemplateByKey("  Review_Reply ")).rejects.toMatchObject({ statusCode: 404 });
    expect(deps.findUnique).toHaveBeenCalledWith({ where: { key: "review_reply" } });
  });
});

describe("previewTemplate", () => {
  it("renders the stored template with supplied vars and reports missing", async () => {
    deps.findUnique.mockResolvedValue(makeRow({ template: "Reply to {{author}} about {{topic}}" }));
    const r = await previewTemplate("tpl-1", { author: "Sam" });
    expect(r.text).toBe("Reply to Sam about {{topic}}");
    expect(r.missing).toEqual(["topic"]);
    expect(r.version).toBe(3);
  });
});
