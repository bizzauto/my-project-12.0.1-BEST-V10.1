import { Router, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { GBPAutoPostService } from '../services/gbp-auto-post.service.js';
import { GoogleBusinessApi, GBPQuotaError } from '../services/google-business-api.service.js';
import { exchangeGoogleToken } from '../services/google-oauth.service.js';
import { encrypt, decrypt } from '../utils/auth.js';
import axios from 'axios';

const router = Router();

// Google Business OAuth scopes
const GBP_SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

// ── Helper: Refresh expired GBP access token ──
async function refreshGBPToken(businessId: string): Promise<string | null> {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { gbpAccessToken: true, gbpRefreshToken: true, gbpTokenExpiry: true },
    });
    if (!business?.gbpAccessToken || !business?.gbpRefreshToken) return null;

    // Check if token is still valid (with 5 min buffer)
    if (business.gbpTokenExpiry && business.gbpTokenExpiry.getTime() > Date.now() + 5 * 60 * 1000) {
      return decrypt(business.gbpAccessToken);
    }

    // Token expired or about to expire — refresh it
    console.log('[GBP] Refreshing expired access token for business:', businessId);
    const refreshToken = decrypt(business.gbpRefreshToken);
    const tokenResponse = await exchangeGoogleToken({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const refreshData = tokenResponse?.access_token ? tokenResponse : tokenResponse?.data;
    const { access_token, expires_in } = refreshData;
    await prisma.business.update({
      where: { id: businessId },
      data: {
        gbpAccessToken: encrypt(access_token),
        gbpTokenExpiry: new Date(Date.now() + expires_in * 1000),
      },
    });
    console.log('[GBP] Token refreshed successfully');
    return access_token;
  } catch (err: any) {
    console.error('[GBP] Token refresh failed:', err?.message);
    return null;
  }
}

// ── Helper: Get valid access token (auto-refresh if needed) ──
async function getValidAccessToken(businessId: string): Promise<string> {
  const token = await refreshGBPToken(businessId);
  if (!token) throw new Error('GOOGLE_BUSINESS_NOT_CONNECTED');
  return token;
}

// Store OAuth state temporarily (in production, use Redis)
const oauthStates = new Map<string, { businessId: string; expiresAt: number }>();

// Lazy cleanup: purge expired states on each access instead of setInterval
function cleanupExpiredStates() {
  const now = Date.now();
  for (const [key, val] of oauthStates) {
    if (val.expiresAt < now) oauthStates.delete(key);
  }
}

/** Network error codes that mean "the server could not reach Google at all". */
const GBP_NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN', // DNS lookup failed
  'ECONNREFUSED', // reachable but nothing listening (often a block)
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ECONNABORTED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Walk an error tree and return the most specific low-level `code` we can find.
 * For an `AggregateError` (Node undici wraps all failed connection attempts in
 * one), we look at each inner error's `.code` / `.cause.code` — that is the real
 * signal: ENOTFOUND = DNS, ECONNREFUSED = firewall/block, ETIMEDOUT = dropped.
 */
function getErrorCode(err: unknown): string | undefined {
  if (err == null || typeof err !== 'object') return undefined;
  const e = err as { code?: unknown; cause?: unknown };
  if (typeof e.code === 'string' && e.code) return e.code;
  if (e.cause) {
    const causeCode = getErrorCode(e.cause);
    if (causeCode) return causeCode;
  }
  if (err instanceof AggregateError) {
    for (const inner of err.errors ?? []) {
      const innerCode = getErrorCode(inner);
      if (innerCode) return innerCode;
    }
  }
  return undefined;
}

/**
 * Return true if the error is a network-level failure (server could not reach
 * Google), as opposed to an HTTP/auth failure (4xx/5xx from Google).
 */
function isNetworkFailure(err: unknown): boolean {
  return GBP_NETWORK_CODES.has(getErrorCode(err) ?? '') || err instanceof AggregateError;
}

/**
 * Extract a human-readable message from any thrown value. GBP connect was
 * previously swallowing errors as `unknown` whenever the thrown value had no
 * `.message` (e.g. a string, a plain object, or an axios error without a
 * populated `.response.data.error_description`). This guarantees we always get
 * something actionable instead of a blank "unknown".
 *
 * Also unwraps `AggregateError` (Node undici's "All connection attempts failed"
 * wrapper) so we surface the underlying DNS/connection cause instead of a
 * useless "no message".
 */
