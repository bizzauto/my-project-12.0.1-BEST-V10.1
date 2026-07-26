/**
 * @jest-environment node
 *
 * Integration tests for the User API (account deletion).
 * Tests GDPR-compliant account deletion with password verification,
 * confirmation text check, and cascading delete of associated data.
 *
 * Endpoints tested:
 *   POST /api/user/delete-account  delete user account (GDPR)
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

// ── Prisma mock ──────────────────────────────────────────────────────────────
// IMPORTANT: The user route uses (tx as any).refreshToken and (tx as any).conversation
// inside the $transaction callback — these must be on the mock object.
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  business: {
    delete: jest.fn(),
  },
  notification: {
    deleteMany: jest.fn(),
  },
  themePreference: {
    deleteMany: jest.fn(),
  },
  aIContent: {
    deleteMany: jest.fn(),
  },
  apiKey: {
    deleteMany: jest.fn(),
  },
  auditLog: {
    deleteMany: jest.fn(),
  },
  contact: {
    deleteMany: jest.fn(),
  },
  campaign: {
    deleteMany: jest.fn(),
  },
  appointment: {
    deleteMany: jest.fn(),
  },
  workflow: {
    deleteMany: jest.fn(),
  },
  integration: {
    deleteMany: jest.fn(),
  },
  subscription: {
    deleteMany: jest.fn(),
  },
  // Additional models accessed via (tx as any) in the route
  refreshToken: {
    deleteMany: jest.fn(),
  },
  conversation: {
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
}));

// ── Auth utilities mock ──────────────────────────────────────────────────────
jest.mock('../src/server/utils/auth', () => ({
  verifyToken: jest.fn().mockResolvedValue({
    id: 'user-1',
    email: 'test@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  }),
  comparePassword: jest.fn(),
  hashPassword: jest.fn().mockResolvedValue('hashed_password'),
  generateToken: jest.fn().mockReturnValue('mock_jwt_token'),
  generateRefreshToken: jest.fn().mockReturnValue('mock_refresh_token'),
  getJwtSecret: jest.fn().mockReturnValue('test-secret'),
  encrypt: jest.fn().mockReturnValue('encrypted'),
  decrypt: jest.fn().mockReturnValue('decrypted'),
}));

// ── Disable rate limiting for tests ──────────────────────────────────────────
jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

// ── JSON Web Token mock ──────────────────────────────────────────────────────
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({
    id: 'user-1',
    email: 'test@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  }),
  sign: jest.fn().mockReturnValue('mock_jwt_token'),
  decode: jest.fn(),
}));

// ── CSRF Service mock ────────────────────────────────────────────────────────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// Import router AFTER all mocks
import userRoutes from '../src/server/routes/user';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  name: 'Test User',
  password: 'hashed_password',
  role: 'OWNER',
  businessId: 'biz-1',
  isActive: true,
  image: null,
  googleId: null,
  appleId: null,
  lastLoginAt: null,
  phone: null,
  emailVerified: true,
  isVerified: false,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockMemberUser = {
  ...mockUser,
  id: 'user-2',
  email: 'member@test.com',
  role: 'MEMBER',
  businessId: 'biz-2',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/user', userRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'user-1',
    email: 'test@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  });

  mockPrisma.user.findUnique.mockResolvedValue(mockUser);

  const { comparePassword } = jest.requireMock('../src/server/utils/auth');
  comparePassword.mockResolvedValue(true);

  const { CSRFService } = jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');

  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
}

// ─── POST /api/user/delete-account ───────────────────────────────────────────

describe('POST /api/user/delete-account', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  const validPayload = {
    password: 'CorrectPassword1!',
    confirmText: 'DELETE MY ACCOUNT',
  };

  it('should delete account with password and confirmation (OWNER, deletes business)', async () => {
    const res = await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Account deleted successfully');

    // Verify password was checked
    const { comparePassword } = jest.requireMock('../src/server/utils/auth');
    expect(comparePassword).toHaveBeenCalledWith('CorrectPassword1!', 'hashed_password');

    // Verify transaction ran (cascading deletes)
    expect(mockPrisma.$transaction).toHaveBeenCalled();

    // Verify owner-specific business data cleanup
    expect(mockPrisma.contact.deleteMany).toHaveBeenCalledWith(
      { where: { businessId: 'biz-1' } },
    );
    expect(mockPrisma.business.delete).toHaveBeenCalledWith(
      { where: { id: 'biz-1' } },
    );
  });

  it('should delete member account without deleting business', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2',
      email: 'member@test.com',
      businessId: 'biz-2',
      role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue(mockMemberUser);

    const res = await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(200);

    expect(res.body.success).toBe(true);

    // MEMBER deletion should NOT delete business data
    expect(mockPrisma.contact.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.business.delete).not.toHaveBeenCalled();

    // But user-specific data should be cleaned up
    expect(mockPrisma.notification.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.user.delete).toHaveBeenCalled();
  });

  it('should return 400 when confirmText does not match', async () => {
    const res = await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer valid_token')
      .send({ password: 'CorrectPassword1!', confirmText: 'WRONG TEXT' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Confirmation text does not match');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('should return 400 when confirmText is missing', async () => {
    const res = await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer valid_token')
      .send({ password: 'CorrectPassword1!' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Confirmation text does not match');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('should return 401 with invalid password', async () => {
    const { comparePassword } = jest.requireMock('../src/server/utils/auth');
    comparePassword.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid password');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .post('/api/user/delete-account')
      .send(validPayload)
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('should skip password check for social-only accounts (null password)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      password: null,
    });

    const res = await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer valid_token')
      .send({ confirmText: 'DELETE MY ACCOUNT', password: '' })
      .expect(200);

    expect(res.body.success).toBe(true);

    // comparePassword should NOT be called for social accounts
    const { comparePassword } = jest.requireMock('../src/server/utils/auth');
    expect(comparePassword).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it('should return 500 when transaction fails', async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error('Transaction failed'));

    const res = await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to delete account');
  });

  it('should delete user-specific data in transaction for OWNER', async () => {
    // Re-setup the $transaction mock to properly simulate the tx object
    // that includes all models needed by the route
    const tx = {
      ...mockPrisma,
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      conversation: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

    await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(200);

    // Verify all user-specific deletions happen in the transaction
    expect(tx.notification.deleteMany).toHaveBeenCalledWith(
      { where: { userId: 'user-1' } },
    );
    expect(tx.themePreference.deleteMany).toHaveBeenCalledWith(
      { where: { userId: 'user-1' } },
    );
    expect(tx.aIContent.deleteMany).toHaveBeenCalledWith(
      { where: { userId: 'user-1' } },
    );
    expect(tx.apiKey.deleteMany).toHaveBeenCalledWith(
      { where: { userId: 'user-1' } },
    );
    expect(tx.auditLog.deleteMany).toHaveBeenCalledWith(
      { where: { userId: 'user-1' } },
    );
    expect(tx.user.delete).toHaveBeenCalledWith(
      { where: { id: 'user-1' } },
    );
  });

  it('should delete business data when user is OWNER', async () => {
    // Re-setup the $transaction mock to include all models
    const tx = {
      ...mockPrisma,
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      conversation: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

    await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(200);

    // Verify business-level deletions
    expect(tx.contact.deleteMany).toHaveBeenCalledWith(
      { where: { businessId: 'biz-1' } },
    );
    expect(tx.campaign.deleteMany).toHaveBeenCalledWith(
      { where: { businessId: 'biz-1' } },
    );
    expect(tx.appointment.deleteMany).toHaveBeenCalledWith(
      { where: { businessId: 'biz-1' } },
    );
    expect(tx.workflow.deleteMany).toHaveBeenCalledWith(
      { where: { businessId: 'biz-1' } },
    );
    expect(tx.integration.deleteMany).toHaveBeenCalledWith(
      { where: { businessId: 'biz-1' } },
    );
    expect(tx.subscription.deleteMany).toHaveBeenCalledWith(
      { where: { businessId: 'biz-1' } },
    );
    expect(tx.business.delete).toHaveBeenCalledWith(
      { where: { id: 'biz-1' } },
    );
  });
});
