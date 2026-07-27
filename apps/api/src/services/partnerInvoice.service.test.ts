import { afterEach, describe, expect, it, vi } from "vitest";

// Mocked-Prisma tests for finalised partner invoices. What must hold:
// finalisation is idempotent per (partner, year, month), the number is stable,
// and reads are scoped to the caller's partner tenant.

const deps = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceCreate: vi.fn(),
  tenantFindMany: vi.fn(),
  paymentFindMany: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      partnerInvoice: {
        findUnique: deps.invoiceFindUnique,
        findFirst: deps.invoiceFindFirst,
        create: deps.invoiceCreate,
      },
      tenant: { findMany: deps.tenantFindMany },
      payment: { findMany: deps.paymentFindMany },
    },
  };
});

// The worker import pulls in bullmq/queue; stub it so the unit test stays pure.
vi.mock("../lib/queue", () => ({
  getQueueConnection: () => ({}),
  getPartnerInvoiceQueue: () => ({}),
  QueueNames: { PARTNER_INVOICE: "partner-invoice" },
  trackWorker: () => undefined,
}));
vi.mock("bullmq", () => ({ Worker: class {} }));

import { finalisePartnerInvoice, getPartnerInvoice } from "./partnerInvoice.service";

afterEach(() => vi.clearAllMocks());

describe("finalisePartnerInvoice", () => {
  it("is idempotent — returns the existing invoice without recomputing or creating", async () => {
    deps.invoiceFindUnique.mockResolvedValue({
      id: "pi1",
      number: "PINV-202606-ABC123",
      year: 2026,
      month: 6,
      issuedAt: new Date(),
      snapshot: { totals: {} },
    });
    const out = await finalisePartnerInvoice("partner_1", 2026, 6);
    expect(out.number).toBe("PINV-202606-ABC123");
    expect(deps.invoiceCreate).not.toHaveBeenCalled();
    expect(deps.tenantFindMany).not.toHaveBeenCalled(); // didn't recompute the statement
  });

  it("computes + stores a stable number and the statement snapshot when none exists", async () => {
    deps.invoiceFindUnique.mockResolvedValue(null);
    deps.tenantFindMany.mockResolvedValue([
      { id: "c1", name: "A", plan: { name: "Pro", priceCents: 4900, currency: "USD" } },
    ]);
    deps.paymentFindMany.mockResolvedValue([{ tenantId: "c1", amountMinor: 9900, currency: "USD" }]);
    deps.invoiceCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "pi_new",
      ...data,
      issuedAt: new Date(),
    }));

    const out = await finalisePartnerInvoice("partner_abcdef", 2026, 6);
    expect(out.number).toBe("PINV-202606-ABCDEF"); // period + last-6 of partner id
    expect(out.statement.totals.marginByCurrency).toEqual({ USD: 5000 }); // 9900 − 4900
    const created = deps.invoiceCreate.mock.calls[0][0].data;
    expect(created).toMatchObject({ partnerTenantId: "partner_abcdef", year: 2026, month: 6 });
  });
});

describe("getPartnerInvoice", () => {
  it("scopes to the partner and 404s when not theirs", async () => {
    deps.invoiceFindFirst.mockResolvedValue(null);
    await expect(getPartnerInvoice("partner_1", "pi_other")).rejects.toThrow(/not found/i);
    expect(deps.invoiceFindFirst).toHaveBeenCalledWith({
      where: { id: "pi_other", partnerTenantId: "partner_1" },
    });
  });
});
