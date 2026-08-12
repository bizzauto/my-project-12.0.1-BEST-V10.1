/**
 * Token Blacklist Service — Redis-backed JWT revocation
 * Invalidates refresh tokens on password change, logout, or security events.
 * Uses JWT ID (jti) as the key, stored in Redis with TTL matching token expiry.
 */
import { createRedisConnection, isRedisOperational } from '../utils/redis-connection.js';

const redis = createRedisConnection();

const TOKEN_BLACKLIST_PREFIX = 'token:blacklist:';
const REFRESH_TOKEN_PREFIX = 'refresh:valid:';

function redisReady(): boolean {
  // Defer the 'ready' check to call time — at import time the client is still
  // 'waiting' (lazyConnect), so a synchronous status check would always be false.
  return redis !== null && isRedisOperational();
}

export function blacklistToken(jti: string, expiresInMs: number): void {
  if (!redisReady()) return;
  const r = redis!;
  try {
    const key = `${TOKEN_BLACKLIST_PREFIX}${jti}`;
    const ttlSeconds = Math.ceil(expiresInMs / 1000);
    r.setex(key, ttlSeconds, '1').catch((err) => {
      console.error('[token-blacklist] Failed to blacklist token:', err);
    });
  } catch (err) {
    console.error('[token-blacklist] blacklistToken error:', err);
  }
}

export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  if (!redisReady()) return false;
  const r = redis!;
  try {
    const key = `${TOKEN_BLACKLIST_PREFIX}${jti}`;
    const result = await r.get(key);
    return result !== null;
  } catch (err) {
    console.error('[token-blacklist] Failed to check token:', err);
    return false;
  }
}

export async function blacklistRefreshToken(userId: string, expiresInMs: number): Promise<void> {
  if (!redisReady()) return;
  const r = redis!;
  try {
    const key = `${REFRESH_TOKEN_PREFIX}${userId}`;
    const ttlSeconds = Math.ceil(expiresInMs / 1000);
    await r.setex(key, ttlSeconds, 'revoked').catch((err) => {
      console.error('[token-blacklist] Failed to blacklist refresh token:', err);
    });
  } catch (err) {
    console.error('[token-blacklist] blacklistRefreshToken error:', err);
  }
}

export async function isRefreshTokenRevoked(userId: string): Promise<boolean> {
  if (!redisReady()) return false;
  const r = redis!;
  try {
    const key = `${REFRESH_TOKEN_PREFIX}${userId}`;
    const val = await r.get(key);
    return val === 'revoked';
  } catch {
    return false;
  }
}

export function revokeAllUserTokens(userId: string): void {
  if (!redisReady()) return;
  try {
    blacklistRefreshToken(userId, 30 * 24 * 60 * 60 * 1000).catch((err) => {
      console.error('[token-blacklist] Failed to revoke all user tokens:', err);
    });
  } catch (err) {
    console.error('[token-blacklist] revokeAllUserTokens error:', err);
  }
}