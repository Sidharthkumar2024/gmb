-- White-label DNS verification and branded sender identity.
ALTER TABLE "WhiteLabelConfig"
  ADD COLUMN "domainVerificationToken" TEXT,
  ADD COLUMN "domainVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "senderName" TEXT,
  ADD COLUMN "senderEmail" TEXT;
CREATE UNIQUE INDEX "WhiteLabelConfig_customDomain_key" ON "WhiteLabelConfig"("customDomain");

-- Support ownership and private staff notes.
ALTER TABLE "SupportTicket" ADD COLUMN "assignedToUserId" TEXT;
ALTER TABLE "SupportTicketMessage" ADD COLUMN "internal" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "SupportTicket_assignedToUserId_idx" ON "SupportTicket"("assignedToUserId");

-- Google resource identities make live writes update/delete-safe.
ALTER TABLE "GmbPlaceAction" ADD COLUMN "googlePlaceActionName" TEXT;
ALTER TABLE "GmbQuestion"
  ADD COLUMN "answerPublishedToGoogle" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "googleAnswerName" TEXT,
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "GmbDescription"
  ADD COLUMN "publishedToGoogle" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

-- Scheduled reporting recipients and observable delivery state.
ALTER TABLE "GmbReportSchedule"
  ADD COLUMN "recipientEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "lastDeliveredAt" TIMESTAMP(3),
  ADD COLUMN "lastDeliveryError" TEXT;

-- Lightweight scheduled centre-point rank capture.
CREATE TABLE "GmbRankSchedule" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "cadenceHours" INTEGER NOT NULL DEFAULT 24,
  "lastRunAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GmbRankSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GmbRankSchedule_tenantId_key" ON "GmbRankSchedule"("tenantId");
CREATE INDEX "GmbRankSchedule_enabled_idx" ON "GmbRankSchedule"("enabled");

-- Immutable buyer profile + sequential accounting invoice snapshots.
CREATE TABLE "BillingProfile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "legalName" TEXT,
  "billingAddress" TEXT,
  "gstin" TEXT,
  "placeOfSupply" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingProfile_tenantId_key" ON "BillingProfile"("tenantId");

CREATE SEQUENCE "TaxInvoice_number_seq" START 1;
CREATE TABLE "TaxInvoice" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "subtotalMinor" INTEGER NOT NULL,
  "taxMinor" INTEGER NOT NULL,
  "totalMinor" INTEGER NOT NULL,
  "taxRateBps" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL,
  "sellerName" TEXT NOT NULL,
  "sellerAddress" TEXT,
  "sellerGstin" TEXT,
  "sellerEmail" TEXT,
  "buyerName" TEXT NOT NULL,
  "buyerAddress" TEXT,
  "buyerGstin" TEXT,
  "placeOfSupply" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxInvoice_paymentId_key" ON "TaxInvoice"("paymentId");
CREATE UNIQUE INDEX "TaxInvoice_number_key" ON "TaxInvoice"("number");
CREATE INDEX "TaxInvoice_tenantId_issuedAt_idx" ON "TaxInvoice"("tenantId", "issuedAt");
CREATE INDEX "TaxInvoice_issuedAt_idx" ON "TaxInvoice"("issuedAt");
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partner wholesale settlement lifecycle.
CREATE TYPE "PartnerInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'OVERDUE', 'VOID');
ALTER TABLE "PartnerInvoice"
  ADD COLUMN "status" "PartnerInvoiceStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "dueAt" TIMESTAMP(3),
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "provider" "PaymentProvider",
  ADD COLUMN "providerPaymentId" TEXT,
  ADD COLUMN "paymentUrl" TEXT;
