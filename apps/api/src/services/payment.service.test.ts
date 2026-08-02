import { afterEach, describe, expect, it, vi } from "vitest";

// Refund must be idempotent and never double-debit: an already-REFUNDED payment
// is a no-op, and a first refund reverses the credits keyed on refund:<id>.

const deps = vi.hoisted(() => ({
  paymentFindUnique: vi.fn(),
  paymentUpdate: vi.fn(),
  reverseCredits: vi.fn(),
  refundRazorpay: vi.fn(),
  refundStripe: vi.fn(),
  getPartnerGatewayCreds: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      payment: { findUnique: deps.paymentFindUnique, update: deps.paymentUpdate },
    },
  };
});
vi.mock("./billing.service", () => ({ reverseCredits: deps.reverseCredits }));
vi.mock("./razorpay.service", () => ({ refundRazorpayPayment: deps.refundRazorpay }));
vi.mock("./stripe.service", () => ({ refundStripeCheckoutSession: deps.refundStripe }));
vi.mock("./partnerGateway.service", () => ({ getPartnerGatewayCreds: deps.getPartnerGatewayCreds }));

import { refundPayment } from "./payment.service";

const base = {
  id: "pay_1",
  tenantId: "t1",
  tenant: { name: "Acme", parentTenantId: null },
  provider: "RAZORPAY",
  providerPaymentId: "rzp_1",
  credits: 500,
  amountMinor: 50000,
  currency: "INR",
  createdAt: new Date(),
};

afterEach(() => vi.clearAllMocks());

describe("refundPayment", () => {
  it("404s when the payment doesn't exist", async () => {
    deps.paymentFindUnique.mockResolvedValue(null);
    await expect(refundPayment("nope")).rejects.toThrow(/not found/i);
    expect(deps.reverseCredits).not.toHaveBeenCalled();
  });

  it("reverses credits (keyed on refund:<id>) and marks REFUNDED on first refund", async () => {
    deps.paymentFindUnique.mockResolvedValue({ ...base, status: "CAPTURED" });
    const out = await refundPayment("pay_1");
    expect(deps.refundRazorpay).toHaveBeenCalledWith("rzp_1", "refund_pay_1", undefined);
    expect(deps.reverseCredits).toHaveBeenCalledWith(
      "t1",
      500,
      expect.objectContaining({ idempotencyKey: "refund:pay_1" }),
    );
    expect(deps.paymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay_1" },
      data: { status: "REFUNDED" },
    });
    expect(out.status).toBe("REFUNDED");
  });

  it("is a no-op when the payment is already REFUNDED", async () => {
    deps.paymentFindUnique.mockResolvedValue({ ...base, status: "REFUNDED" });
    const out = await refundPayment("pay_1");
    expect(deps.reverseCredits).not.toHaveBeenCalled();
    expect(deps.paymentUpdate).not.toHaveBeenCalled();
    expect(out.status).toBe("REFUNDED");
  });
});
