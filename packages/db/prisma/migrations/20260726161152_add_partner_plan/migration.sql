-- CreateTable
CREATE TABLE "PartnerPlan" (
    "id" TEXT NOT NULL,
    "partnerTenantId" TEXT NOT NULL,
    "basePlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "retailCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerPlan_partnerTenantId_idx" ON "PartnerPlan"("partnerTenantId");

-- CreateIndex
CREATE INDEX "PartnerPlan_basePlanId_idx" ON "PartnerPlan"("basePlanId");

-- AddForeignKey
ALTER TABLE "PartnerPlan" ADD CONSTRAINT "PartnerPlan_partnerTenantId_fkey" FOREIGN KEY ("partnerTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPlan" ADD CONSTRAINT "PartnerPlan_basePlanId_fkey" FOREIGN KEY ("basePlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
