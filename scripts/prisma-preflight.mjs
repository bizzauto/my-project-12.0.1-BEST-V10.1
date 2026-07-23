/**
 * Run before Prisma migrations — removes orphaned rows that block db push.
 * The ApiKey table has 1 stale row from a prior dev schema that lacks
 * required columns (businessId, key, permissions). Prisma refuses to add
 * NON NULL columns while data exists, so we clean it first.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Delete any ApiKey rows that are missing required columns
  const count = await prisma.$executeRawUnsafe(`DELETE FROM "ApiKey" WHERE "businessId" IS NULL`);
  if (count > 0) console.log(`[preflight] Deleted ${count} orphaned ApiKey row(s)`);

  // Also try deleting rows that might have empty businessId
  const count2 = await prisma.$executeRawUnsafe(`DELETE FROM "ApiKey" WHERE "businessId" = ''`);
  if (count2 > 0) console.log(`[preflight] Deleted ${count2} empty-businessId ApiKey row(s)`);
}

main()
  .catch((e) => {
    // Table may not exist yet (fresh DB) — that's fine
    if (e.message?.includes('relation') && e.message?.includes('does not exist')) {
      console.log('[preflight] ApiKey table not yet created, skipping cleanup');
      process.exit(0);
    }
    console.error('[preflight] Cleanup failed:', e.message);
    process.exit(0); // Don't block deployment
  })
  .finally(() => prisma.$disconnect());
