# SKILL.md — Google Business Profile (GBP) Connect

**Name:** google-business-connect
**Description:** Connect Google Business Profile (Google My Business) to the BizzAuto CRM via OAuth 2.0. Covers the full connect flow, the 429 rate-limit failure mode, the service-account gotcha, redirect-URI requirements, and diagnostic/verification steps. Use when the user reports GBP "not connecting", a 429/403 during connect, or asks to wire/repair the Google My Business integration.

---

## When To Use
- User: "Google Business connect nahi ho raha", "429 aa raha", "GBP API not enabled", "sub credential use kiya".
- Building or repairing the `/api/google-business/*` OAuth flow.
- Diagnosing `error=callback_failed` / `error=rate_limited` on the `/google-business` page.

## Critical Facts (read before touching code)
1. **No service accounts.** GBP APIs (Business Information + mybusiness.googleapis.com) do NOT support service accounts or domain-wide delegation. The OAuth client MUST be a normal **"Web application"** client. A "sub"/service-account credential produces **403**, not 429.
2. **429 = Google throttling, not our server.** Our own middleware never emits 429 (ipBlock→403, speedLimiter→delay only). A 429 means one of:
   - OAuth app still in **TEST mode** (unverified consent screen) → ~1 req / 15s.
   - **Cloud Billing not enabled** on the OAuth client's project → stricter quota.
   - Burst of calls from the same credential (shared across GBP locations).
3. **Redirect URI must match EXACTLY**, including scheme+host. Live uses `https://bizzautoai.com/api/google-business/auth/callback`. Local uses `http://localhost:4000/api/google-business/auth/callback`. Mismatch → `redirect_uri_mismatch` (400).
4. **APIs + consent in the SAME project** as the OAuth client. The Google account signing in during OAuth must **own/manage** the Business Profile.

## Architecture In This Repo
- `src/server/routes/google-business.ts` — OAuth routes: `GET /auth/url`, `GET /auth/callback`, `/setup-check`, `/status`, `/reviews`, `/posts`, `/stats`, auto-post.
- `src/server/services/google-oauth.service.ts` — resilient token exchange (already retries network blips).
- `src/server/services/google-business-api.service.ts` — **resilient GBP API client** (retries 429/5xx with backoff, throws `GBPQuotaError`).
- `src/server/services/gbp-auto-post.service.ts` — scheduled posting.
- `src/components/GoogleBusinessPage.tsx` — UI + callback error messages.
- Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_BUSINESS_REDIRECT_URL`, `FRONTEND_URL`.

## The Connect Flow
1. UI `handleConnectGoogle()` → `GET /api/google-business/auth/url`.
2. Server builds OAuth URL (scopes `business.manage`, `userinfo.email`, `userinfo.profile`, `access_type=offline`, `prompt=consent`) and a base64 state carrying `businessId`.
3. Browser redirects to `accounts.google.com/o/oauth2/v2/auth`.
4. Google redirects back to `GOOGLE_BUSINESS_REDIRECT_URL` with `code` + `state`.
5. Callback exchanges `code` for tokens, fetches **accounts** then **locations** via `GoogleBusinessApi` (resilient), saves `gbpAccessToken`/`gbpRefreshToken`/`gbpAccountId`/`gbpLocationId` to `Business`, redirects to `/google-business?connected=true`.

## Fixing A 429 (the common failure)
- Code already retries 429/5xx in `google-business-api.service.ts` (exp-backoff, honours `Retry-After`).
- Callback redirects to `error=rate_limited` on persistent 429; UI shows billing/verification guidance.
- If still 429 after deploys: **enable Cloud Billing** on the project + **publish/verify** the OAuth consent screen. TEST-mode quota is the usual culprit.

## Verification
```bash
# 1. Typecheck the refactor
cd <project> && npx tsc --noEmit
# 2. Start server, check config
curl -H "Authorization: Bearer <JWT>" https://<host>/api/google-business/setup-check
# 3. From UI: /google-business → Run Diagnostics → Connect
```
- Connected when `/status` returns `{ connected: true, accountId, locationId }`.
- If 403: enable Business Information API + Business Profile APIs in the OAuth client's project.
- If no_business_found: sign in with a Google account that owns the Business Profile.

## Gotchas Checklist
- [ ] OAuth client = "Web application" (NOT service account).
- [ ] GBP APIs enabled in the SAME project as the client.
- [ ] Cloud Billing enabled (kills most 429s).
- [ ] OAuth consent screen published/verified; test users added if still testing.
- [ ] Redirect URI exact match (live vs local).
- [ ] Signing-in Google account owns the Business Profile.
- [ ] `FRONTEND_URL` correct for the environment.
