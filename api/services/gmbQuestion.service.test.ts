import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  questionFindFirst: vi.fn(),
  questionFindMany: vi.fn(),
  questionCreate: vi.fn(),
  questionUpdate: vi.fn(),
  questionDelete: vi.fn(),
  questionCount: vi.fn(),
  locationFindFirst: vi.fn(),
  runLlm: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    gmbQuestion: {
      findFirst: mocks.questionFindFirst,
      findMany: mocks.questionFindMany,
      create: mocks.questionCreate,
      update: mocks.questionUpdate,
      delete: mocks.questionDelete,
      count: mocks.questionCount,
    },
    gmbLocation: { findFirst: mocks.locationFindFirst },
  },
  GmbQuestionStatus: { NEW: "NEW", ANSWERED: "ANSWERED", IGNORED: "IGNORED" },
}));

vi.mock("./ai.service", () => ({
  runTenantLlmJson: mocks.runLlm,
}));

import {
  answerQuestion,
  buildAnswerDraft,
  draftAnswerWithAi,
  ingestQuestion,
  toSafeQuestion,
} from "./gmbQuestion.service";

const NOW = new Date("2026-07-17T10:00:00Z");
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    locationId: "loc1",
    externalQuestionId: null,
    authorName: "Asha",
    questionText: "Do you do bridal makeup?",
    askedAt: NOW,
    status: "NEW",
    answerText: null,
    answeredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildAnswerDraft (pure fallback)", () => {
  it("produces a courteous, non-committal draft with the business name", () => {
    const d = buildAnswerDraft({ businessName: "Glow Salon", questionText: "Price?" });
    expect(d).toContain("Glow Salon");
    expect(d.length).toBeLessThan(400);
  });

  it("falls back to a generic subject when the business name is blank", () => {
    expect(buildAnswerDraft({ businessName: "  ", questionText: "?" })).toContain("our team");
  });
});

describe("draftAnswerWithAi", () => {
  it("returns the AI answer when the model responds", async () => {
    mocks.runLlm.mockResolvedValue({ answer: "Yes, we offer bridal makeup by appointment." });
    const out = await draftAnswerWithAi("t1", {
      businessName: "Glow",
      questionText: "Bridal makeup?",
    });
    expect(out).toEqual({
      answer: "Yes, we offer bridal makeup by appointment.",
      source: "ai",
    });
  });

  it("degrades to the template when the AI call fails (no ANTHROPIC key, etc.)", async () => {
    mocks.runLlm.mockRejectedValue(new Error("ANTHROPIC_API_KEY not configured"));
    const out = await draftAnswerWithAi("t1", { businessName: "Glow", questionText: "?" });
    expect(out.source).toBe("template");
    expect(out.answer).toContain("Glow");
  });

  it("degrades to the template when the model returns an empty answer", async () => {
    mocks.runLlm.mockResolvedValue({ answer: "   " });
    const out = await draftAnswerWithAi("t1", { businessName: "Glow", questionText: "?" });
    expect(out.source).toBe("template");
  });
});

describe("ingestQuestion", () => {
  it("rejects empty question text", async () => {
    await expect(
      ingestQuestion("t1", { locationId: "loc1", questionText: "   " }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.locationFindFirst).not.toHaveBeenCalled();
  });

  it("404s when the location belongs to another tenant", async () => {
    mocks.locationFindFirst.mockResolvedValue(null);
    await expect(
      ingestQuestion("t1", { locationId: "loc_other", questionText: "Hours?" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.questionCreate).not.toHaveBeenCalled();
  });

  it("creates a tenant-scoped question for an owned location", async () => {
    mocks.locationFindFirst.mockResolvedValue({ id: "loc1", name: "Glow" });
    mocks.questionCreate.mockImplementation(async ({ data }) => row({ ...data }));
    const q = await ingestQuestion("t1", {
      locationId: "loc1",
      questionText: "Hours?",
      authorName: "  Asha  ",
    });
    expect(mocks.questionCreate.mock.calls[0][0].data.tenantId).toBe("t1");
    expect(mocks.questionCreate.mock.calls[0][0].data.authorName).toBe("Asha");
    expect(q.questionText).toBe("Hours?");
  });
});

describe("answerQuestion", () => {
  it("rejects an empty answer", async () => {
    mocks.questionFindFirst.mockResolvedValue(row());
    await expect(answerQuestion("t1", "q1", "  ")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("404s on a question owned by another tenant", async () => {
    mocks.questionFindFirst.mockResolvedValue(null);
    await expect(answerQuestion("t1", "q_other", "Yes")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mocks.questionUpdate).not.toHaveBeenCalled();
  });

  it("saves the answer, marks ANSWERED, and reports publishedToGoogle=false", async () => {
    mocks.questionFindFirst.mockResolvedValue(row());
    mocks.questionUpdate.mockImplementation(async ({ data }) =>
      row({ ...data, id: "q1" }),
    );
    const result = await answerQuestion("t1", "q1", "  Yes, by appointment.  ");
    expect(mocks.questionUpdate.mock.calls[0][0].data).toMatchObject({
      answerText: "Yes, by appointment.",
      status: "ANSWERED",
    });
    expect(result.status).toBe("ANSWERED");
    expect(result.publishedToGoogle).toBe(false);
  });
});

describe("toSafeQuestion", () => {
  it("flags Google-sourced questions and serializes dates", () => {
    const safe = toSafeQuestion(row({ externalQuestionId: "google-q-123" }));
    expect(safe.isFromGoogle).toBe(true);
    expect(safe.askedAt).toBe(NOW.toISOString());
    expect(safe).not.toHaveProperty("externalQuestionId");
  });

  it("marks manually-logged questions as not from Google", () => {
    expect(toSafeQuestion(row()).isFromGoogle).toBe(false);
  });
});
