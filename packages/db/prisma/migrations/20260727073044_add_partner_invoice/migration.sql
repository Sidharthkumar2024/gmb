-- CreateTable
CREATE TABLE "PartnerInvoice" (
    "id" TEXT NOT NULL,
    "partnerTenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerInvoice_number_key" ON "PartnerInvoice"("number");

-- CreateIndex
CREATE INDEX "PartnerInvoice_partnerTenantId_issuedAt_idx" ON "PartnerInvoice"("partnerTenantId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerInvoice_partnerTenantId_year_month_key" ON "PartnerInvoice"("partnerTenantId", "year", "month");

-- AddForeignKey
ALTER TABLE "PartnerInvoice" ADD CONSTRAINT "PartnerInvoice_partnerTenantId_fkey" FOREIGN KEY ("partnerTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
