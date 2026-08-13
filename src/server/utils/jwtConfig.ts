import { randomBytes } from 'crypto';

// ── JWT_SECRET (lazy resolution) ──
// NOTE: process.env is read at CALL TIME, not module eval time.
// This ensures dotenv.config() in index.ts has already run by the time
// any token sign/verify happens, preventing the "different secret" bug.
// SECURITY: the dev fallback is a random per-process value, not derived
// from hostname/CWD. Predictable per-host derivation would let anyone
// who knows the box fingerprint forge tokens in any misconfigured env.
const DEV_JWT_FALLBACK = randomBytes(32).toString('hex');

const isProd = () => process.env.NODE_ENV === 'production';

/**
 * Resolve the JWT signing/verifying secret at call time.
 * Extracted to a leaf module so middleware (which runs before `authenticate`)
 * can decode the role without importing the full auth module and creating an
 * ESM import cycle.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    if (secret.length < 16) {
      throw new Error('JWT_SECRET must be at least 16 characters');
    }
    return secret;
  }
  if (isProd()) {
    console.warn('⚠️ WARNING: JWT_SECRET not set — using random dev fallback. Set JWT_SECRET in .env for production!');
  }
  return DEV_JWT_FALLBACK;
}

export const JWT_OPTIONS = {
  audience: process.env.JWT_AUDIENCE || 'bizzauto-web',
  issuer: process.env.JWT_ISSUER || 'bizzauto',
};