function getErrorMessage(err: unknown): string {
  if (err == null) return 'Unknown error (no details)';
  if (typeof err === 'string') return err;

  // AggregateError: "All connection attempts failed" — unwrap to the real cause.
  if (err instanceof AggregateError) {
    const inner = (err.errors ?? [])
      .map((e) => getErrorMessage(e))
      .filter((m): m is string => !!m && m !== 'Unknown error (no details)');
    const code = getErrorCode(err);
    const detail = inner.length ? inner.join('; ') : err.message || 'no inner errors';
    return `AggregateError: ${detail}${code ? ` [code=${code}]` : ''}`;
  }

  if (err instanceof Error) {
    const code = getErrorCode(err);
    return code ? `${err.name}: ${err.message} (code: ${code})` : (err.message || `${err.name}: no message`);
  }

  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string' && e.message) return e.message;
    if (typeof e.error_description === 'string' && e.error_description) return e.error_description;
    if (typeof e.error === 'string' && e.error) return e.error;
    const code = typeof e.code === 'string' ? e.code : undefined;
    if (code) return `Error code: ${code}`;
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unparseable error object';
    }
  }
  return String(err);
}

// ── GET /api/google-business/auth/url — Generate OAuth URL ──
router.get('/auth/url', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const host = req.get('host') || process.env.GOOGLE_BUSINESS_REDIRECT_URL || 'bizzautoai.com';
    const protocol = (req.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https')).split(',')[0].trim();
    const redirectUri = `${protocol}://${host}/api/google-business/auth/callback`;

    if (!clientId) {
      return res.status(500).json({ success: false, error: 'Google Client ID not configured' });
    }

    // Generate state token
    const state = Buffer.from(JSON.stringify({
      businessId: req.user.businessId,
      timestamp: Date.now(),
    })).toString('base64');

    cleanupExpiredStates();
    oauthStates.set(state, { businessId: req.user.businessId, expiresAt: Date.now() + 10 * 60 * 1000 });

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GBP_SCOPES);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    res.json({ success: true, data: { url: authUrl.toString() } });
  } catch (error: any) {
    console.error('GBP auth URL error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate auth URL' });
  }
});

