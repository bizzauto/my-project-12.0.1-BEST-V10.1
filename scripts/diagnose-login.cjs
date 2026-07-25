/**
 * DIAGNOSE LOGIN FAILURE
 * ----------------------------------------------------------------------------
 * Run this ON THE SERVER where the database is reachable:
 *
 *   node scripts/diagnose-login.cjs
 *
 * It inspects the live User table to confirm (or rule out) the password
 * column drift that causes "Invalid email or password" for every user.
 *
 * What it reports:
 *   1. Does the `User` table have a `password` column? a `passwordHash` column?
 *   2. How many users exist, and how many have a NULL `password`?
 *   3. (Safe) A bcrypt round-trip sanity check using a test string.
 *
 * It NEVER modifies data. Re-run after applying the fix migration to confirm.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('=== LOGIN DIAGNOSTIC ===\n');

  // 1. Column presence
  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'User'
      AND column_name IN ('password', 'passwordHash')
    ORDER BY column_name;
  `);
  const colNames = columns.map((c) => c.column_name);
  console.log('Columns present on User:', colNames.length ? colNames : '(none found)');
  console.log('  has password:      ', colNames.includes('password'));
  console.log('  has passwordHash:  ', colNames.includes('passwordHash'));

  // 2. Counts
  const total = await prisma.user.count();
  console.log('\nTotal users:', total);

  if (colNames.includes('password')) {
    const nullPw = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "User" WHERE "password" IS NULL;`
    );
    console.log('Users with NULL password:', nullPw[0].n);
  }
  if (colNames.includes('passwordHash')) {
    const nullOld = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "User" WHERE "passwordHash" IS NULL;`
    );
    console.log('Users with NULL passwordHash:', nullOld[0].n);
  }

  // 3. bcrypt sanity (proves hashing/compare logic itself works)
  const testPlain = 'DiagnosticTest123!';
  const hash = await bcrypt.hash(testPlain, 12);
  const ok = await bcrypt.compare(testPlain, hash);
  console.log('\nbcrypt round-trip works:', ok ? 'YES' : 'NO (serious problem!)');

  // 4. Verdict
  console.log('\n=== VERDICT ===');
  if (colNames.includes('passwordHash') && !colNames.includes('password')) {
    console.log('❌ DRIFT CONFIRMED: only `passwordHash` exists.');
    console.log('   Fix: apply prisma migration 20260720_fix_password_column_drift');
    console.log('   Command: npx prisma migrate deploy');
  } else if (colNames.includes('passwordHash') && colNames.includes('password')) {
    console.log('⚠️  PARTIAL DRIFT: both columns exist.');
    console.log('   Fix: apply prisma migration 20260720_fix_password_column_drift');
    console.log('   Command: npx prisma migrate deploy');
  } else if (colNames.includes('password')) {
    const nullPw = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "User" WHERE "password" IS NULL;`
    );
    if (nullPw[0].n > 0) {
      console.log(`⚠️  ${nullPw[0].n} users have a NULL password (never saved correctly).`);
      console.log('   These users must reset their password, OR restore from backup.');
    } else {
      console.log('✅ password column exists and is populated. Drift NOT the cause.');
      console.log('   Check: wrong JWT_SECRET? User entering wrong credentials?');
    }
  } else {
    console.log('❌ No password column at all — schema is severely out of sync.');
    console.log('   Fix: npx prisma migrate deploy (apply all pending migrations).');
  }
}

main()
  .catch((e) => {
    console.error('\nDIAGNOSTIC ERROR:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
