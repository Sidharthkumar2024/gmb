import { afterEach, describe, expect, it, vi } from "vitest";

// Regression guard for the Razorpay credit-tampering hole: who/how-much to
// credit must come ONLY from the order we created server-side, never from the
// payment entity's `notes` (which the payer's own Checkout call can populate).
// Trusting payment.notes let an attacker mint 1,000,000 credits for a ~₹1
// payment, or credit an arbitrary tenant.

const deps = vi.hoisted(() => ({ fetchRazorpayOrderNotes: vi.fn() }));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return { ...actual, prisma: {} };
});
vi.mock("../services/razorpay.service", () => ({
  fetchRazorpayOrderNotes: deps.fetchRazorpayOrderNotes,
  verifyRazorpayWebhook: vi.fn(),
  createRazorpayOrder: vi.fn(),
  refundRazorpayPayment: vi.fn(),
}));

import { resolveRazorpayCreditTarget } from "./billing.routes";

afterEach(() => vi.clearAllMocks());

describe("resolveRazorpayCreditTarget — credit target is the order, not the payment", () => {
  it("ignores attacker-supplied payment.notes and uses the server-side order notes", async () => {
    deps.fetchRazorpayOrderNotes.mockResolvedValue({ tenantId: "real-tenant", credits: "1" });

    const res = await resolveRazorpayCreditTarget({
      id: "pay_x",
      order_id: "order_1",
      amount: 100, // ~₹1 actually captured
      notes: { tenantId: "attacker-tenant", credits: "1000000" }, // injected at Checkout
    });

    expect(res.tenantId).toBe("real-tenant"); // NOT "attacker-tenant"
    expect(res.credits).toBe(1); // NOT 1_000_000
    expect(deps.fetchRazorpayOrderNotes).toHaveBeenCalledWith("order_1", undefined);
  });

  it("fails closed (no tenant, 0 credits) when the order can't be read", async () => {
    deps.fetchRazorpayOrderNotes.mockResolvedValue(null);
    const res = await resolveRazorpayCreditTarget({
      id: "p",
      order_id: "order_2",
      notes: { tenantId: "x", credits: "5" },
    });
    expect(res.tenantId).toBeUndefined();
    expect(res.credits).toBe(0);
  });

  it("fails closed when there is no order_id — never trusts payment.notes alone", async () => {
    const res = await resolveRazorpayCreditTarget({
      id: "p",
      notes: { tenantId: "x", credits: "9" },
    });
    expect(res.tenantId).toBeUndefined();
    expect(res.credits).toBe(0);
    expect(deps.fetchRazorpayOrderNotes).not.toHaveBeenCalled();
  });

  it("reads the order on the partner's account when a routed webhook supplies keys", async () => {
    deps.fetchRazorpayOrderNotes.mockResolvedValue({ tenantId: "cust", credits: "10" });
    await resolveRazorpayCreditTarget(
      { id: "p", order_id: "order_3" },
      { razorpayApi: { keyId: "pk", keySecret: "sk" }, scopePartnerId: "partner-1" },
    );
    expect(deps.fetchRazorpayOrderNotes).toHaveBeenCalledWith("order_3", { keyId: "pk", keySecret: "sk" });
  });
});