// ── GET /api/google-business/auth/callback — OAuth Callback ──
router.get('/auth/callback', async (req: AuthRequest, res: Response) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=${error}`);
    }

    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=missing_params`);
    }

    // Validate state - try Map first, then decode directly
    cleanupExpiredStates();
    let stateData = oauthStates.get(state as string);
    if (!stateData || stateData.expiresAt < Date.now()) {
      // Fallback: decode state directly (handles Docker restart / Map loss)
      try {
        const decoded = JSON.parse(Buffer.from(state as string, 'base64').toString());
        if (decoded.businessId && decoded.timestamp && Date.now() - decoded.timestamp < 30 * 60 * 1000) {
          stateData = { businessId: decoded.businessId, expiresAt: Date.now() + 10 * 60 * 1000 };
          console.log('[GBP] State recovered from decoded token:', stateData.businessId);
        }
      } catch {}
    }
    if (!stateData) {
      return res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=invalid_state`);
    }
    oauthStates.delete(state as string);

    // Exchange code for tokens (with retry/timeout on transient network failures)
    // Derive the redirect URI from the incoming request origin so it always
    // matches what Google sent the user back to — this survives localhost dev,
    // the deployed domain, and any proxy/ingress without manual env wiring.
    const host = req.get('host') || process.env.GOOGLE_BUSINESS_REDIRECT_URL || 'bizzautoai.com';
    const protocol = (req.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https')).split(',')[0].trim();
    const redirectUri = `${protocol}://${host}/api/google-business/auth/callback`;
    console.log('[GBP] Exchanging code for tokens — redirect_uri:', redirectUri, 'client_id:', process.env.GOOGLE_CLIENT_ID?.substring(0, 20) + '...');
    let tokenResponse: any;
    try {
      tokenResponse = await exchangeGoogleToken({
        code: code as string,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
    } catch (tokenErr: any) {
      const googleErr = tokenErr?.response?.data || {};
      console.error('[GBP] Token exchange FAILED:', {
        status: tokenErr?.response?.status,
        error: googleErr.error || getErrorMessage(tokenErr),
        error_description: googleErr.error_description,
        redirect_uri: redirectUri,
        code: (code as string)?.substring(0, 10) + '...',
      });
      // Re-throw so the outer catch handles the redirect
      throw tokenErr;
    }

    // Handle both formats: direct data or wrapped in .data
    const tokenData = tokenResponse?.access_token ? tokenResponse : tokenResponse?.data;
    if (!tokenData?.access_token) {
      console.error('[GBP] Token exchange returned no access_token:', JSON.stringify(tokenResponse)?.substring(0, 200));
      throw new Error('Token exchange failed: no access_token in response');
    }
    console.log('[GBP] Token exchange OK — has access_token:', !!tokenData.access_token, 'has refresh_token:', !!tokenData.refresh_token, 'expires_in:', tokenData.expires_in);
    const { access_token, refresh_token, expires_in } = tokenData;

    // Get user info (resilient: retries on Google 429/5xx)
    console.log('[GBP] Fetching user info...');
    let userInfo;
    try {
      userInfo = await GoogleBusinessApi.getUserInfo(access_token);
    } catch (uiErr: any) {
      const status = uiErr?.status ?? uiErr?.response?.status;
      if (uiErr instanceof GBPQuotaError && status === 429) {
        return res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=rate_limited`);
      }
      console.error('[GBP] User info error:', uiErr?.message);
      throw uiErr;
    }
    console.log('[GBP] User info OK:', userInfo?.email);

    // Get Business accounts (resilient: retries on Google 429/5xx)
    let accounts;
    try {
      accounts = await GoogleBusinessApi.getAccounts(access_token);
    } catch (apiErr: any) {
      const status = apiErr?.status ?? apiErr?.response?.status;
      const isQuota = apiErr instanceof GBPQuotaError;
      console.error(`[GBP] Accounts API error: ${status}`, isQuota ? apiErr.message : apiErr?.message);
      if (status === 403) {
        console.error('[GBP] 403 — Google Business Profile API may need approval. Visit: https://developers.google.com/my-business/content/basic-setup');
        return res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=api_not_enabled`);
      }
      if (status === 401) {
        return res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=token_expired`);
      }
      if (isQuota && status === 429) {
        return res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=rate_limited`);
      }
      throw apiErr;
    }

    if (accounts.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=no_business_found`);
    }

    // Use first account (or let user select)
    const account = accounts[0];
    const accountId = account.name?.replace('accounts/', '') || account.accountId;
    console.log('[GBP] Found account:', accountId, 'total accounts:', accounts.length);

    // Get locations for this account (resilient: retries on Google 429/5xx)
    let locationId = null;
    try {
      const locations = await GoogleBusinessApi.getLocations(access_token, accountId);
      if (locations.length > 0) {
        locationId = locations[0].name?.replace(`accounts/${accountId}/locations/`, '') || locations[0].locationId;
      }
    } catch (locErr: any) {
      if (locErr instanceof GBPQuotaError && locErr.status === 429) {
        return res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=rate_limited`);
      }
      console.warn('Could not fetch locations:', locErr?.message);
    }

    // Save to database
    console.log('[GBP] Saving to database — businessId:', stateData.businessId, 'accountId:', accountId, 'locationId:', locationId);
    try {
      await prisma.business.update({
        where: { id: stateData.businessId },
        data: {
          gbpAccessToken: encrypt(access_token),
          gbpRefreshToken: refresh_token ? encrypt(refresh_token) : undefined,
          gbpAccountId: accountId,
          gbpLocationId: locationId,
          gbpTokenExpiry: new Date(Date.now() + expires_in * 1000),
        },
      });
    } catch (dbErr: unknown) {
      console.error('[GBP] DATABASE SAVE FAILED:', getErrorMessage(dbErr), (dbErr as { stack?: string })?.stack);
      return res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=db_save_failed&msg=${encodeURIComponent(getErrorMessage(dbErr))}`);
    }

    console.log('[GBP] ✅ Database saved successfully! Redirecting to frontend...');
    // Redirect to frontend with success
    res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?connected=true`);
  } catch (error: any) {
    console.error('[GBP] callback error:', getErrorMessage(error));
    console.error('[GBP] callback error code:', getErrorCode(error));
    console.error('[GBP] callback error stack:', error?.stack);
    console.error('[GBP] callback raw:', JSON.stringify(error, Object.getOwnPropertyNames(error || {}))?.substring(0, 1000));
    console.error('[GBP] callback query:', JSON.stringify(req.query));
    console.error('[GBP] callback env check:', {
      clientIdSet: !!process.env.GOOGLE_CLIENT_ID,
      clientSecretSet: !!process.env.GOOGLE_CLIENT_SECRET,
      redirectUrlSet: !!process.env.GOOGLE_BUSINESS_REDIRECT_URL,
      clientIdPrefix: process.env.GOOGLE_CLIENT_ID?.substring(0, 20),
    });
    if (error?.response?.status === 403) {
      res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=api_not_enabled`);
    } else if (error?.response?.status === 401) {
      res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=token_expired`);
    } else if (error?.response?.status === 400) {
      // Google returned Bad Request on the token exchange. Most common reasons:
      //  - invalid_grant / bad_verification_code → the OAuth code was already
      //    used or expired (happens when the user refreshes the callback URL).
      //  - redirect_uri_mismatch → the registered redirect URI doesn't match.
      const gErr: { error?: string; error_description?: string } = error?.response?.data || {};
      const reason = gErr.error || 'invalid_request';
      const desc = gErr.error_description || '';
      if (reason === 'invalid_grant' || reason === 'bad_verification_code') {
        res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=code_already_used&msg=${encodeURIComponent('The Google authorization code was already used or has expired. This happens if you refresh the page after Google redirects back. Please click Connect again (do NOT refresh) and complete the flow once.')}`);
      } else if (reason === 'redirect_uri_mismatch') {
        res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=redirect_mismatch&msg=${encodeURIComponent(`Google says the redirect URI doesn't match what's registered: ${desc}. Register this exact URI in Google Cloud Console.`)}`);
      } else {
        res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=token_400&msg=${encodeURIComponent(`Google rejected the token request [${reason}]: ${desc}`)}`);
      }
    } else if (isNetworkFailure(error)) {
      // Server could NOT reach Google at all (DNS/connection). Surface a clear,
      // actionable message so the user knows this is infra, not their config.
      const errCode = getErrorCode(error) ?? 'UNKNOWN';
      const hintByCode: Record<string, string> = {
        ENOTFOUND: 'DNS lookup for oauth2.googleapis.com failed — the server cannot resolve Google hosts. Check the container DNS / network egress.',
        EAI_AGAIN: 'DNS lookup for Google hosts timed out — check the container DNS config.',
        ECONNREFUSED: 'Connection to Google was refused — an outbound firewall/proxy is likely blocking traffic. If the server requires a proxy for external calls, it must be wired into the GBP token exchange.',
        ETIMEDOUT: 'Connection to Google timed out — outbound traffic to Google is being dropped. Check firewall / egress rules.',
      };
      const hint = hintByCode[errCode] ?? 'The server could not establish a network connection to Google. Check the container network egress.';
      res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=gbp_network_error&msg=${encodeURIComponent(`Network failure reaching Google [code=${errCode}]. ${hint}`)}`);
    } else {
      const msg = getErrorMessage(error);
      // If we STILL couldn't extract anything, send diagnostic context instead
      // of a blank "unknown" so the real cause is never lost.
      const fallbackMsg = !msg || msg === 'unknown'
        ? `Empty error object caught. query=${JSON.stringify(req.query)} clientId=${!!process.env.GOOGLE_CLIENT_ID} secret=${!!process.env.GOOGLE_CLIENT_SECRET}`
        : msg;
      res.redirect(`${process.env.FRONTEND_URL || 'https://bizzautoai.com'}/google-business?error=callback_failed&msg=${encodeURIComponent(fallbackMsg)}`);
    }
  }
});

