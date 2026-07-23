-- Drop the orphaned ApiKey row(s) from the old schema
-- This table has a different schema than what Prisma expects,
-- causing db push to fail on required columns without defaults.
-- The 1 existing row is orphaned test data from development.

DELETE FROM "ApiKey" WHERE true;

-- Recreate the table with the correct Prisma schema
DROP TABLE IF EXISTS "ApiKey";

CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "keyHash" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prefix" TEXT,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKey_key_key" ON "ApiKey"("key");

CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

CREATE INDEX "ApiKey_businessId_idx" ON "ApiKey"("businessId");

ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
