-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('DIRECT', 'WHITE_LABEL');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'WHITE_LABEL_ADMIN', 'BUSINESS_ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "SecretScope" AS ENUM ('PLATFORM', 'PARTNER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "SecretProvider" AS ENUM ('GOOGLE_BUSINESS_PROFILE', 'OPENAI', 'ANTHROPIC', 'GEMINI', 'REPLICATE', 'SMTP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SecretStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AiProviderKey" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'DEEPSEEK', 'GROK', 'REPLICATE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'VOICE', 'EMBEDDING');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AiProviderStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "GoogleApiLogStatus" AS ENUM ('OK', 'ERROR', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "GmbPostType" AS ENUM ('UPDATE', 'OFFER', 'EVENT');

-- CreateEnum
CREATE TYPE "GmbPostStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "GmbLocationStatus" AS ENUM ('DRAFT', 'CONNECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "GmbReviewStatus" AS ENUM ('NEW', 'REPLIED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "GmbQuestionStatus" AS ENUM ('NEW', 'ANSWERED', 'IGNORED');

-- CreateEnum
CREATE TYPE "GmbVerificationMethod" AS ENUM ('PHONE_CALL', 'SMS', 'EMAIL', 'POSTCARD');

-- CreateEnum
CREATE TYPE "GmbVerificationRequestState" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "GmbPlaceActionType" AS ENUM ('BOOK', 'APPOINTMENT', 'RESERVE', 'ORDER_ONLINE', 'DINING_RESERVATION');

-- CreateEnum
CREATE TYPE "GmbCitationStatus" AS ENUM ('LIVE', 'PENDING', 'MISSING');

-- CreateEnum
CREATE TYPE "GmbReportType" AS ENUM ('WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GmbDescriptionTarget" AS ENUM ('BUSINESS', 'SERVICE', 'PRODUCT');

-- CreateEnum
CREATE TYPE "GmbDescriptionStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GmbImageStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "TenantType" NOT NULL DEFAULT 'DIRECT',
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "parentTenantId" TEXT,
    "industry" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'BUSINESS_ADMIN',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByHash" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL DEFAULT 'en',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretVaultEntry" (
    "id" TEXT NOT NULL,
    "scope" "SecretScope" NOT NULL,
    "tenantId" TEXT,
    "provider" "SecretProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "last4" TEXT,
    "metadata" TEXT,
    "status" "SecretStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRotatedAt" TIMESTAMP(3),
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecretVaultEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costInCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "balanceCredits" INTEGER NOT NULL DEFAULT 0,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderConfig" (
    "id" TEXT NOT NULL,
    "scope" "SecretScope" NOT NULL,
    "tenantId" TEXT,
    "provider" "AiProviderKey" NOT NULL,
    "kind" "AiProviderKind" NOT NULL DEFAULT 'TEXT',
    "label" TEXT NOT NULL,
    "secretId" TEXT,
    "defaultModel" TEXT,
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "baseUrl" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPromptTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "template" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleOAuthConfig" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL DEFAULT '',
    "clientSecretCipher" TEXT,
    "clientSecretLast4" TEXT,
    "redirectUri" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT 'https://www.googleapis.com/auth/business.manage',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleOAuthConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleApiLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "operation" TEXT NOT NULL,
    "status" "GoogleApiLogStatus" NOT NULL DEFAULT 'OK',
    "statusCode" INTEGER,
    "message" TEXT,
    "rateLimitRemaining" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "oldValues" TEXT,
    "newValues" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0f766e',
    "secondaryColor" TEXT NOT NULL DEFAULT '#065f46',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbPost" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "GmbPostType" NOT NULL DEFAULT 'UPDATE',
    "summary" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "callToActionType" TEXT,
    "callToActionUrl" TEXT,
    "locationLabel" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "status" "GmbPostStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbAutopilotConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "businessName" TEXT NOT NULL,
    "niche" TEXT NOT NULL DEFAULT 'general',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "postsPerRun" INTEGER NOT NULL DEFAULT 3,
    "cadenceHours" INTEGER NOT NULL DEFAULT 168,
    "autoDraftReplies" BOOLEAN NOT NULL DEFAULT true,
    "replyTone" TEXT NOT NULL DEFAULT 'warm',
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbAutopilotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbLocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storeCode" TEXT,
    "placeId" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "primaryCategory" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "GmbLocationStatus" NOT NULL DEFAULT 'DRAFT',
    "verificationState" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "secretId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbVerificationRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "method" "GmbVerificationMethod" NOT NULL,
    "state" "GmbVerificationRequestState" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbVerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbPlaceAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "actionType" "GmbPlaceActionType" NOT NULL,
    "url" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "publishedToGoogle" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbPlaceAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbQuestion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "externalQuestionId" TEXT,
    "authorName" TEXT,
    "questionText" TEXT NOT NULL,
    "askedAt" TIMESTAMP(3),
    "status" "GmbQuestionStatus" NOT NULL DEFAULT 'NEW',
    "answerText" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "externalReviewId" TEXT,
    "authorName" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "status" "GmbReviewStatus" NOT NULL DEFAULT 'NEW',
    "replyText" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbTrackedKeyword" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbTrackedKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbRankAlertRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "thresholdRank" INTEGER NOT NULL,
    "notifyEmail" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "lastTriggeredRank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbRankAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbRankSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "rank" INTEGER,
    "source" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmbRankSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbRankGridSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "gridSize" INTEGER NOT NULL DEFAULT 5,
    "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "points" TEXT NOT NULL,
    "competitors" TEXT,
    "battleMap" TEXT,
    "avgRank" DOUBLE PRECISION,
    "top3Share" DOUBLE PRECISION,
    "foundShare" DOUBLE PRECISION,
    "source" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmbRankGridSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbInsightSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "mapsViews" INTEGER NOT NULL DEFAULT 0,
    "searchViews" INTEGER NOT NULL DEFAULT 0,
    "directSearches" INTEGER NOT NULL DEFAULT 0,
    "discoverySearches" INTEGER NOT NULL DEFAULT 0,
    "brandedSearches" INTEGER NOT NULL DEFAULT 0,
    "callClicks" INTEGER NOT NULL DEFAULT 0,
    "websiteClicks" INTEGER NOT NULL DEFAULT 0,
    "directionRequests" INTEGER NOT NULL DEFAULT 0,
    "messageClicks" INTEGER NOT NULL DEFAULT 0,
    "bookingClicks" INTEGER NOT NULL DEFAULT 0,
    "photoViews" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbInsightSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbCitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "directory" TEXT NOT NULL,
    "listingUrl" TEXT,
    "napName" TEXT,
    "napAddress" TEXT,
    "napPhone" TEXT,
    "status" "GmbCitationStatus" NOT NULL DEFAULT 'PENDING',
    "lastCheckedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "type" "GmbReportType" NOT NULL DEFAULT 'MONTHLY',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "summary" TEXT,
    "actionPlan" JSONB,
    "generatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmbReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbKeywordIdeaSet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "category" TEXT,
    "city" TEXT,
    "region" TEXT,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "competitors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ideas" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmbKeywordIdeaSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbDescription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "target" "GmbDescriptionTarget" NOT NULL DEFAULT 'BUSINESS',
    "label" TEXT,
    "original" TEXT NOT NULL,
    "optimized" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxLength" INTEGER,
    "analysis" JSONB,
    "status" "GmbDescriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbAdvisorReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "breakdown" JSONB NOT NULL,
    "tasks" JSONB NOT NULL,
    "summary" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmbAdvisorReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbImageRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "subject" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "style" TEXT,
    "palette" TEXT,
    "size" TEXT NOT NULL DEFAULT '1024x1024',
    "quality" TEXT,
    "provider" TEXT,
    "secretId" TEXT,
    "status" "GmbImageStatus" NOT NULL DEFAULT 'PENDING',
    "resultUrl" TEXT,
    "error" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbImageRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbReportSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "GmbReportType" NOT NULL DEFAULT 'MONTHLY',
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE INDEX "Tenant_parentTenantId_idx" ON "Tenant"("parentTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSettings_tenantId_key" ON "TenantSettings"("tenantId");

-- CreateIndex
CREATE INDEX "SecretVaultEntry_scope_tenantId_idx" ON "SecretVaultEntry"("scope", "tenantId");

-- CreateIndex
CREATE INDEX "SecretVaultEntry_scope_tenantId_provider_idx" ON "SecretVaultEntry"("scope", "tenantId", "provider");

-- CreateIndex
CREATE INDEX "SecretVaultEntry_tenantId_status_idx" ON "SecretVaultEntry"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AiUsage_tenantId_idx" ON "AiUsage"("tenantId");

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- CreateIndex
CREATE INDEX "Wallet_tenantId_idx" ON "Wallet"("tenantId");

-- CreateIndex
CREATE INDEX "AiProviderConfig_scope_tenantId_idx" ON "AiProviderConfig"("scope", "tenantId");

-- CreateIndex
CREATE INDEX "AiProviderConfig_scope_tenantId_kind_status_priority_idx" ON "AiProviderConfig"("scope", "tenantId", "kind", "status", "priority");

-- CreateIndex
CREATE INDEX "AiProviderConfig_secretId_idx" ON "AiProviderConfig"("secretId");

-- CreateIndex
CREATE UNIQUE INDEX "AiPromptTemplate_key_key" ON "AiPromptTemplate"("key");

-- CreateIndex
CREATE INDEX "AiPromptTemplate_category_isActive_idx" ON "AiPromptTemplate"("category", "isActive");

-- CreateIndex
CREATE INDEX "GoogleApiLog_tenantId_createdAt_idx" ON "GoogleApiLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "GoogleApiLog_locationId_idx" ON "GoogleApiLog"("locationId");

-- CreateIndex
CREATE INDEX "GoogleApiLog_status_idx" ON "GoogleApiLog"("status");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrandKit_tenantId_key" ON "BrandKit"("tenantId");

-- CreateIndex
CREATE INDEX "GmbPost_tenantId_status_idx" ON "GmbPost"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GmbPost_tenantId_scheduledAt_idx" ON "GmbPost"("tenantId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "GmbAutopilotConfig_tenantId_key" ON "GmbAutopilotConfig"("tenantId");

-- CreateIndex
CREATE INDEX "GmbAutopilotConfig_enabled_idx" ON "GmbAutopilotConfig"("enabled");

-- CreateIndex
CREATE INDEX "GmbLocation_tenantId_status_idx" ON "GmbLocation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GmbLocation_tenantId_placeId_idx" ON "GmbLocation"("tenantId", "placeId");

-- CreateIndex
CREATE INDEX "GmbVerificationRequest_tenantId_idx" ON "GmbVerificationRequest"("tenantId");

-- CreateIndex
CREATE INDEX "GmbVerificationRequest_locationId_state_idx" ON "GmbVerificationRequest"("locationId", "state");

-- CreateIndex
CREATE INDEX "GmbPlaceAction_tenantId_idx" ON "GmbPlaceAction"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "GmbPlaceAction_locationId_actionType_key" ON "GmbPlaceAction"("locationId", "actionType");

-- CreateIndex
CREATE INDEX "GmbQuestion_tenantId_status_idx" ON "GmbQuestion"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GmbQuestion_locationId_idx" ON "GmbQuestion"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "GmbQuestion_locationId_externalQuestionId_key" ON "GmbQuestion"("locationId", "externalQuestionId");

-- CreateIndex
CREATE INDEX "GmbReview_tenantId_status_idx" ON "GmbReview"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GmbReview_locationId_idx" ON "GmbReview"("locationId");

-- CreateIndex
CREATE INDEX "GmbTrackedKeyword_tenantId_isActive_idx" ON "GmbTrackedKeyword"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "GmbTrackedKeyword_locationId_keyword_key" ON "GmbTrackedKeyword"("locationId", "keyword");

-- CreateIndex
CREATE INDEX "GmbRankAlertRule_tenantId_idx" ON "GmbRankAlertRule"("tenantId");

-- CreateIndex
CREATE INDEX "GmbRankAlertRule_keywordId_isActive_idx" ON "GmbRankAlertRule"("keywordId", "isActive");

-- CreateIndex
CREATE INDEX "GmbRankSnapshot_keywordId_checkedAt_idx" ON "GmbRankSnapshot"("keywordId", "checkedAt");

-- CreateIndex
CREATE INDEX "GmbRankSnapshot_tenantId_idx" ON "GmbRankSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "GmbRankGridSnapshot_keywordId_capturedAt_idx" ON "GmbRankGridSnapshot"("keywordId", "capturedAt");

-- CreateIndex
CREATE INDEX "GmbRankGridSnapshot_tenantId_idx" ON "GmbRankGridSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "GmbInsightSnapshot_tenantId_periodStart_idx" ON "GmbInsightSnapshot"("tenantId", "periodStart");

-- CreateIndex
CREATE INDEX "GmbInsightSnapshot_locationId_periodStart_idx" ON "GmbInsightSnapshot"("locationId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "GmbInsightSnapshot_locationId_periodStart_periodEnd_key" ON "GmbInsightSnapshot"("locationId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "GmbCitation_tenantId_status_idx" ON "GmbCitation"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GmbCitation_locationId_directory_key" ON "GmbCitation"("locationId", "directory");

-- CreateIndex
CREATE INDEX "GmbReport_tenantId_type_idx" ON "GmbReport"("tenantId", "type");

-- CreateIndex
CREATE INDEX "GmbReport_locationId_idx" ON "GmbReport"("locationId");

-- CreateIndex
CREATE INDEX "GmbKeywordIdeaSet_tenantId_idx" ON "GmbKeywordIdeaSet"("tenantId");

-- CreateIndex
CREATE INDEX "GmbDescription_tenantId_status_idx" ON "GmbDescription"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GmbAdvisorReport_tenantId_idx" ON "GmbAdvisorReport"("tenantId");

-- CreateIndex
CREATE INDEX "GmbImageRequest_tenantId_status_idx" ON "GmbImageRequest"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GmbReportSchedule_tenantId_key" ON "GmbReportSchedule"("tenantId");

-- CreateIndex
CREATE INDEX "GmbReportSchedule_enabled_idx" ON "GmbReportSchedule"("enabled");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_parentTenantId_fkey" FOREIGN KEY ("parentTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSettings" ADD CONSTRAINT "TenantSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretVaultEntry" ADD CONSTRAINT "SecretVaultEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProviderConfig" ADD CONSTRAINT "AiProviderConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleApiLog" ADD CONSTRAINT "GoogleApiLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbPost" ADD CONSTRAINT "GmbPost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbLocation" ADD CONSTRAINT "GmbLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbVerificationRequest" ADD CONSTRAINT "GmbVerificationRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbVerificationRequest" ADD CONSTRAINT "GmbVerificationRequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbPlaceAction" ADD CONSTRAINT "GmbPlaceAction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbPlaceAction" ADD CONSTRAINT "GmbPlaceAction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbQuestion" ADD CONSTRAINT "GmbQuestion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbQuestion" ADD CONSTRAINT "GmbQuestion_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbReview" ADD CONSTRAINT "GmbReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbReview" ADD CONSTRAINT "GmbReview_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbTrackedKeyword" ADD CONSTRAINT "GmbTrackedKeyword_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbTrackedKeyword" ADD CONSTRAINT "GmbTrackedKeyword_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbRankAlertRule" ADD CONSTRAINT "GmbRankAlertRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbRankAlertRule" ADD CONSTRAINT "GmbRankAlertRule_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "GmbTrackedKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbRankSnapshot" ADD CONSTRAINT "GmbRankSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbRankSnapshot" ADD CONSTRAINT "GmbRankSnapshot_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "GmbTrackedKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbRankGridSnapshot" ADD CONSTRAINT "GmbRankGridSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbRankGridSnapshot" ADD CONSTRAINT "GmbRankGridSnapshot_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "GmbTrackedKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbInsightSnapshot" ADD CONSTRAINT "GmbInsightSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbInsightSnapshot" ADD CONSTRAINT "GmbInsightSnapshot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbCitation" ADD CONSTRAINT "GmbCitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbCitation" ADD CONSTRAINT "GmbCitation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbReport" ADD CONSTRAINT "GmbReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbReport" ADD CONSTRAINT "GmbReport_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbKeywordIdeaSet" ADD CONSTRAINT "GmbKeywordIdeaSet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbDescription" ADD CONSTRAINT "GmbDescription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbAdvisorReport" ADD CONSTRAINT "GmbAdvisorReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbImageRequest" ADD CONSTRAINT "GmbImageRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