// ── GET /api/google-business/net-check — Live outbound connectivity probe to Google ──
// Diagnostic-only: confirms whether THIS server process can reach Google over IPv4.
router.get('/net-check', async (_req: AuthRequest, res: Response) => {
  const dns = await import('dns');
  const targets = [
    'oauth2.googleapis.com',
    'www.googleapis.com',
    'mybusinessbusinessinformation.googleapis.com',
  ];
  const results: Record<string, unknown> = { dnsOrder: (dns as any).getDefaultResultOrder?.() ?? 'unknown' };
  await Promise.all(targets.map(async (host) => {
    const entry: Record<string, unknown> = {};
    try {
      const addrs = await new Promise<{ address: string; family: number }[]>((resolve, reject) =>
        dns.lookup(host, { all: true }, (e: Error | null, a: { address: string; family: number }[]) =>
          e ? reject(e) : resolve(a))
      );
      entry.addresses = addrs;
      // Now actually try an IPv4 HTTPS GET from THIS process
      const start = Date.now();
      try {
        await axios.get(`https://${host}/`, { family: 4, timeout: 8000, validateStatus: () => true });
        entry.ipv4Reachable = true;
        entry.ipv4Ms = Date.now() - start;
      } catch (e: any) {
        entry.ipv4Reachable = false;
        entry.ipv4Error = e?.code || e?.message;
      }
    } catch (e: any) {
      entry.dnsError = e?.code || e?.message;
    }
    results[host] = entry;
  }));
  res.json({ ok: true, timestamp: new Date().toISOString(), results });
});

