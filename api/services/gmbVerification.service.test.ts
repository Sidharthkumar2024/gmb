import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verFindFirst: vi.fn(),
  verCreate: vi.fn(),
  verUpdate: vi.fn(),
  locFindFirst: vi.fn(),
  locUpdate: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    gmbVerificationRequest: {
      findFirst: mocks.verFindFirst,
      create: mocks.verCreate,
      update: mocks.verUpdate,
    },
    gmbLocation: { findFirst: mocks.locFindFirst, update: mocks.locUpdate },
  },
  GmbVerificationMethod: {
    PHONE_CALL: "PHONE_CALL",
    SMS: "SMS",
    EMAIL: "EMAIL",
    POSTCARD: "POSTCARD",
  },
  GmbVerificationRequestState: {
    PENDING: "PENDING",
    VERIFIED: "VERIFIED",
    FAILED: "FAILED",
    CANCELED: "CANCELED",
  },
}));

import {
  canRequestVerification,
  completeVerification,
  requestVerification,
} from "./gmbVerification.service";

const NOW = new Date("2026-07-17T12:00:00Z");
function req(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    locationId: "loc1",
    method: "SMS",
    state: "PENDING",
    requestedByUserId: "u1",
    requestedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locUpdate.mockResolvedValue({});
});

describe("canRequestVerification (pure gate)", () => {
  it("allows when unverified and nothing pending", () => {
    expect(canRequestVerification({ googleVerified: false, hasPendingRequest: false })).toEqual({
      allowed: true,
    });
  });

  it("blocks when already Google-verified", () => {
    const g = canRequestVerification({ googleVerified: true, hasPendingRequest: false });
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/already verified/i);
  });

  it("blocks when a verification is already in progress", () => {
    const g = canRequestVerification({ googleVerified: false, hasPendingRequest: true });
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/in progress/i);
  });
});

describe("requestVerification — customer-initiated enforcement", () => {
  it("REFUSES a request with no user id (never background/automatic)", async () => {
    await expect(
      requestVerification({
        tenantId: "t1",
        locationId: "loc1",
        method: "SMS" as never,
        requestedByUserId: "",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    // Never even touched the DB.
    expect(mocks.locFindFirst).not.toHaveBeenCalled();
  });

  it("404s for a location owned by another tenant", async () => {
    mocks.locFindFirst.mockResolvedValue(null);
    await expect(
      requestVerification({
        tenantId: "t1",
        locationId: "loc_other",
        method: "SMS" as never,
        requestedByUserId: "u1",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuses when the profile is already verified", async () => {
    mocks.locFindFirst.mockResolvedValue({ id: "loc1", verificationState: "VERIFIED" });
    mocks.verFindFirst.mockResolvedValue(null);
    await expect(
      requestVerification({
        tenantId: "t1",
        locationId: "loc1",
        method: "SMS" as never,
        requestedByUserId: "u1",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.verCreate).not.toHaveBeenCalled();
  });

  it("refuses a second request while one is pending", async () => {
    mocks.locFindFirst.mockResolvedValue({ id: "loc1", verificationState: null });
    mocks.verFindFirst.mockResolvedValue({ id: "v-existing" });
    await expect(
      requestVerification({
        tenantId: "t1",
        locationId: "loc1",
        method: "SMS" as never,
        requestedByUserId: "u1",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("creates a PENDING request recording the requesting user, gated from Google", async () => {
    mocks.locFindFirst.mockResolvedValue({ id: "loc1", verificationState: "UNVERIFIED" });
    mocks.verFindFirst.mockResolvedValue(null);
    mocks.verCreate.mockImplementation(async ({ data }) => req({ ...data }));
    const out = await requestVerification({
      tenantId: "t1",
      locationId: "loc1",
      method: "POSTCARD" as never,
      requestedByUserId: "u42",
    });
    expect(mocks.verCreate.mock.calls[0][0].data.requestedByUserId).toBe("u42");
    expect(out.state).toBe("PENDING");
    expect(out.submittedToGoogle).toBe(false);
  });
});

describe("completeVerification", () => {
  it("rejects an empty code", async () => {
    await expect(
      completeVerification({ tenantId: "t1", requestId: "v1", code: "  " }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("404s on a request owned by another tenant", async () => {
    mocks.verFindFirst.mockResolvedValue(null);
    await expect(
      completeVerification({ tenantId: "t1", requestId: "v_other", code: "123456" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuses to complete a non-pending request", async () => {
    mocks.verFindFirst.mockResolvedValue(req({ state: "VERIFIED" }));
    await expect(
      completeVerification({ tenantId: "t1", requestId: "v1", code: "123456" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("marks the request VERIFIED and stamps the location verification state", async () => {
    mocks.verFindFirst.mockResolvedValue(req());
    mocks.verUpdate.mockImplementation(async ({ data }) => req({ ...data, id: "v1" }));
    const out = await completeVerification({ tenantId: "t1", requestId: "v1", code: "999111" });
    expect(mocks.verUpdate.mock.calls[0][0].data.state).toBe("VERIFIED");
    expect(mocks.locUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "loc1" },
        data: { verificationState: "VERIFIED" },
      }),
    );
    expect(out.state).toBe("VERIFIED");
    expect(out.submittedToGoogle).toBe(false);
  });
});
