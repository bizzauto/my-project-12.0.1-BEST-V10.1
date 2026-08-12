/**
 * Account Lockout Service — Redis-backed per-email brute-force protection.
 * Tracks failed login attempts per email and locks account after threshold.
 */
import { createRedisConnection, isRedisOperational } from '../utils/redis-connection.js';

const redis = createRedisConnection();

const ATTEMPT_PREFIX = 'lockout:attempts:';
const LOCKOUT_PREFIX = 'lockout:locked:';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_SECONDS = 15 * 60; // 15 minutes
const LOCKOUT_DURATION_SECONDS = 30 * 60; // 30 minutes

export interface LockoutStatus {
  locked: boolean;
  attemptsRemaining: number;
  lockedUntil: number | null;
}

function redisReady(): boolean {
  // Defer the 'ready' check to call time — at import time the client is still
  // 'waiting' (lazyConnect), so a synchronous status check would always be false.
  return redis !== null && isRedisOperational();
}

export async function recordFailedLoginAttempt(email: string): Promise<LockoutStatus> {
  if (!redisReady()) return { locked: false, attemptsRemaining: MAX_FAILED_ATTEMPTS, lockedUntil: null };
  const r = redis!;

  try {
    const attemptKey = `${ATTEMPT_PREFIX}${email.toLowerCase()}`;
    const lockKey = `${LOCKOUT_PREFIX}${email.toLowerCase()}`;

    const currentAttempts = await r.incr(attemptKey);
    if (currentAttempts === 1) {
      await r.expire(attemptKey, LOCKOUT_WINDOW_SECONDS);
    }

    if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
      await r.setex(lockKey, LOCKOUT_DURATION_SECONDS, '1');
      await r.del(attemptKey);
      return {
        locked: true,
        attemptsRemaining: 0,
        lockedUntil: Date.now() + LOCKOUT_DURATION_SECONDS * 1000,
      };
    }

    return {
      locked: false,
      attemptsRemaining: MAX_FAILED_ATTEMPTS - currentAttempts,
      lockedUntil: null,
    };
  } catch (err) {
    console.error('[account-lockout] Redis operation failed, lockout protection degraded:', err);
    return { locked: false, attemptsRemaining: MAX_FAILED_ATTEMPTS, lockedUntil: null };
  }
}

export async function clearFailedLoginAttempts(email: string): Promise<void> {
  if (!redisReady()) return;
  const r = redis!;
  try {
    const attemptKey = `${ATTEMPT_PREFIX}${email.toLowerCase()}`;
    await r.del(attemptKey);
  } catch (err) {
    console.error('[account-lockout] Failed to clear login attempts:', err);
  }
}

export async function getLockoutStatus(email: string): Promise<LockoutStatus> {
  if (!redisReady()) return { locked: false, attemptsRemaining: MAX_FAILED_ATTEMPTS, lockedUntil: null };
  const r = redis!;

  try {
    const lockKey = `${LOCKOUT_PREFIX}${email.toLowerCase()}`;
    const ttl = await r.ttl(lockKey);

    if (ttl > 0) {
      return {
        locked: true,
        attemptsRemaining: 0,
        lockedUntil: Date.now() + ttl * 1000,
      };
    }
  } catch (err) {
    console.error('[account-lockout] Failed to get lockout status:', err);
  }

  return { locked: false, attemptsRemaining: MAX_FAILED_ATTEMPTS, lockedUntil: null };
}