// ── GET /api/google-business/setup-check — Validate configuration ──
router.get('/setup-check', authenticate, async (req: AuthRequest, res: Response) => {
  const checks: Record<string, { ok: boolean; message: string; fix?: string }> = {};

  // 1. Check env vars
  const redirectUri = process.env.GOOGLE_BUSINESS_REDIRECT_URL || 'https://bizzautoai.com/api/google-business/auth/callback';
  const authRedirectUri = process.env.GOOGLE_AUTH_REDIRECT_URL || 'https://bizzautoai.com/api/auth/google/callback';
  checks.clientId = {
    ok: !!process.env.GOOGLE_CLIENT_ID,
    message: process.env.GOOGLE_CLIENT_ID ? `GOOGLE_CLIENT_ID is set (${process.env.GOOGLE_CLIENT_ID.substring(0, 20)}...)` : 'GOOGLE_CLIENT_ID is missing',
    fix: 'Set GOOGLE_CLIENT_ID in your .env file',
  };
  checks.clientSecret = {
    ok: !!process.env.GOOGLE_CLIENT_SECRET,
    message: process.env.GOOGLE_CLIENT_SECRET ? 'GOOGLE_CLIENT_SECRET is set' : 'GOOGLE_CLIENT_SECRET is missing',
    fix: 'Set GOOGLE_CLIENT_SECRET in your .env file',
  };
  checks.redirectUri = {
    ok: true,
    message: `Google Business redirect URI: ${redirectUri}`,
    fix: 'Make sure this EXACT URI is in Google Cloud Console → Credentials → OAuth 2.0 Client → Authorized redirect URIs',
  };
  checks.authRedirectUri = {
    ok: true,
    message: `Google Sign-In redirect URI: ${authRedirectUri}`,
    fix: 'Make sure this EXACT URI is also in Google Cloud Console → Authorized redirect URIs',
  };
  checks.jsOrigin = {
    ok: true,
    message: 'Authorized JavaScript origin should be: https://bizzautoai.com',
    fix: 'Add this to Google Cloud Console → Credentials → OAuth 2.0 Client → Authorized JavaScript origins',
  };

  // 2. Check if connected
  const business = await prisma.business.findUnique({
    where: { id: req.user.businessId },
    select: { gbpAccessToken: true, gbpRefreshToken: true, gbpAccountId: true, gbpLocationId: true, gbpTokenExpiry: true },
  });
  checks.connected = {
    ok: !!(business?.gbpAccessToken && business?.gbpAccountId),
    message: business?.gbpAccessToken ? 'Connected to Google Business' : 'Not connected',
  };
  checks.tokenValid = {
    ok: !!(business?.gbpTokenExpiry && business.gbpTokenExpiry.getTime() > Date.now()),
    message: business?.gbpTokenExpiry
      ? (business.gbpTokenExpiry.getTime() > Date.now() ? 'Token is valid' : 'Token expired (will auto-refresh)')
      : 'No token available',
  };
  checks.hasRefreshToken = {
    ok: !!business?.gbpRefreshToken,
    message: business?.gbpRefreshToken ? 'Refresh token available' : 'No refresh token (re-auth needed)',
  };

  // 3. If connected, test the API access
  if (business?.gbpAccessToken && business?.gbpAccountId) {
    try {
      const accessToken = await getValidAccessToken(req.user.businessId);
      await GoogleBusinessApi.getAccounts(accessToken);
      checks.apiAccess = { ok: true, message: 'Google Business Profile API access confirmed' };
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const isQuota = err instanceof GBPQuotaError;
      checks.apiAccess = {
        ok: false,
        message: status === 403
          ? 'API access denied (403) — APIs need approval from Google'
          : status === 401
            ? 'API authentication failed (401) — token invalid'
            : status === 429 || isQuota
              ? 'Google API rate limit hit (429) — app likely in TEST mode or billing not enabled'
              : `API error: ${status || err?.message}`,
        fix: status === 403
          ? 'Go to https://console.cloud.google.com → APIs & Services → Enable these APIs: Google Business Profile APIs (Business Information API, Reviews API, LocalPosts API). Then submit OAuth consent screen for verification.'
          : status === 429
            ? 'Enable Cloud Billing on the OAuth client project and publish/verify the OAuth consent screen. Google throttles TEST apps to ~1 req/15s.'
            : undefined,
      };
    }
  }

  const allOk = Object.values(checks).every(c => c.ok);
  res.json({ success: true, data: { allOk, checks } });
});

