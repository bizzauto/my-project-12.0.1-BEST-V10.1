-- =============================================================================
-- FIX: password column drift after 20260716_rename_password_column
-- -----------------------------------------------------------------------------
-- Symptom: registered users cannot log in with "Invalid email or password".
-- Root cause: the earlier migration renamed User.passwordHash -> User.password,
-- but on some databases that rename was never applied (or was applied while the
-- Prisma client still wrote to `passwordHash`). The net effect is that the
-- `password` column the app now reads is NULL for previously-registered users,
-- so bcrypt.compare fails and login is rejected.
--
-- This migration is IDEMPOTENT and safe to re-run:
--   1. If only `passwordHash` exists  -> rename it to `password` (original fix).
--   2. If BOTH columns exist          -> copy `passwordHash` into `password`
--                                         where `password` is still NULL.
--   3. If only `password` exists       -> already correct, no-op.
-- No user data is dropped.
-- =============================================================================

DO $$
BEGIN
  -- Case 1: rename never happened (old column present, new one absent)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'passwordHash'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'password'
  ) THEN
    ALTER TABLE "User" RENAME COLUMN "passwordHash" TO "password";

  -- Case 2: both columns present (partial migration) -> merge data
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'passwordHash'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'password'
  ) THEN
    UPDATE "User"
    SET "password" = "passwordHash"
    WHERE "password" IS NULL AND "passwordHash" IS NOT NULL;

    -- Drop the now-redundant legacy column
    ALTER TABLE "User" DROP COLUMN "passwordHash";
  END IF;
END
$$;
