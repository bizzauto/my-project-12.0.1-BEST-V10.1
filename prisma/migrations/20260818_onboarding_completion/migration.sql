-- Add onboarding tracking columns to Business
-- Phase E.1: persist onboarding progress to DB (was localStorage-only)
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "onboardingStep" INTEGER NOT NULL DEFAULT 0;
-- Note: "onboardingCompleted" already existed in a prior migration; added defensively.
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;
