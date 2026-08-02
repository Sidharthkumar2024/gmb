import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verFindFirst: vi.fn(),
  verCreate: vi.fn(),
  verUpdate: vi.fn(),
  locFindFirst: vi.fn(),
  locUpdate: vi.fn(),
  fetchOptions: vi.fn(),
  fetchVoice: vi.fn(),
  requestGoogle: vi.fn(),
  completeGoogle: vi.fn(),
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

vi.mock("./gmbGoogle.service", () => ({
  fetchGoogleVoiceOfMerchantState: mocks.fetchVoice,
  fetchGoogleVerificationOptions: mocks.fetchOptions,
  requestGoogleLocationVerification: mocks.requestGoogle,
  completeGoogleLocationVerification: mocks.completeGoogle,
}));

import {
  canRequestVerification,
  cancelVerification,
  completeVerification,
  getVerificationStatus,
  requestVerification,
} from "./gmbVerification.service";

const NOW = new Date("2026-07-17T12:00:00Z");
function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    locationId: "loc1",
    method: "SMS",
    state: "PENDING",
    googleVerificationName: "locations/g1/verifications/v1",
    requestedByUserId: "u1",
    requestedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

function connectedLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: "loc1",
    verificationState: "UNVERIFIED",
    placeId: "accounts/a1/locations/g1",
    secretId: "google-secret",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locUpdate.mockResolvedValue({});
  mocks.locFindFirst.mockResolvedValue(connectedLocation());
  mocks.verFindFirst.mockResolvedValue(null);
  mocks.fetchVoice.mockResolvedValue({
    hasVoiceOfMerchant: false,
    hasBusinessAuthority: false,
    verify: { hasPendingVerification: false },
  });
  mocks.fetchOptions.mockResolvedValue([{ method: "SMS", phoneNumber: "+1•••0100" }]);
  mocks.requestGoogle.mockResolvedValue({
    name: "locations/g1/verifications/v1",
    state: "PENDING",
  });
  mocks.completeGoogle.mockResolvedValue({
    name: "locations/g1/verifications/v1",
    state: "VERIFIED",
  });
  mocks.verCreate.mockImplementation(async ({ data }) =>
    requestRow({ ...data, googleVerificationName: null }),
  );
  mocks.verUpdate.mockImplementation(async ({ data }) => requestRow({ ...data }));
});

describe("canRequestVerification", () => {
  it("allows an unverified location with no pending request", () => {
    expect(canRequestVerification({ googleVerified: false, hasPendingRequest: false })).toEqual({
      allowed: true,
    });
  });

  it("blocks an already verified or in-progress location", () => {
    expect(canRequestVerification({ googleVerified: true, hasPendingRequest: false }).allowed)
      .toBe(false);
    expect(canRequestVerification({ googleVerified: false, hasPendingRequest: true }).allowed)
      .toBe(false);
  });
});

describe("getVerificationStatus", () => {
  it("returns only the methods Google currently offers", async () => {
    mocks.fetchOptions.mockResolvedValue([
      { method: "SMS", phoneNumber: "+1•••0100" },
      {
        method: "ADDRESS",
        address: { address: { addressLines: ["1 Main St"], locality: "Toronto" }, expectedDeliveryDaysRegion: 7 },
      },
    ]);
    const status = await getVerificationStatus("t1", "loc1", "en-CA");
    expect(status.allowed).toBe(true);
    expect(status.availableMethods).toEqual(["SMS", "POSTCARD"]);
    expect(status.availableOptions[1]).toMatchObject({
      method: "POSTCARD",
      destination: "1 Main St, Toronto",
      expectedDeliveryDays: 7,
    });
  });

  it("does not invent methods when Google is not connected", async () => {
    mocks.locFindFirst.mockResolvedValue(connectedLocation({ placeId: null, secretId: null }));
    const status = await getVerificationStatus("t1", "loc1");
    expect(status.allowed).toBe(false);
    expect(status.availableMethods).toEqual([]);
    expect(status.reason).toMatch(/connect google/i);
    expect(mocks.fetchVoice).not.toHaveBeenCalled();
    expect(mocks.fetchOptions).not.toHaveBeenCalled();
  });

  it("uses Google's live ownership state instead of a stale local value", async () => {
    mocks.fetchVoice.mockResolvedValue({
      hasVoiceOfMerchant: true,
      hasBusinessAuthority: true,
    });
    const status = await getVerificationStatus("t1", "loc1");
    expect(status.googleVerified).toBe(true);
    expect(status.googleState).toBe("VERIFIED");
    expect(status.allowed).toBe(false);
    expect(mocks.fetchOptions).not.toHaveBeenCalled();
  });
});

