/**
 * Resilient Google Business Profile (GBP) API client.
 *
 * WHY THIS EXISTS
 * ---------------
 * Google's Business Profile APIs (mybusinessbusinessinformation.googleapis.com,
 * mybusiness.googleapis.com) throttle aggressively:
 *   - Test/unverified OAuth apps:       ~1 req / 15s, bursts quickly hit 429.
 *   - Projects without Cloud Billing:   stricter undocumented quota, also 429.
 *   - Shared-IP / cross-account usage:  quota is per-credential, exhausts fast.
 *
 * The original OAuth callback called these APIs directly with `axios.get`.
 * A single 429 there crashed the whole "Connect" flow with a generic error.
 * This service centralises retries + backoff + clear quota errors so connect
 * survives a transient 429 and explains a persistent one.
 *
 * NOTE ON SERVICE ACCOUNTS
 * -------------------------
 * GBP APIs do NOT support service accounts. The OAuth client MUST be a normal
 * "Web application" client, and the Google account used during OAuth must own
 * or manage the Business Profile. If you wired a service-account / "sub"
 * credential, the connect will fail with 403 (not 429) — enable the GBP APIs
 * in the SAME project as the Web OAuth client and sign in as a GBP owner.
 */
import axios, { AxiosError } from 'axios';
import { getHttpsProxyAgent } from './httpProxyAgent.js';

const BUSINESS_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const BUSINESS_API_BASE = 'https://mybusiness.googleapis.com/v4';

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 800; // first retry after ~0.8s, grows ×2
const MAX_BACKOFF_MS = 32_000;
// Google TEST-mode (unverified consent screen) throttles to ~1 req / 15s.
// A backoff below this window just re-hits the same 429, so floor retries for
// 429 specifically to give the throttle time to reset.
const RATE_LIMIT_FLOOR_MS = 15_000;

// HTTP statuses worth retrying (transient throttling / upstream hiccups).
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class GBPQuotaError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'GBPQuotaError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(headerValue: string | undefined): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  // Retry-After can also be an HTTP date; fall back to null if unparseable.
  const date = Date.parse(headerValue);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

interface CallArgs {
  url: string;
  accessToken: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Label used in logs + the thrown error, e.g. "accounts". */
  label: string;
}

/**
 * Single resilient call. Retries on 429/5xx with exponential backoff that
 * honours Google's Retry-After header, then throws a GBPQuotaError carrying
 * actionable guidance on a persistent failure.
 */
async function resilientCall({ url, accessToken, method = 'GET', body, label }: CallArgs) {
  let lastErr: AxiosError | null = null;

  const httpsAgent = await getHttpsProxyAgent();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await axios({
        url,
        method,
        data: body,
        ...(httpsAgent ? { httpsAgent } : {}),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      });
    } catch (err) {
      const axiosErr = err as AxiosError;
      lastErr = axiosErr;
      const status = axiosErr.response?.status;

      if (!status || !RETRYABLE_STATUS.has(status)) break; // non-retryable
      if (attempt === MAX_RETRIES) break;

      const retryAfter = parseRetryAfter(axiosErr.response?.headers['retry-after'] as string | undefined);
      const computed = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      // For 429 specifically, never back off below the TEST-mode throttle window.
      const floor = status === 429 ? RATE_LIMIT_FLOOR_MS : 0;
      const base = retryAfter ?? Math.max(computed, floor);
      // Add up to ~25% jitter so concurrent callbacks don't retry in lockstep.
      const backoff = Math.round(base * (1 + Math.random() * 0.25));

      console.warn(
        `[GBP API] ${label} call 429/5xx (attempt ${attempt + 1}/${MAX_RETRIES + 1}, status ${status}) — backing off ${backoff}ms`
      );
      await sleep(backoff);
    }
  }

  const status = lastErr?.response?.status ?? 0;
  const data: unknown = lastErr?.response?.data;
  const body2 = (data as { error?: { message?: string; status?: string } } | undefined)?.error;
  const googleMsg = body2?.message ?? lastErr?.message ?? 'Unknown Google API error';

  console.error(`[GBP API] ${label} call FAILED after retries:`, { status, googleMsg });

  if (status === 429) {
    throw new GBPQuotaError(
      'Google Business Profile API rate limit reached. This usually means the OAuth app is still in TEST mode or Cloud Billing is not enabled on the project. ' +
        'Enable Cloud Billing, publish/verify the OAuth consent screen, and retry after a short wait.',
      status
    );
  }
  throw new GBPQuotaError(googleMsg, status);
}

