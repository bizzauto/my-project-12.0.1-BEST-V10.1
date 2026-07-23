-- Remove two-factor authentication (2FA) feature at user request.
-- Drops the three 2FA columns from the User table. No data loss beyond
-- the (now unused) secrets/backup codes. Idempotent via IF EXISTS.

ALTER TABLE "User" DROP COLUMN IF EXISTS "twoFactorSecret";
ALTER TABLE "User" DROP COLUMN IF EXISTS "twoFactorEnabled";
ALTER TABLE "User" DROP COLUMN IF EXISTS "twoFactorBackupCodes";
