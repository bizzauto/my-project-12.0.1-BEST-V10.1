/**
 * Resilient Google OAuth token exchange helper.
 *
 * The OAuth token endpoint (oauth2.googleapis.com/token) is sensitive to
 * transient outbound network failures (ETIMEDOUT / ECONNRESET / ENOTFOUND).
 * This helper wraps axios with a sane timeout and exponential-backoff retries
 * so a single flaky network blip does not permanently fail a GBP/Link callback.
 */
import axios from 'axios';
import { getHttpsProxyAgent } from './httpProxyAgent.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Network errors that are worth retrying (transient, not 4xx/5xx auth failures)
const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ESOCKETTIMEDOUT',
  'ECONNABORTED',
]);

const MAX_RETRIES = 3;
const BASE_TIMEOUT_MS = 15_000; // per attempt
const BASE_BACKOFF_MS = 500; // grows ×2 each retry

function isRetryable(err: unknown): boolean {
  const e = err as { code?: string; response?: unknown };
  // Never retry HTTP responses — those are auth/validation failures
  if (e?.response) return false;
  return !!e?.code && RETRYABLE_CODES.has(e.code);
}

/**
 * Exchange an authorization code or refresh token for a Google access token.
 * Retries transient network errors with exponential backoff.
 */
export async function exchangeGoogleToken(params: Record<string, string>): Promise<any> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const formBody = new URLSearchParams(params).toString();
      const httpsAgent = await getHttpsProxyAgent();
      const res = await axios.post(GOOGLE_TOKEN_URL, formBody, {
        timeout: BASE_TIMEOUT_MS,
        family: 4, // FORCE IPv4: Container IPv6 egress is broken
        ...(httpsAgent ? { httpsAgent } : {}),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return res.data;
    } catch (err: unknown) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) break;

      const backoff = BASE_BACKOFF_MS * 2 ** attempt;
      console.warn(
        `[GoogleOAuth] token exchange attempt ${attempt + 1}/${MAX_RETRIES + 1} failed (${apiErrorCode(err)}) — retrying in ${backoff}ms`
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  console.error('[GoogleOAuth] token exchange failed after retries:', apiErrorCode(lastErr), (lastErr as any)?.message);
  throw lastErr;
}

function apiErrorCode(err: unknown): string {
  const e = err as { code?: string };
  return e?.code ?? 'UNKNOWN';
}