export const GoogleBusinessApi = {
  /** Fetch the authenticated user's GBP accounts. */
  async getAccounts(accessToken: string) {
    const res = await resilientCall({
      url: `${BUSINESS_INFO_BASE}/accounts`,
      accessToken,
      label: 'accounts',
    });
    return res.data?.accounts ?? [];
  },

  /** Fetch the authenticated user's basic profile (email/name) via OAuth2 userinfo. */
  async getUserInfo(accessToken: string) {
    const res = await resilientCall({
      url: 'https://www.googleapis.com/oauth2/v2/userinfo',
      accessToken,
      label: 'userinfo',
    });
    return res.data ?? {};
  },

  /** Fetch locations for a GBP account. */
  async getLocations(accessToken: string, accountId: string) {
    const res = await resilientCall({
      url: `${BUSINESS_INFO_BASE}/accounts/${accountId}/locations`,
      accessToken,
      label: 'locations',
    });
    return res.data?.locations ?? [];
  },

  /** Fetch reviews for a location (v4). */
  async getReviews(accessToken: string, accountId: string, locationId: string) {
    const res = await resilientCall({
      url: `${BUSINESS_API_BASE}/accounts/${accountId}/locations/${locationId}/reviews`,
      accessToken,
      label: 'reviews',
    });
    return res.data?.reviews ?? [];
  },

  /** Reply to a review (v4). */
  async replyToReview(
    accessToken: string,
    accountId: string,
    locationId: string,
    reviewId: string,
    comment: string
  ) {
    return resilientCall({
      url: `${BUSINESS_API_BASE}/accounts/${accountId}/locations/${locationId}/reviews/${reviewId}/reply`,
      accessToken,
      method: 'PUT',
      body: { comment },
      label: 'review-reply',
    });
  },

  /** Create a local post (v4). */
  async createPost(accessToken: string, accountId: string, locationId: string, postData: unknown) {
    return resilientCall({
      url: `${BUSINESS_API_BASE}/accounts/${accountId}/locations/${locationId}/localPosts`,
      accessToken,
      method: 'POST',
      body: postData,
      label: 'create-post',
    });
  },

  /** List local posts (v4). */
  async getPosts(accessToken: string, accountId: string, locationId: string) {
    const res = await resilientCall({
      url: `${BUSINESS_API_BASE}/accounts/${accountId}/locations/${locationId}/localPosts`,
      accessToken,
      label: 'posts',
    });
    return res.data?.localPosts ?? [];
  },

  /** Delete a local post (v4). */
  async deletePost(accessToken: string, accountId: string, locationId: string, postId: string) {
    return resilientCall({
      url: `${BUSINESS_API_BASE}/accounts/${accountId}/locations/${locationId}/localPosts/${postId}`,
      accessToken,
      method: 'DELETE',
      label: 'delete-post',
    });
  },

  /** Fetch location insights (v4). */
  async getInsights(accessToken: string, accountId: string, locationId: string) {
    const res = await resilientCall({
      url: `${BUSINESS_API_BASE}/accounts/${accountId}/locations/${locationId}/insights`,
      accessToken,
      label: 'insights',
    });
    return res.data ?? {};
  },
};

export default GoogleBusinessApi;
