/**
 * @jest-environment node
 *
 * Auth Forgot-Password Flow Tests
 *
 * Tests the password reset flow (forgot-password, verify-otp, reset-password)
 * and the change-password endpoint via supertest with mocked dependencies.
 *
 * Follows the pattern from tests/auth-e2e.test.ts: mocks Prisma, auth utils,
 * express-rate-limit, jsonwebtoken, CSRF service, and ancillary services.
 * crypto.randomInt is mocked so the OTP value is deterministic.
 */

import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

// ─── Mock Dependencies (hoisted by Jest) ─────────────────────────────────────

// Mock crypto.randomInt so we can predict OTP values in verify-otp / reset-password
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return { ...actual, randomInt: jest.fn() };
});

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  business: { create: jest.fn(), findUnique: jest.fn() },
  activity: { create: jest.fn() },
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({ prisma: mockPrisma }));

// ── Auth utilities mock ──────────────────────────────────────────────────────
jest.mock('../src/server/utils/auth', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed_password_xyz'),
  comparePassword: jest.fn().mockResolvedValue(true),
  generateToken: jest.fn().mockReturnValue('mock_jwt_token_abc123'),
  generateRefreshToken: jest.fn().mockReturnValue('mock_refresh_token'),
  verifyToken: jest.fn().mockResolvedValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  }),
  getJwtSecret: jest.fn().mockReturnValue('test-secret'),
  encrypt: jest.fn().mockReturnValue('encrypted_data'),
  decrypt: jest.fn().mockReturnValue('decrypted_data'),
  verifyRefreshToken: jest.fn(),
}));

// ── Disable rate limiting for tests ──────────────────────────────────────────
jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

// ── JSON Web Token mock (used by authenticate middleware) ────────────────────
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-abc-123' }),
  sign: jest.fn().mockReturnValue('mock_jwt_token_abc123'),
  decode: jest.fn(),
}));

// ── CSRF Service mock (used by authenticate middleware) ──────────────────────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── Google OAuth service mock ────────────────────────────────────────────────
jest.mock('../src/server/services/google-oauth.service', () => ({
  exchangeGoogleToken: jest.fn().mockResolvedValue({ id_token: 'mock-id-token' }),
}));

// ── Token blacklist service mock ─────────────────────────────────────────────
jest.mock('../src/server/services/token-blacklist.service', () => ({
  revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
  isRefreshTokenRevoked: jest.fn().mockResolvedValue(false),
  blacklistRefreshToken: jest.fn().mockResolvedValue(undefined),
}));

// ── Account lockout service mock ─────────────────────────────────────────────
jest.mock('../src/server/services/account-lockout.service', () => ({
  recordFailedLoginAttempt: jest.fn().mockResolvedValue({ locked: false, attemptsRemaining: 2 }),
  clearFailedLoginAttempts: jest.fn().mockResolvedValue(undefined),
  getLockoutStatus: jest.fn().mockResolvedValue({ locked: false }),
}));

// ── Email service mock (dynamically imported in route handlers) ──────────────
jest.mock('../src/server/services/email.service', () => ({
  EmailService: {
    sendEmail: jest.fn().mockResolvedValue({ success: true }),
    sendVerificationEmail: jest.fn().mockResolvedValue({ success: true }),
  },
}));

// ── Google Auth Library mock (OAuth2Client created at module level in auth.ts) ──
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn().mockResolvedValue({
      getPayload: jest.fn().mockReturnValue({
        email: 'test@example.com',
        name: 'Test User',
        sub: 'google-123',
        picture: null,
      }),
    }),
  })),
}));

// ─── Import the router AFTER all mocks are set up ────────────────────────────
import authRoutes from '../src/server/routes/auth';

// ─── Trap setInterval from auth.ts OTP cleanup ──────────────────────────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  // Re-apply default mock implementations
  const utils = jest.requireMock('../src/server/utils/auth');
  utils.hashPassword.mockResolvedValue('hashed_password_xyz');
  utils.comparePassword.mockResolvedValue(true);
  utils.generateToken.mockReturnValue('mock_jwt_token_abc123');
  utils.verifyToken.mockResolvedValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  });

  const csrf = jest.requireMock('../src/server/services/csrf.service');
  csrf.CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  csrf.CSRFService.getToken.mockResolvedValue('csrf-token-xyz');

  // Default: OTP is always 123456
  (crypto.randomInt as jest.Mock).mockReturnValue(123456);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