// Get Google Business connection status
router.get('/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: {
        gbpAccessToken: true,
        gbpRefreshToken: true,
        gbpAccountId: true,
        gbpLocationId: true,
        gbpTokenExpiry: true,
        name: true,
      },
    });

    const isConnected = !!(business?.gbpAccessToken && business?.gbpAccountId); // fixed: was triple-negation (inverted)

    res.json({
      success: true,
      data: {
        connected: isConnected,
        accountId: business?.gbpAccountId || null,
        locationId: business?.gbpLocationId || null,
        businessName: business?.name || null,
        hasRefreshToken: !!business?.gbpRefreshToken,
        tokenValid: business?.gbpTokenExpiry ? business.gbpTokenExpiry.getTime() > Date.now() : false,
      },
    });
  } catch (error: any) {
    console.error('GBP status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get status', details: error.message });
  }
});

// Connect Google Business Profile
router.post('/connect', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { accessToken, accountId, locationId } = req.body;

    if (!accessToken || !accountId) {
      return res.status(400).json({
        success: false,
        error: 'accessToken and accountId are required',
      });
    }

    const { encrypt } = await import('../utils/auth.js');

    await prisma.business.update({
      where: { id: req.user.businessId },
      data: {
        gbpAccessToken: encrypt(accessToken),
        gbpAccountId: accountId,
        gbpLocationId: locationId || null,
      },
    });

    res.json({
      success: true,
      message: 'Google Business Profile connected successfully',
    });
  } catch (error: any) {
    console.error('GBP connect error:', error);
    res.status(500).json({ success: false, error: 'Failed to connect', details: error.message });
  }
});

// Disconnect Google Business Profile
router.post('/disconnect', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.business.update({
      where: { id: req.user.businessId },
      data: {
        gbpAccessToken: null,
        gbpRefreshToken: null,
        gbpTokenExpiry: null,
        gbpAccountId: null,
        gbpLocationId: null,
      },
    });

    res.json({
      success: true,
      message: 'Google Business Profile disconnected successfully',
    });
  } catch (error: any) {
    console.error('GBP disconnect error:', error);
    res.status(500).json({ success: false, error: 'Failed to disconnect', details: error.message });
  }
});

// Get Google Business Profile locations
router.get('/locations', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccountId: true },
    });

    if (!business?.gbpAccountId) {
      return res.status(400).json({ success: false, error: 'Google Business not connected' });
    }

    const accessToken = await getValidAccessToken(req.user.businessId);

    const response = await axios.get(
      `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${business.gbpAccountId}/locations`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    res.json({ success: true, data: response.data.locations || [] });
  } catch (error: any) {
    console.error('GBP locations fetch error:', error?.response?.status, error?.message);
    res.status(500).json({ success: false, error: 'Failed to fetch locations', details: error.message });
  }
});

// Get Google Business reviews
router.get('/reviews', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccountId: true, gbpLocationId: true },
    });

    if (!business?.gbpAccountId || !business?.gbpLocationId) {
      return res.status(400).json({ success: false, error: 'Google Business not connected. Please connect first.' });
    }

    const accessToken = await getValidAccessToken(req.user.businessId);

    // Reviews API — use v4 (v1 equivalent not available)
    const reviews = await GoogleBusinessApi.getReviews(
      accessToken,
      business.gbpAccountId,
      business.gbpLocationId
    );

    res.json({ success: true, data: reviews });
  } catch (error: any) {
    const status = error?.status ?? error?.response?.status;
    console.error('GBP reviews fetch error:', status, error?.message);
    if (error instanceof GBPQuotaError && status === 429) {
      res.status(429).json({ success: false, error: 'Google Business Profile API rate limit reached. Wait a moment and retry.' });
    } else if (status === 403) {
      res.status(400).json({ success: false, error: 'Google Business Profile API not enabled. Please enable APIs in Google Cloud Console.' });
    } else if (status === 401) {
      res.status(401).json({ success: false, error: 'Authentication expired. Please reconnect Google Business.' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to fetch reviews', details: error.message });
    }
  }
});

