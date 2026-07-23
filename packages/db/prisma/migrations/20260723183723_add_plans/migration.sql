-- CreateEnum
CREATE TYPE "PlanInterval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "planId" TEXT;

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "interval" "PlanInterval" NOT NULL DEFAULT 'MONTH',
    "monthlyCredits" INTEGER NOT NULL DEFAULT 0,
    "maxLocations" INTEGER,
    "maxKeywords" INTEGER,
    "maxUsers" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateIndex
CREATE INDEX "Plan_status_idx" ON "Plan"("status");

-- CreateIndex
CREATE INDEX "Tenant_planId_idx" ON "Tenant"("planId");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
