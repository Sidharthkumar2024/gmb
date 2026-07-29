import { afterEach, describe, expect, it, vi } from "vitest";

// The safety contract for transactional (auth) emails: a saved-but-not-enabled
// custom template must NEVER change what actually sends, disabling custom
// instantly restores the built-in default, unknown tokens are left intact, and
// a DB failure falls back to the default so an auth email still goes out.

const deps = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      emailTemplate: { findMany: deps.findMany, findUnique: deps.findUnique, upsert: deps.upsert },
    },
  };
});

import {
  listEmailTemplates,
  renderEmailTemplate,
  upsertEmailTemplate,
} from "./emailTemplate.service";

afterEach(() => vi.clearAllMocks());

describe("listEmailTemplates", () => {
  it("returns built-in defaults when there are no overrides", async () => {
    deps.findMany.mockResolvedValue([]);
    const list = await listEmailTemplates();
    const verify = list.find((t) => t.key === "EMAIL_VERIFICATION")!;
    expect(verify.useCustom).toBe(false);
    expect(verify.subject).toBe("Verify your email");
  });

  it("shows the default (not the stored custom) while useCustom is off", async () => {
    deps.findMany.mockResolvedValue([
      { key: "EMAIL_VERIFICATION", subject: "CUSTOM SUBJ", body: "CUSTOM BODY", useCustom: false, updatedAt: new Date() },
    ]);
    const verify = (await listEmailTemplates()).find((t) => t.key === "EMAIL_VERIFICATION")!;
    expect(verify.subject).toBe("Verify your email"); // default wins
    expect(verify.subject).not.toBe("CUSTOM SUBJ");
  });

  it("shows the custom text once useCustom is on", async () => {
    deps.findMany.mockResolvedValue([
      { key: "EMAIL_VERIFICATION", subject: "CUSTOM SUBJ", body: "CUSTOM BODY", useCustom: true, updatedAt: new Date() },
    ]);
    const verify = (await listEmailTemplates()).find((t) => t.key === "EMAIL_VERIFICATION")!;
    expect(verify.subject).toBe("CUSTOM SUBJ");
  });
});

describe("upsertEmailTemplate", () => {
  it("404s on an unknown template key", async () => {
    await expect(
      upsertEmailTemplate("NOPE", { subject: "s", body: "b", useCustom: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("400s when enabling custom with a blank subject or body", async () => {
    await expect(
      upsertEmailTemplate("PASSWORD_RESET", { subject: "  ", body: "b", useCustom: true }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.upsert).not.toHaveBeenCalled();
  });

  it("persists a valid custom template", async () => {
    deps.upsert.mockResolvedValue({});
    deps.findMany.mockResolvedValue([
      { key: "PASSWORD_RESET", subject: "Reset now", body: "Go: {{url}}", useCustom: true, updatedAt: new Date() },
    ]);
    const saved = await upsertEmailTemplate("PASSWORD_RESET", {
      subject: "Reset now",
      body: "Go: {{url}}",
      useCustom: true,
    });
    expect(deps.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "PASSWORD_RESET" } }),
    );
    expect(saved.subject).toBe("Reset now");
  });
});

describe("renderEmailTemplate", () => {
  it("substitutes known tokens and leaves unknown ones intact", async () => {
    deps.findUnique.mockResolvedValue(null);
    const withVar = await renderEmailTemplate("EMAIL_VERIFICATION", { url: "https://x/y" });
    expect(withVar.text).toContain("https://x/y");
    const noVar = await renderEmailTemplate("EMAIL_VERIFICATION", {});
    expect(noVar.text).toContain("{{url}}"); // left as-is, not blanked
  });

  it("uses the custom row only when useCustom is on", async () => {
    deps.findUnique.mockResolvedValue({ key: "PASSWORD_RESET", subject: "C", body: "custom {{url}}", useCustom: true });
    const r = await renderEmailTemplate("PASSWORD_RESET", { url: "Z" });
    expect(r).toEqual({ subject: "C", text: "custom Z" });
  });

  it("falls back to the default when the DB read throws (auth email must still send)", async () => {
    deps.findUnique.mockRejectedValue(new Error("db down"));
    const r = await renderEmailTemplate("EMAIL_VERIFICATION", { url: "Z" });
    expect(r.subject).toBe("Verify your email");
    expect(r.text).toContain("Z");
  });

  it("404s on an unknown key", async () => {
    await expect(renderEmailTemplate("NOPE", {})).rejects.toMatchObject({ statusCode: 404 });
  });
});