// Reply to Google Business review
router.post('/reviews/:reviewId/reply', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { reply } = req.body;
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccountId: true, gbpLocationId: true },
    });

    if (!business?.gbpAccountId || !business?.gbpLocationId) {
      return res.status(400).json({ success: false, error: 'Google Business not connected' });
    }

    const accessToken = await getValidAccessToken(req.user.businessId);

    await axios.put(
      `https://mybusiness.googleapis.com/v4/accounts/${business.gbpAccountId}/locations/${business.gbpLocationId}/reviews/${req.params.reviewId}/reply`,
      { comment: reply },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    res.json({ success: true, message: 'Reply posted' });
  } catch (error: any) {
    console.error('GBP review reply error:', error?.response?.status, error?.response?.data || error?.message);
    const status = error?.response?.status;
    if (status === 403) {
      res.status(400).json({ success: false, error: 'API not enabled. Please enable Google Business Profile APIs in Cloud Console.' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to post reply', details: error.message });
    }
  }
});

// Create Google Business post
router.post('/posts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { content, mediaUrl, callToAction } = req.body;
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccountId: true, gbpLocationId: true },
    });

    if (!business?.gbpAccountId || !business?.gbpLocationId) {
      return res.status(400).json({ success: false, error: 'Google Business not connected' });
    }

    const accessToken = await getValidAccessToken(req.user.businessId);

    const postData: any = {
      languageCode: 'en',
      summary: content.substring(0, 200),
      state: 'LIVE',
    };

    if (mediaUrl) {
      postData.media = [{ mediaFormat: 'PHOTO', sourceUrl: mediaUrl }];
    }

    if (callToAction) {
      postData.action = {
        actionType: callToAction.type,
        url: callToAction.url,
      };
    }

    const response = await axios.post(
      `https://mybusiness.googleapis.com/v4/accounts/${business.gbpAccountId}/locations/${business.gbpLocationId}/localPosts`,
      postData,
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    res.json({ success: true, data: response.data });
  } catch (error: any) {
    console.error('GBP post creation error:', error?.response?.status, error?.response?.data || error?.message);
    const status = error?.response?.status;
    if (status === 403) {
      res.status(400).json({ success: false, error: 'API not enabled. Please enable Google Business Profile APIs in Cloud Console.' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to create post', details: error.message });
    }
  }
});

// Get Google Business posts
router.get('/posts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccountId: true, gbpLocationId: true },
    });

    if (!business?.gbpAccountId || !business?.gbpLocationId) {
      return res.status(400).json({ success: false, error: 'Google Business not connected' });
    }

    const accessToken = await getValidAccessToken(req.user.businessId);

    const posts = await GoogleBusinessApi.getPosts(
      accessToken,
      business.gbpAccountId,
      business.gbpLocationId
    );

    res.json({ success: true, data: posts });
  } catch (error: any) {
    const status = error?.status ?? error?.response?.status;
    console.error('GBP posts fetch error:', status, error?.message);
    if (error instanceof GBPQuotaError && status === 429) {
      res.status(429).json({ success: false, error: 'Google Business Profile API rate limit reached. Wait a moment and retry.' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to fetch posts', details: error.message });
    }
  }
});

