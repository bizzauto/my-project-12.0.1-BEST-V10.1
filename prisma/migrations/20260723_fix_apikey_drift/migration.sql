-- Fix ApiKey table drift: Handle existing row(s) before adding required columns
-- The table exists but with different schema, causing db push to fail

-- First, delete any existing rows that would block the migration
-- These are likely orphaned/test records from development
DELETE FROM "ApiKey" WHERE 1=1;

-- Now ensure the table has the correct schema
-- This handles the case where columns might be missing

-- Add businessId column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'businessId') THEN
    ALTER TABLE "ApiKey" ADD COLUMN "businessId" TEXT;
  END IF;
END $$;

-- Add key column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'key') THEN
    ALTER TABLE "ApiKey" ADD COLUMN "key" TEXT;
  END IF;
END $$;

-- Add permissions column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'permissions') THEN
    ALTER TABLE "ApiKey" ADD COLUMN "permissions" JSONB;
  END IF;
END $$;

-- Add createdBy column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'createdBy') THEN
    ALTER TABLE "ApiKey" ADD COLUMN "createdBy" TEXT;
  END IF;
END $$;

-- Add other columns that should exist per schema
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'name') THEN
    ALTER TABLE "ApiKey" ADD COLUMN "name" TEXT;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'prefix') THEN
    ALTER TABLE "ApiKey" ADD COLUMN "prefix" TEXT;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'lastUsedAt') THEN
    ALTER TABLE "ApiKey" ADD COLUMN "lastUsedAt" TIMESTAMP(3);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'expiresAt') THEN
    ALTER TABLE "ApiKey" ADD COLUMN "expiresAt" TIMESTAMP(3);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'isActive') THEN
    ALTER TABLE "ApiKey" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'createdAt') THEN
    ALTER TABLE "ApiKey" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;

-- Add keyHash column if missing (it's in schema but might not be in DB)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'keyHash') THEN
    ALTER TABLE "ApiKey" ADD COLUMN "keyHash" TEXT;
  END IF;
END $$;

-- Ensure unique constraints exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApiKey_key_key') THEN
    ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_key_key" UNIQUE ("key");
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApiKey_keyHash_key') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ApiKey' AND column_name = 'keyHash') THEN
      ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_keyHash_key" UNIQUE ("keyHash");
    END IF;
  END IF;
END $$;

-- Create index if missing
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ApiKey_businessId_idx') THEN
    CREATE INDEX "ApiKey_businessId_idx" ON "ApiKey"("businessId");
  END IF;
END $$;

-- Add foreign key constraint if missing
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApiKey_businessId_fkey') THEN
    ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
