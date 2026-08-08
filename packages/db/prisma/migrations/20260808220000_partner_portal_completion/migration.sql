-- Partner-scoped transactional email overrides. Platform templates remain
-- global; this table prevents one partner from changing another's messages.
CREATE TABLE "PartnerEmailTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "useCustom" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerEmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerEmailTemplate_tenantId_key_key"
ON "PartnerEmailTemplate"("tenantId", "key");

CREATE INDEX "PartnerEmailTemplate_tenantId_idx"
ON "PartnerEmailTemplate"("tenantId");

ALTER TABLE "PartnerEmailTemplate"
ADD CONSTRAINT "PartnerEmailTemplate_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
