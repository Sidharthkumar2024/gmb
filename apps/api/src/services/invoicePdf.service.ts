import type { Invoice } from "./invoice.service";

function money(minor: number, currency: string): string {
  return `${currency.toUpperCase()} ${(minor / 100).toFixed(2)}`;
}

export function buildInvoicePdfLines(invoice: Invoice): string[] {
  return [
    `${invoice.seller.name} — TAX INVOICE`,
    `Invoice: ${invoice.number}`,
    `Issued: ${new Date(invoice.issuedAt).toISOString().slice(0, 10)}   Status: ${invoice.status}`,
    invoice.seller.gstin ? `Supplier GSTIN: ${invoice.seller.gstin}` : "Supplier GSTIN: not configured",
    invoice.seller.address ? `Supplier address: ${invoice.seller.address}` : "",
    "",
    `Bill to: ${invoice.buyer.name}`,
    invoice.buyer.gstin ? `Recipient GSTIN: ${invoice.buyer.gstin}` : "Recipient GSTIN: unregistered/not provided",
    invoice.buyer.address ? `Recipient address: ${invoice.buyer.address}` : "",
    invoice.buyer.placeOfSupply ? `Place of supply: ${invoice.buyer.placeOfSupply}` : "",
    "",
    ...invoice.lines.map((line) => `${line.description} — ${money(line.amountMinor, invoice.currency)}`),
    `Taxable value: ${money(invoice.subtotalMinor, invoice.currency)}`,
    `GST (${(invoice.taxRateBps / 100).toFixed(2)}%): ${money(invoice.taxMinor, invoice.currency)}`,
    `Total: ${money(invoice.totalMinor, invoice.currency)}`,
    "",
    `Payment: ${invoice.payment.provider} / ${invoice.payment.providerPaymentId}`,
    `Support: ${invoice.seller.supportEmail}`,
  ].filter((line) => line !== "");
}

/** Dependency-free valid A4 PDF; server-generated and deterministic. */
export function renderInvoicePdf(invoice: Invoice): Buffer {
  const lines = buildInvoicePdfLines(invoice).map((line) => line.replace(/[()\\]/g, " "));
  const content = `BT /F1 10 Tf 50 790 Td 15 TL ${lines.map((line, index) => index === 0 ? `(${line}) Tj` : `T* (${line}) Tj`).join(" ")} ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  const header = "%PDF-1.4\n";
  let cursor = Buffer.byteLength(header);
  const offsets: number[] = [];
  for (const object of objects) { offsets.push(cursor); cursor += Buffer.byteLength(object); }
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`;
  return Buffer.from(header + objects.join("") + xref);
}
