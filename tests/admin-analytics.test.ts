/**
 * @jest-environment node
 *
 * End-to-end integration tests for the Admin Analytics API.
 *
 * These tests use supertest to make real HTTP requests against the Express
 * router with the full middleware stack while mocking Prisma and auth utilities.
 *
 * Admin Analytics endpoints tested:
 *   GET  /api/admin/analytics           — Platform-wide analytics overview
 *   GET  /api/admin/feature-flags       — Feature flags (env + DB overrides)
 *   PUT  /api/admin/feature-flags       — Toggle feature flags (persisted to DB)
 *   GET  /api/admin/audit-log           — Admin audit log with filtering
 *   GET  /api/admin/businesses          — List all businesses for admin
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ────────────────────────────────────────────────────────────

// ── Prisma mock ──────────────────────────────────────────────────────────────────
const mockPrisma = {
  business: {
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
  user: {
    count: jest.fn(),
    findUnique: jest.fn(),
  },
  contact: {
    count: jest.fn(),
  },
  message: {
    count: jest.fn(),
  },
  subscription: {
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  featureFlag: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  auditLog: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
}));

// ── Auth utilities mock ──────────────────────────────────────────────────────────
jest.mock('../src/server/utils/auth', () => ({
  verifyToken: jest.fn().mockResolvedValue({
    id: 'super-admin-1',
    email: 'super@admin.com',
    businessId: null,
    role: 'SUPER_ADMIN',
  }),
  hashPassword: jest.fn().mockResolvedValue('hashed_password'),
  comparePassword: jest.fn(),
  generateToken: jest.fn().mockReturnValue('mock_jwt_token'),
  generateRefreshToken: jest.fn().mockReturnValue('mock_refresh_token'),
  getJwtSecret: jest.fn().mockReturnValue('test-secret'),
  encrypt: jest.fn().mockReturnValue('encrypted'),
  decrypt: jest.fn().mockReturnValue('decrypted'),
}));

// ── Disable rate limiting ────────────────────────────────────────────────────────
jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

// ── JSON Web Token mock ─────────────────────────────────────────────────────────
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({
    id: 'super-admin-1',
    email: 'super@admin.com',
    businessId: null,
    role: 'SUPER_ADMIN',
  }),
  sign: jest.fn().mockReturnValue('mock_jwt_token'),
  decode: jest.fn(),
}));

// ── CSRF Service mock ────────────────────────────────────────────────────────────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── Trap setInterval calls ───────────────────────────────────────────────────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

// Import the router AFTER all mocks are set up
import adminAnalyticsRoutes from '../src/server/routes/admin-analytics';

// ─── Fixtures ──────────────────────────────────────────────────────────────────────

const mockBusiness = {
  id: 'biz-1',
  name: 'Test Business',
  email: 'business@test.com',
  plan: 'PRO',
  createdAt: new Date('2025-01-01'),
  _count: { users: 5, contacts: 100 },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminAnalyticsRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'super-admin-1',
    email: 'super@admin.com',
    businessId: null,
    role: 'SUPER_ADMIN',
  });
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'super-admin-1',
    email: 'super@admin.com',
    businessId: null,
    role: 'SUPER_ADMIN',
    isActive: true,
    emailVerified: true,
  });

  const { CSRFService } = jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');
}

function setUserRole(role: string): void {
  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'user-1',
    email: 'test@example.com',
    businessId: 'biz-1',
    role,
  });
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-1',
    email: 'test@example.com',
    businessId: 'biz-1',
    role,
    isActive: true,
    emailVerified: true,
  });

  const { verify: jwtVerify } = jest.requireMock('jsonwebtoken');
  jwtVerify.mockReturnValue({
    id: 'user-1',
    email: 'test@example.com',
    businessId: 'biz-1',
    role,
  });
}

function setUnauthenticated(): void {
  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockImplementation(() => {
    const err: any = new Error('No token provided');
    err.name = 'JsonWebTokenError';
    throw err;
  });

  const { verify: jwtVerify } = jest.requireMock('jsonwebtoken');
  jwtVerify.mockImplementation(() => {
    const err: any = new Error('No token provided');
    err.name = 'JsonWebTokenError';
    throw err;
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────────

afterAll(() => {
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── Tests ─────────────────────────────────────────────────────────────────────────

describe('Admin Analytics API', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  // ==================== GET /analytics ====================
  describe('GET /api/admin/analytics', () => {
    it('should return platform analytics overview (200)', async () => {
      mockPrisma.business.count
        .mockResolvedValueOnce(100)  // totalBusinesses
        .mockResolvedValueOnce(80)   // activeBusinesses
        .mockResolvedValueOnce(10)   // newBusinesses30d
        .mockResolvedValueOnce(8);   // previousBusinesses30d

      mockPrisma.user.count
        .mockResolvedValueOnce(250)  // totalUsers
        .mockResolvedValueOnce(25);  // newUsers30d

      mockPrisma.contact.count.mockResolvedValueOnce(5000);   // totalContacts
      mockPrisma.message.count
        .mockResolvedValueOnce(10000) // totalMessages
        .mockResolvedValueOnce(1000)  // messages30d
        .mockResolvedValueOnce(800);  // previousMessages30d

      mockPrisma.business.groupBy.mockResolvedValue([
        { plan: 'FREE', _count: 50 },
        { plan: 'STARTER', _count: 30 },
        { plan: 'PRO', _count: 20 },
      ]);

      mockPrisma.subscription.count.mockResolvedValueOnce(60); // activeSubscriptions
      mockPrisma.subscription.aggregate.mockResolvedValueOnce({ _sum: { amount: 5000000 } }); // totalRevenue

      const res = await request(app)
        .get('/api/admin/analytics')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        businesses: {
          total: 100,
          active: 80,
          new30d: 10,
          growth: 25, // ((10-8)/8)*100 = 25%
        },
        users: {
          total: 250,
          new30d: 25,
        },
        contacts: { total: 5000 },
        messages: {
          total: 10000,
          last30d: 1000,
          growth: 25, // ((1000-800)/800)*100 = 25%
        },
        plans: { FREE: 50, STARTER: 30, PRO: 20 },
        subscriptions: {
          active: 60,
          mrr: 50000, // 5000000 / 100
          arr: 600000, // 50000 * 12
        },
      });
    });

    it('should handle zero previous period gracefully (growth = 0)', async () => {
      mockPrisma.business.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(0); // previous = 0

      mockPrisma.user.count
        .mockResolvedValueOnce(250)
        .mockResolvedValueOnce(25);

      mockPrisma.contact.count.mockResolvedValueOnce(5000);
      mockPrisma.message.count
        .mockResolvedValueOnce(10000)
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(0); // previous = 0

      mockPrisma.business.groupBy.mockResolvedValue([{ plan: 'FREE', _count: 100 }]);
      mockPrisma.subscription.count.mockResolvedValueOnce(60);
      mockPrisma.subscription.aggregate.mockResolvedValueOnce({ _sum: { amount: 5000000 } });

      const res = await request(app)
        .get('/api/admin/analytics')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.businesses.growth).toBe(0);
      expect(res.body.data.messages.growth).toBe(0);
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/admin/analytics')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Authentication required');
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .get('/api/admin/analytics')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Insufficient permissions');
    });

    it('should return 500 on database error', async () => {
      mockPrisma.business.count.mockRejectedValue(new Error('DB connection failed'));

      const res = await request(app)
        .get('/api/admin/analytics')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('DB connection failed');
    });
  });

  // ==================== GET /feature-flags ====================
  describe('GET /api/admin/feature-flags', () => {
    it('should return feature flags with defaults when no overrides (200)', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/admin/feature-flags')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('aiCreativeStudio');
      expect(res.body.data).toHaveProperty('voiceCalls');
      expect(res.body.data).toHaveProperty('workflowBuilder');
      expect(res.body.data).toHaveProperty('funnelBuilder');
      expect(res.body.data).toHaveProperty('courseBuilder');
      expect(res.body.data).toHaveProperty('liveChat');
      expect(res.body.data).toHaveProperty('cartRecovery');
      expect(res.body.data).toHaveProperty('referrals');
      expect(res.body.data).toHaveProperty('loyaltyProgram');
      expect(res.body.data).toHaveProperty('betaFeatures');

      // Check default values
      expect(res.body.data.aiCreativeStudio).toEqual({ enabled: true, source: 'default' });
      expect(res.body.data.betaFeatures).toEqual({ enabled: false, source: 'default' });
    });

    it('should apply DB overrides when present (source: override)', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'aiCreativeStudio', enabled: false },
        { key: 'betaFeatures', enabled: true },
      ]);

      const res = await request(app)
        .get('/api/admin/feature-flags')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.aiCreativeStudio).toEqual({ enabled: false, source: 'override' });
      expect(res.body.data.betaFeatures).toEqual({ enabled: true, source: 'override' });
    });

    it('should apply env overrides when no DB override (source: env)', async () => {
      process.env.FF_AI_CREATIVE_STUDIO = 'false';
      process.env.FF_BETA_FEATURES = 'true';

      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/admin/feature-flags')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.aiCreativeStudio).toEqual({ enabled: false, source: 'env' });
      expect(res.body.data.betaFeatures).toEqual({ enabled: true, source: 'env' });

      delete process.env.FF_AI_CREATIVE_STUDIO;
      delete process.env.FF_BETA_FEATURES;
    });

    it('should prioritize DB override over env', async () => {
      process.env.FF_AI_CREATIVE_STUDIO = 'false';

      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'aiCreativeStudio', enabled: true }, // DB says true
      ]);

      const res = await request(app)
        .get('/api/admin/feature-flags')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.aiCreativeStudio).toEqual({ enabled: true, source: 'override' });

      delete process.env.FF_AI_CREATIVE_STUDIO;
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/admin/feature-flags')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .get('/api/admin/feature-flags')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.featureFlag.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/admin/feature-flags')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('DB error');
    });
  });

  // ==================== PUT /feature-flags ====================
  describe('PUT /api/admin/feature-flags', () => {
    it('should update feature flags successfully (200)', async () => {
      mockPrisma.featureFlag.upsert
        .mockResolvedValueOnce({ key: 'aiCreativeStudio', enabled: false })
        .mockResolvedValueOnce({ key: 'betaFeatures', enabled: true });

      const res = await request(app)
        .put('/api/admin/feature-flags')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ aiCreativeStudio: false, betaFeatures: true })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Feature flags updated');
      expect(res.body.data).toEqual({ aiCreativeStudio: false, betaFeatures: true });
      expect(mockPrisma.featureFlag.upsert).toHaveBeenCalledTimes(2);
    });

    it('should ignore non-boolean values', async () => {
      mockPrisma.featureFlag.upsert.mockResolvedValue({ key: 'aiCreativeStudio', enabled: true });

      const res = await request(app)
        .put('/api/admin/feature-flags')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ aiCreativeStudio: 'not-a-boolean', betaFeatures: true })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ betaFeatures: true });
      expect(mockPrisma.featureFlag.upsert).toHaveBeenCalledTimes(1);
    });

    it('should return empty updates when body is a string (ignored)', async () => {
      const res = await request(app)
        .put('/api/admin/feature-flags')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send('invalid')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({});
    });

    it('should return empty updates when body is missing', async () => {
      const res = await request(app)
        .put('/api/admin/feature-flags')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({});
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .put('/api/admin/feature-flags')
        .send({ aiCreativeStudio: false })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .put('/api/admin/feature-flags')
        .set('Authorization', 'Bearer owner_token')
        .send({ aiCreativeStudio: false })
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.featureFlag.upsert.mockRejectedValue(new Error('Upsert failed'));

      const res = await request(app)
        .put('/api/admin/feature-flags')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ aiCreativeStudio: false })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Upsert failed');
    });
  });

  // ==================== GET /audit-log ====================
  describe('GET /api/admin/audit-log', () => {
    const mockAuditLogs = [
      {
        id: 'log-1',
        action: 'CREATE',
        entity: 'Business',
        entityId: 'biz-1',
        businessId: 'biz-1',
        userId: 'user-1',
        metadata: { name: 'Test Business' },
        createdAt: new Date('2025-01-15'),
      },
      {
        id: 'log-2',
        action: 'UPDATE',
        entity: 'User',
        entityId: 'user-2',
        businessId: 'biz-1',
        userId: 'user-1',
        metadata: { role: 'ADMIN' },
        createdAt: new Date('2025-01-14'),
      },
    ];

    it('should return paginated audit logs (200)', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue(mockAuditLogs);
      mockPrisma.auditLog.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/admin/audit-log')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.logs).toHaveLength(2);
      expect(res.body.data.pagination).toMatchObject({
        total: 2,
        page: 1,
        limit: 50,
        totalPages: 1,
      });
    });

    it('should filter by action', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([mockAuditLogs[0]]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      await request(app)
        .get('/api/admin/audit-log?action=CREATE')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: 'CREATE' }),
        })
      );
    });

    it('should filter by entity', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([mockAuditLogs[1]]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      await request(app)
        .get('/api/admin/audit-log?entity=User')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entity: 'User' }),
        })
      );
    });

    it('should filter by businessId', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue(mockAuditLogs);
      mockPrisma.auditLog.count.mockResolvedValue(2);

      await request(app)
        .get('/api/admin/audit-log?businessId=biz-1')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ businessId: 'biz-1' }),
        })
      );
    });

    it('should filter by date range', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue(mockAuditLogs);
      mockPrisma.auditLog.count.mockResolvedValue(2);

      await request(app)
        .get('/api/admin/audit-log?startDate=2025-01-01&endDate=2025-01-31')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        })
      );
    });

    it('should support pagination', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([mockAuditLogs[0]]);
      mockPrisma.auditLog.count.mockResolvedValue(100);

      const res = await request(app)
        .get('/api/admin/audit-log?page=2&limit=10')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.data.pagination).toMatchObject({
        total: 100,
        page: 2,
        limit: 10,
        totalPages: 10,
      });
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      );
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/admin/audit-log')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .get('/api/admin/audit-log')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.auditLog.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/admin/audit-log')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('DB error');
    });
  });

  // ==================== GET /businesses ====================
  describe('GET /api/admin/businesses', () => {
    it('should return paginated businesses list (200)', async () => {
      mockPrisma.business.findMany.mockResolvedValue([mockBusiness, { ...mockBusiness, id: 'biz-2' }]);
      mockPrisma.business.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/admin/businesses')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.businesses).toHaveLength(2);
      expect(res.body.data.pagination).toMatchObject({
        total: 2,
        page: 1,
        limit: 50,
        totalPages: 1,
      });
    });

    it('should filter by plan', async () => {
      mockPrisma.business.findMany.mockResolvedValue([mockBusiness]);
      mockPrisma.business.count.mockResolvedValue(1);

      await request(app)
        .get('/api/admin/businesses?plan=PRO')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.business.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ plan: 'PRO' }),
        })
      );
    });

    it('should filter by search (name or email)', async () => {
      mockPrisma.business.findMany.mockResolvedValue([mockBusiness]);
      mockPrisma.business.count.mockResolvedValue(1);

      await request(app)
        .get('/api/admin/businesses?search=test')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.business.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.any(Object) }),
              expect.objectContaining({ email: expect.any(Object) }),
            ]),
          }),
        })
      );
    });

    it('should support pagination', async () => {
      mockPrisma.business.findMany.mockResolvedValue([]);
      mockPrisma.business.count.mockResolvedValue(150);

      const res = await request(app)
        .get('/api/admin/businesses?page=2&limit=25')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.data.pagination).toMatchObject({
        total: 150,
        page: 2,
        limit: 25,
        totalPages: 6,
      });
    });

    it('should return empty array when no businesses match', async () => {
      mockPrisma.business.findMany.mockResolvedValue([]);
      mockPrisma.business.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/api/admin/businesses')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.businesses).toEqual([]);
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/admin/businesses')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .get('/api/admin/businesses')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.business.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/admin/businesses')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('DB error');
    });
  });
});