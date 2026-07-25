/**
 * SMTP DIAGNOSTIC — run on a machine with network access to the SMTP server:
 *   node scripts/test-smtp.cjs
 * Verifies Brevo (or any configured SMTP) can actually send a test email.
 */
const nodemailer = require('nodemailer');
require('dotenv').config();

const cfg = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false },
};

(async () => {
  console.log('=== SMTP DIAGNOSTIC ===');
  console.log('host:', cfg.host, 'port:', cfg.port, 'secure:', cfg.secure);
  console.log('user:', cfg.auth.user);
  console.log('from:', process.env.SMTP_FROM || cfg.auth.user);
  console.log('test recipient:', process.env.SMTP_TEST_TO || cfg.auth.user);
  console.log('');

  const t = nodemailer.createTransport(cfg);
  try {
    const verify = await t.verify();
    console.log('verify() result:', verify);
  } catch (e) {
    console.log('verify() ERROR:', e.message);
  }

  try {
    const info = await t.sendMail({
      from: process.env.SMTP_FROM || cfg.auth.user,
      to: process.env.SMTP_TEST_TO || cfg.auth.user,
      subject: 'SMTP Diagnostic Test',
      text: 'If you receive this, SMTP is working.',
    });
    console.log('\nsendMail OK. messageId:', info.messageId);
    console.log('accepted:', info.accepted, 'rejected:', info.rejected);
  } catch (e) {
    console.log('\nsendMail ERROR:', e.message);
    if (e.response) console.log('SMTP response:', e.response);
  }
})();
