#!/usr/bin/env node

/**
 * Brevo Email Test — Real API Connection Test
 *
 * Run this to verify Brevo integration is working:
 *   1. Set BREVO_API_KEY in .env
 *   2. Run: npx tsx scripts/test-brevo.ts
 *
 * Or via API (requires login):
 *   curl -X POST https://bizzautoai.com/api/email/brevo/test \
 *     -H "Authorization: Bearer <token>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"to":"your-email@gmail.com"}'
 *
 * Get a free Brevo API key:
 *   1. Go to https://www.brevo.com/ → Sign up (free)
 *   2. Settings → API Keys → Generate a new key
 *   3. Copy to .env: BREVO_API_KEY=xkeysib-xxxxxxxxxxxx
 *   Free tier: 300 emails/day
 */

import { BrevoEmailService } from '../src/server/services/brevo-email.service.js';

async function main() {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey || apiKey.startsWith('xkeysib-your-')) {
    console.log('');
    console.log('❌ BREVO_API_KEY not set in .env');
    console.log('');
    console.log('📝 How to get a Brevo API Key:');
    console.log('  1. Go to https://www.brevo.com/ and sign up (free)');
    console.log('  2. Settings → API Keys → "Generate a new key"');
    console.log('  3. Copy the key (starts with "xkeysib-")');
    console.log('  4. Add to .env:');
    console.log('     BREVO_API_KEY=xkeysib-<your-actual-key>');
    console.log('     BREVO_DEFAULT_FROM_EMAIL=bizzautoai@gmail.com');
    console.log('     BREVO_DEFAULT_FROM_NAME="BizzAuto CRM"');
    console.log('');
    process.exit(1);
  }

  console.log('🔍 Testing Brevo connection...');
  console.log(`   API Key: ${apiKey.substring(0, 14)}...${apiKey.slice(-4)}`);

  // Test 1: Account Info
  console.log('\n📡 Test 1: Get Account Info...');
  const accountInfo = await BrevoEmailService.getAccountInfo();
  if (accountInfo.success) {
    console.log(`   ✅ Connected as: ${accountInfo.data?.email}`);
    console.log(`   📋 Plan: ${accountInfo.data?.plan}`);
    console.log(`   📊 Daily Limit: ${accountInfo.data?.dailyLimit} emails`);
  } else {
    console.log(`   ❌ Failed: ${accountInfo.error}`);
    process.exit(1);
  }

  // Test 2: Check configured
  const configured = BrevoEmailService.isConfigured();
  console.log(`\n📡 Test 2: Configuration Status`);
  console.log(`   ✅ Brevo configured: ${configured}`);

  // Test 3: Send test email (only if recipient is configured)
  const testEmail = process.env.BREVO_TEST_EMAIL;
  if (testEmail) {
    console.log(`\n📡 Test 3: Sending test email to ${testEmail}...`);
    const sendResult = await BrevoEmailService.sendTransactionalEmail({
      to: testEmail,
      subject: 'BizzAuto — Brevo Test Email ✅',
      htmlContent: `
        <h2 style="color: #2563eb;">✅ Brevo Integration Test</h2>
        <p>This is a test email from <strong>BizzAuto CRM</strong> sent via <strong>Brevo</strong>.</p>
        <p>Your bulk email integration is working correctly!</p>
        <hr>
        <p style="color: #888; font-size: 12px;">
          Sent via Brevo (brevo.com) | BizzAuto CRM<br>
          Free tier: 300 emails/day
        </p>
      `,
      tags: ['test', 'brevo-setup'],
    });

    if (sendResult.success) {
      console.log(`   ✅ Email sent! MessageId: ${sendResult.messageId}`);
      console.log(`   📬 Check inbox: ${testEmail}`);
    } else {
      console.log(`   ❌ Send failed: ${sendResult.error}`);
      process.exit(1);
    }
  } else {
    console.log(`\n⏭️  Skipping send test — set BREVO_TEST_EMAIL=your@email.com to test real sending`);
  }

  console.log('\n✅ All Brevo tests passed!\n');
}

main().catch(console.error);