afterAll(() => {
  // Clear the OTP cleanup interval so Jest can exit cleanly
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── TESTS ───────────────────────────────────────────────────────────────────

// ==================== FORGOT PASSWORD ====================

describe('POST /api/auth/forgot-password', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should send OTP for valid email', async () => {
    // The email service mock returns { success: true }, so the OTP is "sent"
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('OTP');

    // Should have called the email service
    const emailMock = jest.requireMock('../src/server/services/email.service');
    expect(emailMock.EmailService.sendEmail).toHaveBeenCalledWith(
      'test@example.com',
      expect.stringContaining('OTP'),
      expect.stringContaining('123456')
    );

    // OTP should have been generated via crypto.randomInt
    expect(crypto.randomInt).toHaveBeenCalledWith(100000, 999999);
  });

  it('should return 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Validation failed');
  });
});

// ==================== VERIFY OTP ====================

describe('POST /api/auth/verify-otp', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should verify valid OTP', async () => {
    // Step 1: Trigger OTP generation (store has OTP 123456 for test@example.com)
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'verify-success@example.com' });

    // Step 2: Verify with the correct OTP
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'verify-success@example.com', otp: '123456' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('OTP verified');
  });

  it('should reject invalid OTP', async () => {
    // Trigger OTP generation
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'verify-fail@example.com' });

    // Verify with wrong OTP
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'verify-fail@example.com', otp: '999999' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Invalid or expired OTP');
  });
});

// ==================== RESET PASSWORD ====================

describe('POST /api/auth/reset-password', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should reset password with verified OTP', async () => {
    // Full flow: forgot-password -> verify-otp -> reset-password
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'reset-success@example.com' });

    await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'reset-success@example.com', otp: '123456' });

    // The OTP is now marked as verified; reset-password should skip OTP re-check.
    // Mock prisma.user.update for the password update
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'reset-success@example.com',
      businessId: 'biz-456',
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'reset-success@example.com', otp: '123456', newPassword: 'NewStrongPass1' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('reset');

    // Verify the password was hashed and stored
    const utils = jest.requireMock('../src/server/utils/auth');
    expect(utils.hashPassword).toHaveBeenCalledWith('NewStrongPass1');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'reset-success@example.com' },
        data: { password: expect.any(String) },
      })
    );
  });

  it('should reject weak password (less than 8 characters)', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'test@example.com', otp: '123456', newPassword: 'weak' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Validation failed');
  });
});

// ==================== CHANGE PASSWORD ====================

describe('PUT /api/auth/change-password', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();

    // Set up the mock user for authenticate middleware
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      password: 'hashed_password_xyz',
      businessId: 'biz-456',
      role: 'OWNER',
      isActive: true,
      emailVerified: new Date(),
    });
    // Mock prisma.user.update for password change
    mockPrisma.user.update.mockResolvedValue({ id: 'user-abc-123' });
  });

  it('should change password for authenticated user', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', 'Bearer valid_token')
      .send({ currentPassword: 'OldPass1', newPassword: 'NewStrongPass1' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('updated');
    expect(res.body.message).toContain('sessions');

    // Verify current password was checked
    const utils = jest.requireMock('../src/server/utils/auth');
    expect(utils.comparePassword).toHaveBeenCalledWith('OldPass1', 'hashed_password_xyz');

    // Verify new password was hashed and stored
    expect(utils.hashPassword).toHaveBeenCalledWith('NewStrongPass1');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-abc-123' },
        data: { password: expect.any(String) },
      })
    );

    // Verify all sessions were revoked
    const tokenBlacklist = jest.requireMock('../src/server/services/token-blacklist.service');
    expect(tokenBlacklist.revokeAllUserTokens).toHaveBeenCalledWith('user-abc-123');
  });

  it('should require authentication when no token is provided', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .send({ currentPassword: 'OldPass1', newPassword: 'NewStrongPass1' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });
});
