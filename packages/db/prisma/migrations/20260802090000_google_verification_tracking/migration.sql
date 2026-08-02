-- Track the real Google verification resource. A null value identifies legacy
-- requests that were recorded locally but never submitted to Google.
ALTER TABLE "GmbVerificationRequest" ADD COLUMN "googleVerificationName" TEXT;

CREATE INDEX "GmbVerificationRequest_googleVerificationName_idx"
ON "GmbVerificationRequest"("googleVerificationName");
