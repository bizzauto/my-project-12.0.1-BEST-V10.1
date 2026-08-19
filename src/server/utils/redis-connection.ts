import IORedis from 'ioredis';
import logger from './logger.js';

let redisDisabled = false;
let connectionAttempted = false;
/** Global — once set, ALL Redis activity stops immediately with no retries */
let redisUnreachable = false;

export function isRedisDisabled(): boolean {
  return redisDisabled || redisUnreachable;
}

function maskUrl(url: string): string {
  try {
    return url.replace(/rediss?:\/\/.*@/, (match) => {
      return match.startsWith('rediss://') ? 'rediss://***@' : 'redis://***@';
    });
  } catch {
    return 'invalid-url';
  }
}

export function createRedisConnection() {
  // IMMEDIATE FAIL FAST: If already unreachable, don't even check env vars
  if (redisUnreachable) {
    return null;
  }
  if (redisDisabled || connectionAttempted) {
    return null;
  }
  connectionAttempted = true;

  const redisUrl = process.env.REDIS_URL;
  const redisPassword = process.env.REDIS_PASSWORD;
  const redisHost = process.env.REDIS_HOST;
  const redisPort = process.env.REDIS_PORT;
  // Coolify sometimes injects the full Redis URL into REDIS_USERNAME by mistake
  const redisUsername = process.env.REDIS_USERNAME;
  const redisEnabled = process.env.REDIS_ENABLED;

  console.log(`[Redis] REDIS_URL: ${redisUrl ? `SET (${maskUrl(redisUrl)})` : 'NOT SET'}, REDIS_PASSWORD: ${redisPassword ? 'SET' : 'NOT SET'}, REDIS_HOST: ${redisHost || 'NOT SET'}, REDIS_PORT: ${redisPort || 'NOT SET (default 6379)'}, REDIS_USERNAME: ${redisUsername ? `SET (prefix: ${redisUsername.slice(0, 12)}...)` : 'NOT SET'}, REDIS_ENABLED: ${redisEnabled || 'NOT SET'}`);

  // Check if REDIS_USERNAME contains a full Redis URL (Coolify quirk)
  // Priority: REDIS_URL with auth > REDIS_USERNAME full URL > REDIS_HOST + REDIS_PASSWORD
  const effectiveUrl = (redisUrl && redisUrl.includes('@')) ? redisUrl
    : (redisUsername && redisUsername.startsWith('redis://') && redisUsername.includes('@')) ? redisUsername
    : null;

  // If REDIS_URL is localhost without auth but REDIS_USERNAME has the real URL, use REDIS_USERNAME
  if (redisUrl && !redisUrl.includes('@') && redisUsername && redisUsername.startsWith('redis://') && redisUsername.includes('@')) {
    console.log('[Redis] ⚠️ REDIS_URL has no auth but REDIS_USERNAME contains full URL — using REDIS_USERNAME (Coolify quirk)');
  }

  // Log the effective URL (masked) for debugging
  if (effectiveUrl) {
    console.log(`[Redis] Effective URL: ${maskUrl(effectiveUrl)}`);
  } else if (redisPassword) {
    console.log(`[Redis] Will connect via password to ${redisHost || 'coolify-redis'}:${redisPort || '6379'}`);
  }

  // NUCLEAR: Redis is completely disabled unless REDIS_ENABLED=true
  // This prevents Coolify auto-injected env vars from causing connection floods
  // Note: We do NOT auto-enable even if Coolify injects a URL into REDIS_USERNAME.
  // The user must explicitly set REDIS_ENABLED=true to confirm Redis should be used.
  if (!process.env.REDIS_ENABLED) {
    console.log('[Redis] REDIS_ENABLED not set to true — Redis disabled entirely. Set REDIS_ENABLED=true in env to enable.');
    redisDisabled = true;
    return null;
  }

  // If enabled, still require password for security
  if (!redisPassword && !redisUrl && !redisHost) {
    console.log('[Redis] REDIS_ENABLED but no Redis credentials provided.');
    redisDisabled = true;
    return null;
  }

  if (effectiveUrl) {
    const hasAt = effectiveUrl.includes('@');
    if (!hasAt) {
      console.log('[Redis] REDIS_URL has no @ (no auth) — Redis disabled.');
      redisDisabled = true;
      return null;
    }
    const schemeFree = effectiveUrl.replace(/^rediss?:\/\//, '');
    const passwordPart = schemeFree.split('@')[0];
    if (!passwordPart || passwordPart === ':' || passwordPart === '') {
      console.log('[Redis] REDIS_URL has empty password — Redis disabled.');
      redisDisabled = true;
      return null;
    }
    console.log(`[Redis] Connecting via URL: ${maskUrl(effectiveUrl)}`);
    return connectToRedis(effectiveUrl);
  }

  if (redisPassword) {
    const host = process.env.REDIS_HOST || 'coolify-redis';
    const port = process.env.REDIS_PORT || '6379';
    const url = `redis://:${redisPassword}@${host}:${port}`;
    console.log(`[Redis] Connecting via password to ${host}:${port}...`);
    return connectToRedis(url);
  }

  if (redisHost) {
    console.log('[Redis] REDIS_HOST set but no password — Redis disabled.');
    redisDisabled = true;
    return null;
  }

  return null;
}

function getTimeoutConfig() {
  const cmdTimeout = parseInt(process.env.REDIS_COMMAND_TIMEOUT || '5000', 10);
  const connTimeout = parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000', 10);
  return { commandTimeout: cmdTimeout, connectTimeout: connTimeout };
}

function connectToRedis(url: string) {
  // FAIL FAST: If already marked unreachable, don't even attempt
  if (redisUnreachable || redisDisabled) {
    console.log('[Redis] Already unreachable — skipping connection attempt');
    return null;
  }
  const { commandTimeout, connectTimeout } = getTimeoutConfig();

  console.log(`[Redis] Timeouts — connect: ${connectTimeout}ms, command: ${commandTimeout}ms. Set REDIS_CONNECT_TIMEOUT / REDIS_COMMAND_TIMEOUT env vars to override.`);

  const client = new IORedis(url, {
    maxRetriesPerRequest: null,
    retryStrategy(times: number) {
      // Allow 3 retries with exponential backoff before giving up
      if (times > 3) {
        console.log(`[Redis] ⛔ Connection failed after ${times} attempts — marking Redis as unreachable.`);
        redisUnreachable = true;
        return null;
      }
      const delay = Math.min(times * 1000, 5000);
      console.log(`[Redis] Retry attempt ${times + 1} in ${delay}ms...`);
      return delay;
    },
    enableOfflineQueue: true,
    connectTimeout,
    commandTimeout,
    lazyConnect: true,
  });

  function handleNoAuth(ctx: string) {
    return (err: any) => {
      if (err?.message?.includes('NOAUTH') || err?.message?.includes('AUTH') || err?.message?.includes('WRONGPASS')) {
        console.warn(`[Redis] Auth failed (${ctx}) — disabling Redis. Check REDIS_PASSWORD or REDIS_URL credentials.`);
        redisDisabled = true;
        setTimeout(() => { redisDisabled = false; }, 30000);
        return true;
      }
      return false;
    };
  }

  client.on('error', (err: any) => {
    if (handleNoAuth('error event')(err)) return;
    if (err?.message?.includes('timed out')) {
      console.error(`[Redis] ⏱ Command timed out after ${commandTimeout}ms. Redis marked UNREACHABLE — no further Redis activity. Error: ${err.message}`);
      redisUnreachable = true;
      redisDisabled = true;
      try { client.quit(); } catch {}
    } else {
      console.error(`[Redis] Connection error: ${err.message}`);
    }
  });

  client.on('connect', () => {
    console.log('[Redis] ✅ TCP connected, waiting for ready...');
  });

  client.on('ready', () => {
    console.log('[Redis] ✅ Connected and ready — Redis is operational');
    // Reset disabled/unreachable flags since we connected successfully
    redisDisabled = false;
    redisUnreachable = false;
  });

  client.on('reconnecting', () => {
    console.log('[Redis] Reconnecting...');
  });

  client.on('reconnected', () => {
    console.log('[Redis] ✅ Reconnected successfully — queues are operational again');
    redisDisabled = false;
  });

  client.on('close', () => {
    console.log('[Redis] Connection closed');
  });

  client.connect().catch((err: any) => {
    if (handleNoAuth('on connect')(err)) return;
    if (err?.message?.includes('timed out') || err?.message?.includes('ETIMEDOUT')) {
      console.error(`[Redis] ⏱ Connection timed out after ${connectTimeout}ms. Redis marked UNREACHABLE — no further Redis activity. Check that Redis is running and reachable. Set REDIS_ENABLED=false in env vars to fully disable. Error: ${err.message}`);
      redisUnreachable = true;
    } else {
      console.error(`[Redis] Connect failed: ${err.message}`);
    }
    redisDisabled = true;
    try { client.quit(); } catch {}
  });

  return client;
}
