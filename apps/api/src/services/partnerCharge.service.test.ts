import { afterEach, describe, expect, it, vi } from "vitest";

// A customer is routed to its parent partner's gateway only when the parent is a
// WHITE_LABEL partner with a ready gateway; otherwise it falls back to platform
// (null). Routing must never depend on anything the caller controls.

const deps = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  getActiveCreds: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: { tenant: { findUnique: deps.tenantFindUnique } },
  };
});
vi.mock("./partnerGateway.service", () => ({
  getActivePartnerGatewayCreds: deps.getActiveCreds,
}));

import { resolvePartnerGatewayForTenant } from "./partnerCharge.service";

const CREDS = { provider: "razorpay", apiSecret: "sec", keyId: "rzp_x", webhookSecret: "wh" };

afterEach(() => vi.clearAllMocks());

describe("resolvePartnerGatewayForTenant", () => {
  it("routes to the parent partner when it's WHITE_LABEL with ready creds", async () => {
    deps.tenantFindUnique.mockResolvedValue({ parentTenant: { id: "partner_1", type: "WHITE_LABEL" } });
    deps.getActiveCreds.mockResolvedValue(CREDS);
    const out = await resolvePartnerGatewayForTenant("cust_1");
    expect(out).toEqual({ partnerTenantId: "partner_1", creds: CREDS });
    expect(deps.getActiveCreds).toHaveBeenCalledWith("partner_1");
  });

  it("returns null (platform) when the tenant has no parent", async () => {
    deps.tenantFindUnique.mockResolvedValue({ parentTenant: null });
    expect(await resolvePartnerGatewayForTenant("direct_1")).toBeNull();
    expect(deps.getActiveCreds).not.toHaveBeenCalled();
  });

  it("returns null when the parent isn't a WHITE_LABEL partner", async () => {
    deps.tenantFindUnique.mockResolvedValue({ parentTenant: { id: "p", type: "DIRECT" } });
    expect(await resolvePartnerGatewayForTenant("cust_1")).toBeNull();
    expect(deps.getActiveCreds).not.toHaveBeenCalled();
  });

  it("returns null when the partner has no ready gateway", async () => {
    deps.tenantFindUnique.mockResolvedValue({ parentTenant: { id: "partner_1", type: "WHITE_LABEL" } });
    deps.getActiveCreds.mockResolvedValue(null);
    expect(await resolvePartnerGatewayForTenant("cust_1")).toBeNull();
  });
});
