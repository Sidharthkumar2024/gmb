import { describe, expect, it } from "vitest";
import { GmbLocationStatus } from "@nexaflow/db";
import { toSafeLocation } from "./gmbLocation.service";

const row = {
  id: "loc1",
  tenantId: "t1",
  name: "Acme Cafe",
  storeCode: "S1",
  placeId: "ChIJ123",
  phone: "+14155550000",
  website: "https://acme.example",
  primaryCategory: "Cafe",
  addressLine: "1 Main St",
  city: "Pune",
  region: "MH",
  postalCode: "411001",
  country: "IN",
  status: GmbLocationStatus.CONNECTED,
  verificationState: "VERIFIED",
  rating: 4.6,
  reviewCount: 128,
  secretId: "sv_google",
  lastSyncedAt: new Date("2026-06-01"),
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-02-01"),
};

describe("toSafeLocation", () => {
  it("nests the address and surfaces rating/reviewCount", () => {
    const safe = toSafeLocation(row);
    expect(safe.address).toEqual({
      line: "1 Main St",
      city: "Pune",
      region: "MH",
      postalCode: "411001",
      country: "IN",
    });
    expect(safe.rating).toBe(4.6);
    expect(safe.reviewCount).toBe(128);
    expect(safe.status).toBe("CONNECTED");
  });

  it("exposes hasCredential, never the secretId", () => {
    const safe = toSafeLocation(row);
    expect(safe.hasCredential).toBe(true);
    expect((safe as Record<string, unknown>).secretId).toBeUndefined();
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
  });

  it("hasCredential is false without a linked secret", () => {
    expect(toSafeLocation({ ...row, secretId: null }).hasCredential).toBe(false);
  });
});
