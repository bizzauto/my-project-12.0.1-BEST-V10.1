/**
 * GBP Quick Diagnostic — run with: node scripts/check-gbp.mjs
 *
 * Tests:
 *  1. Google token endpoint reachability
 *  2. Each Google Business API enabled?
 *  3. Redirect URI consistency
 *  4. OAuth consent screen status
 *
 * No DB / no auth needed — pure network check.
 */

import axios from 'axios';

const CID = process.env.GOOGLE_CLIENT_ID;
const CSEC = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://bizzautoai.com/api/google-business/auth/callback';

const APIs = [
  {
    name: 'Business Information API (v1 — accounts, locations)',
    url: 'https://mybusinessbusinessinformation.googleapis.com/v1/accounts',
    docs: 'https://console.cloud.google.com/apis/library/mybusinessbusinessinformation.googleapis.com',
  },
  {
    name: 'Google My Business API (v4 — reviews, posts)',
    url: 'https://mybusiness.googleapis.com/v4/accounts/test/locations/test/reviews',
    docs: 'https://console.cloud.google.com/apis/library/mybusiness.googleapis.com',
  },
];

const hr = () => console.log('─'.repeat(55));

async function main() {
  console.log('\n🔍 GBP CONNECTION DIAGNOSTIC\n');
  hr();

  // ── 1. Token endpoint ──
  console.log('\n1️⃣  Google Token Endpoint');
  try {
    await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'dummy',
        client_id: CID,
        client_secret: CSEC,
        redirect_uri: REDIRECT_URI,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );
  } catch (err) {
    const d = err.response?.data;
    if (d?.error === 'invalid_grant') {
      console.log('   ✅ Reachable — redirect URI accepted');
    } else if (d?.error === 'redirect_uri_mismatch') {
      console.log('   ❌  REDIRECT URI MISMATCH');
      console.log('   Google says:', d.error_description);
      console.log('   ➡  Add this exact URI in Cloud Console → Credentials → Redirect URIs:');
      console.log('      ' + REDIRECT_URI);
    } else if (d?.error === 'unauthorized_client') {
      console.log('   ❌  UNAUTHORIZED CLIENT — publish your OAuth consent screen');
    } else {
      console.log('   ⚠️  Unexpected:', JSON.stringify(d));
    }
  }

  // ── 2. APIs ──
  console.log('\n2️⃣  Google Business Profile APIs');
  let anyNotEnabled = false;

  for (const api of APIs) {
    try {
      await axios.get(api.url, {
        headers: { Authorization: 'Bearer dummy' },
        timeout: 10000,
      });
    } catch (err) {
      const s = err.response?.status;
      if (s === 401) {
        console.log(`   ✅  ${api.name} — API enabled (auth needed ✓)`);
      } else if (s === 403) {
        console.log(`   ❌  ${api.name} — NOT ENABLED (403 Forbidden)`);
        console.log(`       Enable: ${api.docs}`);
        anyNotEnabled = true;
      } else if (s === 404) {
        // 404 with dummy token → endpoint might need real auth to distinguish
        // but usually means API not enabled
        console.log(`   ⚠️  ${api.name} — 404 (likely not enabled or endpoint changed)`);
        console.log(`       Check: ${api.docs}`);
        anyNotEnabled = true;
      } else {
        console.log(`   ⚠️  ${api.name} — HTTP ${s}`);
      }
    }
  }

  // ── 3. Environment check ──
  console.log('\n3️⃣  Environment Variables');
  const vars = {
    GOOGLE_CLIENT_ID: CID,
    GOOGLE_CLIENT_SECRET: CSEC,
    GOOGLE_BUSINESS_REDIRECT_URL: REDIRECT_URI,
  };
  for (const [k, v] of Object.entries(vars)) {
    console.log(`   ✅  ${k} = ${v.substring(0, 40)}${v.length > 40 ? '…' : ''}`);
  }

  // ── 4. Summary ──
  hr();
  console.log('\n📋 FIX STEPS:\n');
  if (anyNotEnabled) {
    console.log('   1. Go to https://console.cloud.google.com/apis/library');
    console.log('   2. Search & ENABLE:');
    console.log('      • "Google Business Profile API" (for accounts & locations)');
    console.log('      • "Google My Business API" (for reviews & posts)');
    console.log('   3. OAuth Consent Screen → Publishing status → "In production"');
    console.log('   4. Reconnect GBP from your app\n');
  } else {
    console.log('   All APIs enabled ✅ — the issue may be:');
    console.log('   • Expired / revoked refresh token → reconnect GBP');
    console.log('   • OAuth consent screen in "Testing" mode → publish it\n');
  }
  hr();
}

main();
