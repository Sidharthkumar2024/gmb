import { describe, expect, it } from "vitest";
import { buildInvoicePdfLines, renderInvoicePdf } from "./invoicePdf.service";
import type { Invoice } from "./invoice.service";

const invoice: Invoice = {
  id: "pay_1",
  number: "INV-2026-27-000001",
  status: "PAID",
  issuedAt: new Date("2026-08-02T00:00:00.000Z"),
  currency: "INR",
  seller: { name: "Adgrowly", product: "GMB Suite", supportEmail: "billing@example.com", address: "Bengaluru", gstin: "29ABCDE1234F1Z5" },
  buyer: { tenantId: "t1", name: "Demo Business", address: "Mumbai", gstin: null, placeOfSupply: "Maharashtra" },
  payment: { provider: "RAZORPAY", providerPaymentId: "pay_gateway_1" },
  lines: [{ description: "1,000 GMB Suite credits", quantity: 1000, unitAmountMinor: 1, amountMinor: 8475 }],
  subtotalMinor: 8475,
  taxMinor: 1525,
  taxRateBps: 1800,
  totalMinor: 10000,
};

describe("invoice PDF", () => {
  it("includes the immutable tax and identity snapshot", () => {
    const lines = buildInvoicePdfLines(invoice).join("\n");
    expect(lines).toContain(invoice.number);
    expect(lines).toContain("Supplier GSTIN: 29ABCDE1234F1Z5");
    expect(lines).toContain("GST (18.00%): INR 15.25");
    expect(lines).toContain("Total: INR 100.00");
  });

  it("returns a valid PDF envelope", () => {
    const pdf = renderInvoicePdf(invoice);
    expect(pdf.subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(pdf.toString()).toContain("%%EOF");
  });
});
