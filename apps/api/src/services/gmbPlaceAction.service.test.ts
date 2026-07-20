import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actionFindMany: vi.fn(),
  actionFindFirst: vi.fn(),
  actionFindUnique: vi.fn(),
  actionCreate: vi.fn(),
  actionUpdate: vi.fn(),
  actionDelete: vi.fn(),
  locationFindFirst: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    gmbPlaceAction: {
      findMany: mocks.actionFindMany,
      findFirst: mocks.actionFindFirst,
      findUnique: mocks.actionFindUnique,
      create: mocks.actionCreate,
      update: mocks.actionUpdate,
      delete: mocks.actionDelete,
    },
    gmbLocation: { findFirst: mocks.locationFindFirst },
  },
  GmbPlaceActionType: {
    BOOK: "BOOK",
    APPOINTMENT: "APPOINTMENT",
    RESERVE: "RESERVE",
    ORDER_ONLINE: "ORDER_ONLINE",
    DINING_RESERVATION: "DINING_RESERVATION",
  },
}));

import {
  buildBookingUrl,
  isValidActionUrl,
  suggestPlaceActions,
  upsertPlaceAction,
} from "./gmbPlaceAction.service";

const NOW = new Date("2026-07-17T12:00:00Z");
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "pa1",
    locationId: "loc1",
    actionType: "BOOK",
    url: "https://app.example.com/book/t1",
    isActive: true,
    publishedToGoogle: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isValidActionUrl", () => {
  it.each([
    ["https://app.example.com/book/t1", true],
    ["https://calendly.com/glow", true],
    ["http://insecure.example.com", false], // http not allowed
    ["ftp://x.com", false],
    ["not-a-url", false],
    ["", false],
    ["javascript:alert(1)", false],
  ])("%s → %s", (url, expected) => {
    expect(isValidActionUrl(url)).toBe(expected);
  });
});

describe("buildBookingUrl", () => {
  it("forms <base>/book/<tenantId> and strips a trailing slash", () => {
    expect(buildBookingUrl("t1", "https://app.adgrowly.com/")).toBe(
      "https://app.adgrowly.com/book/t1",
    );
  });

  it("falls back to the WEB_URL env / localhost when no base is given", () => {
    const prev = process.env.WEB_URL;
    delete process.env.WEB_URL;
    expect(buildBookingUrl("t9")).toBe("http://localhost:3000/book/t9");
    if (prev) process.env.WEB_URL = prev;
  });
});

describe("suggestPlaceActions", () => {
  it("404s for a location owned by another tenant", async () => {
    mocks.locationFindFirst.mockResolvedValue(null);
    await expect(suggestPlaceActions("t1", "loc_other")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("pre-fills BOOK + APPOINTMENT with the tenant's booking page", async () => {
    mocks.locationFindFirst.mockResolvedValue({ id: "loc1" });
    const out = await suggestPlaceActions("t1", "loc1", "https://app.adgrowly.com");
    expect(out.bookingUrl).toBe("https://app.adgrowly.com/book/t1");
    expect(out.bookingUrlValid).toBe(true);
    expect(out.suggestions.map((s) => s.actionType)).toEqual(["BOOK", "APPOINTMENT"]);
    expect(out.suggestions.every((s) => s.url === out.bookingUrl)).toBe(true);
  });

  it("flags an http (dev) booking base as invalid for saving", async () => {
    mocks.locationFindFirst.mockResolvedValue({ id: "loc1" });
    const out = await suggestPlaceActions("t1", "loc1", "http://localhost:3000");
    expect(out.bookingUrlValid).toBe(false);
  });
});

describe("upsertPlaceAction", () => {
  it("rejects a non-https URL before any DB write", async () => {
    await expect(
      upsertPlaceAction("t1", {
        locationId: "loc1",
        actionType: "BOOK" as never,
        url: "http://insecure.example.com",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.locationFindFirst).not.toHaveBeenCalled();
  });

  it("404s when the location isn't the tenant's", async () => {
    mocks.locationFindFirst.mockResolvedValue(null);
    await expect(
      upsertPlaceAction("t1", {
        locationId: "loc_other",
        actionType: "BOOK" as never,
        url: "https://ok.example.com/book",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("creates a new action when none exists for that (location, type)", async () => {
    mocks.locationFindFirst.mockResolvedValue({ id: "loc1" });
    mocks.actionFindUnique.mockResolvedValue(null);
    mocks.actionCreate.mockImplementation(async ({ data }) => row({ ...data }));
    const a = await upsertPlaceAction("t1", {
      locationId: "loc1",
      actionType: "BOOK" as never,
      url: "https://ok.example.com/book",
    });
    expect(mocks.actionCreate).toHaveBeenCalled();
    expect(a.url).toBe("https://ok.example.com/book");
  });

  it("updates the existing action and marks it out-of-sync with Google", async () => {
    mocks.locationFindFirst.mockResolvedValue({ id: "loc1" });
    mocks.actionFindUnique.mockResolvedValue(row({ publishedToGoogle: true }));
    mocks.actionUpdate.mockImplementation(async ({ data }) => row({ ...data, id: "pa1" }));
    await upsertPlaceAction("t1", {
      locationId: "loc1",
      actionType: "BOOK" as never,
      url: "https://ok.example.com/new-link",
    });
    expect(mocks.actionUpdate.mock.calls[0][0].data).toMatchObject({
      url: "https://ok.example.com/new-link",
      publishedToGoogle: false,
    });
    expect(mocks.actionCreate).not.toHaveBeenCalled();
  });
});
