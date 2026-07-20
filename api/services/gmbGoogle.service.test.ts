import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildGoogleBusinessProfileOAuthUrl,
  buildGoogleLocalPostBody,
  buildGoogleReviewResourceName,
  mapGoogleStarRating,
  normalizeGoogleLocation,
  signGoogleOAuthState,
  summarizeGoogleReviews,
  verifyGoogleOAuthState,
} from "./gmbGoogle.service";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google Business Profile OAuth helpers", () => {
  it("builds an offline consent URL with the business.manage scope", () => {
    vi.stubEnv("GOOGLE_BUSINESS_PROFILE_CLIENT_ID", "client-123");
    const url = new URL(
      buildGoogleBusinessProfileOAuthUrl({
        redirectUri: "https://app.example.com/gmb-connect/callback",
        state: "signed-state",
      }),
    );

    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("business.manage");
    expect(url.searchParams.get("state")).toBe("signed-state");
  });

  it("signs and verifies tenant/user-bound state", () => {
    vi.stubEnv("GOOGLE_BUSINESS_PROFILE_STATE_SECRET", "state-secret");
    const state = signGoogleOAuthState({
      tenantId: "tenant_1",
      userId: "user_1",
      iat: Date.now(),
      nonce: "abc",
    });
    expect(verifyGoogleOAuthState(state)).toMatchObject({
      tenantId: "tenant_1",
      userId: "user_1",
      nonce: "abc",
    });
    expect(() => verifyGoogleOAuthState(`${state}tampered`)).toThrow();
  });
});

describe("Google Business Profile normalizers", () => {
  it("normalizes a GBP location row into the local location shape", () => {
    const mapped = normalizeGoogleLocation(
      {
        name: "locations/987",
        title: "Cutz & Bangs",
        storeCode: "PUNE-01",
        websiteUri: "https://cutz.example",
        storefrontAddress: {
          addressLines: ["MG Road", "2nd Floor"],
          locality: "Pune",
          administrativeArea: "MH",
          postalCode: "411001",
          regionCode: "IN",
        },
        phoneNumbers: { primaryPhone: "+91 98765 43210" },
        primaryCategory: { displayName: "Beauty salon" },
      },
      "accounts/123",
    );

    expect(mapped.placeId).toBe("accounts/123/locations/987");
    expect(mapped.name).toBe("Cutz & Bangs");
    expect(mapped.addressLine).toBe("MG Road, 2nd Floor");
    expect(mapped.primaryCategory).toBe("Beauty salon");
  });

  it("maps Google star ratings and summarizes synced reviews", () => {
    expect(mapGoogleStarRating("ONE")).toBe(1);
    expect(mapGoogleStarRating("FIVE")).toBe(5);
    expect(mapGoogleStarRating("UNKNOWN")).toBeNull();
    expect(summarizeGoogleReviews([{ rating: 5 }, { rating: 4 }, { rating: 1 }])).toEqual({
      reviewCount: 3,
      rating: 3.33,
    });
  });

  it("builds review reply resource names without leaking malformed paths", () => {
    expect(
      buildGoogleReviewResourceName("accounts/123/locations/987", "review-abc"),
    ).toBe("accounts/123/locations/987/reviews/review-abc");
    expect(
      buildGoogleReviewResourceName("accounts/123/locations/987", "reviews/review-abc"),
    ).toBe("accounts/123/locations/987/reviews/review-abc");
    expect(
      buildGoogleReviewResourceName(
        "accounts/ignored/locations/ignored",
        "accounts/123/locations/987/reviews/review-abc",
      ),
    ).toBe("accounts/123/locations/987/reviews/review-abc");
    expect(buildGoogleReviewResourceName("locations/987", "review-abc")).toBeNull();
    expect(buildGoogleReviewResourceName("accounts/123/locations/987", "")).toBeNull();
  });
});

describe("Google local post payload", () => {
  it("sends exactly one hosted branded image and one native URL CTA", () => {
    expect(
      buildGoogleLocalPostBody({
        summary: "New season, new look.",
        mediaUrl: "https://media.example.com/gmb/post.png",
        callToActionType: "BOOK",
        callToActionUrl: "https://cutz.example.com/book",
      }),
    ).toEqual({
      languageCode: "en-US",
      topicType: "STANDARD",
      summary: "New season, new look.",
      media: [
        {
          mediaFormat: "PHOTO",
          sourceUrl: "https://media.example.com/gmb/post.png",
        },
      ],
      callToAction: {
        actionType: "BOOK",
        url: "https://cutz.example.com/book",
      },
    });
  });

  it("emits CALL without a URL and omits absent media", () => {
    expect(
      buildGoogleLocalPostBody({
        summary: "Call us today.",
        callToActionType: "CALL",
        callToActionUrl: null,
      }),
    ).toEqual({
      languageCode: "en-US",
      topicType: "STANDARD",
      summary: "Call us today.",
      callToAction: { actionType: "CALL" },
    });
  });
});