describe("requestVerification", () => {
  it("refuses a request without a user id", async () => {
    await expect(requestVerification({
      tenantId: "t1",
      locationId: "loc1",
      method: "SMS" as never,
      requestedByUserId: "",
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.locFindFirst).not.toHaveBeenCalled();
  });

  it("404s for a location owned by another tenant", async () => {
    mocks.locFindFirst.mockResolvedValue(null);
    await expect(requestVerification({
      tenantId: "t1",
      locationId: "loc-other",
      method: "SMS" as never,
      requestedByUserId: "u1",
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("blocks an already verified location and a duplicate pending request", async () => {
    mocks.fetchVoice.mockResolvedValue({ hasBusinessAuthority: true });
    await expect(requestVerification({
      tenantId: "t1", locationId: "loc1", method: "SMS" as never, requestedByUserId: "u1",
    })).rejects.toMatchObject({ statusCode: 400 });

    mocks.fetchVoice.mockResolvedValue({ hasBusinessAuthority: false });
    mocks.verFindFirst.mockResolvedValue({ id: "pending" });
    await expect(requestVerification({
      tenantId: "t1", locationId: "loc1", method: "SMS" as never, requestedByUserId: "u1",
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a method Google did not offer", async () => {
    await expect(requestVerification({
      tenantId: "t1",
      locationId: "loc1",
      method: "EMAIL" as never,
      requestedByUserId: "u1",
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.verCreate).not.toHaveBeenCalled();
  });

  it("starts verification at Google and stores its resource name", async () => {
    const out = await requestVerification({
      tenantId: "t1",
      locationId: "loc1",
      method: "SMS" as never,
      requestedByUserId: "u42",
      languageCode: "en-CA",
    });
    expect(mocks.requestGoogle).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "t1",
      method: "SMS",
      phoneNumber: "+1•••0100",
      languageCode: "en-CA",
    }));
    expect(mocks.verUpdate).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: expect.objectContaining({
        googleVerificationName: "locations/g1/verifications/v1",
        state: "PENDING",
      }),
    });
    expect(out.submittedToGoogle).toBe(true);
  });

  it("marks the audit row FAILED when Google rejects the request", async () => {
    mocks.requestGoogle.mockRejectedValue(new Error("Google denied it"));
    await expect(requestVerification({
      tenantId: "t1", locationId: "loc1", method: "SMS" as never, requestedByUserId: "u1",
    })).rejects.toThrow("Google denied it");
    expect(mocks.verUpdate).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: expect.objectContaining({ state: "FAILED" }),
    });
    expect(mocks.locUpdate).not.toHaveBeenCalled();
  });
});

describe("completeVerification", () => {
  it("rejects empty PINs, foreign requests and non-pending requests", async () => {
    await expect(completeVerification({ tenantId: "t1", requestId: "v1", code: " " }))
      .rejects.toMatchObject({ statusCode: 400 });
    mocks.verFindFirst.mockResolvedValue(null);
    await expect(completeVerification({ tenantId: "t1", requestId: "foreign", code: "123" }))
      .rejects.toMatchObject({ statusCode: 404 });
    mocks.verFindFirst.mockResolvedValue(requestRow({ state: "VERIFIED" }));
    await expect(completeVerification({ tenantId: "t1", requestId: "v1", code: "123" }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("never locally verifies a legacy request that was not sent to Google", async () => {
    mocks.verFindFirst.mockResolvedValue(requestRow({ googleVerificationName: null }));
    await expect(completeVerification({ tenantId: "t1", requestId: "v1", code: "123456" }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.completeGoogle).not.toHaveBeenCalled();
    expect(mocks.locUpdate).not.toHaveBeenCalled();
  });

  it("marks verified only after Google accepts the PIN", async () => {
    mocks.verFindFirst.mockResolvedValue(requestRow());
    const out = await completeVerification({ tenantId: "t1", requestId: "v1", code: "999111" });
    expect(mocks.completeGoogle).toHaveBeenCalledWith(expect.objectContaining({
      verificationName: "locations/g1/verifications/v1",
      pin: "999111",
    }));
    expect(mocks.locUpdate).toHaveBeenCalledWith({
      where: { id: "loc1" },
      data: { verificationState: "VERIFIED" },
    });
    expect(out.state).toBe("VERIFIED");
    expect(out.submittedToGoogle).toBe(true);
  });

  it("does not change local state when Google's PIN call fails", async () => {
    mocks.verFindFirst.mockResolvedValue(requestRow());
    mocks.completeGoogle.mockRejectedValue(new Error("bad pin"));
    await expect(completeVerification({ tenantId: "t1", requestId: "v1", code: "000" }))
      .rejects.toThrow("bad pin");
    expect(mocks.verUpdate).not.toHaveBeenCalled();
    expect(mocks.locUpdate).not.toHaveBeenCalled();
  });
});

describe("cancelVerification", () => {
  it("only clears legacy local requests, never a live Google request", async () => {
    mocks.verFindFirst.mockResolvedValue(requestRow());
    await expect(cancelVerification("t1", "v1")).rejects.toMatchObject({ statusCode: 400 });

    mocks.verFindFirst.mockResolvedValue(requestRow({ googleVerificationName: null }));
    const out = await cancelVerification("t1", "v1");
    expect(mocks.verUpdate).toHaveBeenLastCalledWith({
      where: { id: "v1" },
      data: expect.objectContaining({ state: "CANCELED" }),
    });
    expect(out.state).toBe("CANCELED");
  });
});