// Delete Google Business post
router.delete('/posts/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccountId: true, gbpLocationId: true },
    });

    if (!business?.gbpAccountId || !business?.gbpLocationId) {
      return res.status(400).json({ success: false, error: 'Google Business not connected' });
    }

    const accessToken = await getValidAccessToken(req.user.businessId);

    await axios.delete(
      `https://mybusiness.googleapis.com/v4/accounts/${business.gbpAccountId}/locations/${business.gbpLocationId}/localPosts/${req.params.id}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    res.json({ success: true, message: 'Post deleted successfully' });
  } catch (error: any) {
    console.error('GBP post delete error:', error?.response?.status, error?.message);
    res.status(500).json({ success: false, error: 'Failed to delete post', details: error.message });
  }
});

// Get Google Business statistics
router.get('/stats', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccountId: true, gbpLocationId: true },
    });

    if (!business?.gbpAccountId || !business?.gbpLocationId) {
      return res.status(400).json({ success: false, error: 'Google Business not connected' });
    }

    const accessToken = await getValidAccessToken(req.user.businessId);

    const insights = await GoogleBusinessApi.getInsights(
      accessToken,
      business.gbpAccountId,
      business.gbpLocationId
    );

    res.json({ success: true, data: insights });
  } catch (error: any) {
    const status = error?.status ?? error?.response?.status;
    console.error('GBP stats fetch error:', status, error?.message);
    if (error instanceof GBPQuotaError && status === 429) {
      res.status(429).json({ success: false, error: 'Google Business Profile API rate limit reached. Wait a moment and retry.' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to fetch statistics', details: error.message });
    }
  }
});

// ==================== AUTO-POST ENDPOINTS ====================

// Get auto-post configuration
router.get('/auto-post/config', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const config = await GBPAutoPostService.getConfig(req.user.businessId);
    res.json({ success: true, data: config });
  } catch (error: any) {
    console.error('GBP auto-post config error:', error);
    res.status(500).json({ success: false, error: 'Failed to get config', details: error.message });
  }
});

// Update auto-post configuration
router.put('/auto-post/config', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { enabled, time, timezone, days } = req.body;
    const config = await GBPAutoPostService.updateConfig(req.user.businessId, {
      enabled,
      time,
      timezone,
      days,
    });
    res.json({ success: true, data: config });
  } catch (error: any) {
    console.error('GBP auto-post config update error:', error);
    res.status(500).json({ success: false, error: 'Failed to update config', details: error.message });
  }
});

// Get auto-post templates
router.get('/auto-post/templates', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const config = await GBPAutoPostService.getConfig(req.user.businessId);
    res.json({ success: true, data: config.templates });
  } catch (error: any) {
    console.error('GBP auto-post templates error:', error);
    res.status(500).json({ success: false, error: 'Failed to get templates', details: error.message });
  }
});

// Add auto-post template
router.post('/auto-post/templates', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, content, mediaUrl, callToAction, tags } = req.body;

    if (!name || !content) {
      return res.status(400).json({
        success: false,
        error: 'name and content are required',
      });
    }

    const template = await GBPAutoPostService.addTemplate(req.user.businessId, {
      name,
      content,
      mediaUrl,
      callToAction,
      tags,
    });

    res.json({ success: true, data: template });
  } catch (error: any) {
    console.error('GBP auto-post template add error:', error);
    res.status(500).json({ success: false, error: 'Failed to add template', details: error.message });
  }
});

// Update auto-post template
router.put('/auto-post/templates/:templateId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, content, mediaUrl, callToAction, tags } = req.body;
    const template = await GBPAutoPostService.updateTemplate(
      req.user.businessId,
      req.params.templateId,
      { name, content, mediaUrl, callToAction, tags }
    );
    res.json({ success: true, data: template });
  } catch (error: any) {
    console.error('GBP auto-post template update error:', error);
    res.status(500).json({ success: false, error: 'Failed to update template', details: error.message });
  }
});

// Delete auto-post template
router.delete('/auto-post/templates/:templateId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await GBPAutoPostService.deleteTemplate(req.user.businessId, req.params.templateId);
    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error: any) {
    console.error('GBP auto-post template delete error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete template', details: error.message });
  }
});

// Manually trigger auto-post (for testing)
router.post('/auto-post/trigger', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await GBPAutoPostService.executeAutoPost(req.user.businessId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('GBP auto-post trigger error:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger auto-post', details: error.message });
  }
});

// Get auto-post status
router.get('/auto-post/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const config = await GBPAutoPostService.getConfig(req.user.businessId);
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAutoPostLastPosted: true },
    });

    res.json({
      success: true,
      data: {
        enabled: config.enabled,
        time: config.time,
        timezone: config.timezone,
        days: config.days,
        templatesCount: config.templates.length,
        lastPosted: business?.gbpAutoPostLastPosted || null,
      },
    });
  } catch (error: any) {
    console.error('GBP auto-post status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get status', details: error.message });
  }
});

export default router;
