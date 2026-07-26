/**
 * @jest-environment node
 *
 * End-to-end integration tests for the Super Admin API.
 *
 * These tests use supertest to make real HTTP requests against the Express
 * router with the full middleware stack (JSON parsing, etc.) while mocking
 * Prisma, auth utilities, and ancillary services to isolate the super admin logic.
 *
 * Super Admin endpoints tested:
 *   GET  /api/super-admin/stats                — Platform-wide statistics
 *   GET  /api/super-admin/analytics            — Platform analytics (30/60/90 day)
 *   GET  /api/super-admin/growth               — 12-month growth trend
 *   GET  /api/super-admin/businesses           — List all businesses (paginated, filtered)
 *   GET  /api/super-admin/businesses/:id       — Get single business with relations
 *   PUT  /api/super-admin/businesses/:id/plan  — Update business plan
 *   PUT  /api/super-admin/businesses/:id/status — Suspend/activate business
 *   GET  /api/super-admin/users                — List all users (paginated, filtered)
 *   PUT  /api/super-admin/users/:id/role       — Change user role
 *   PUT  /api/super-admin/users/:id/status     — Suspend/activate user
 *   DELETE /api/super-admin/users/:id          — Delete user
 *   GET  /api/super-admin/subscriptions        — List all subscriptions (paginated, filtered)
 *   GET  /api/super-admin/backgrounds          — List poster backgrounds (paginated, filtered)
 *   POST /api/super-admin/backgrounds          — Create poster background
 *   PUT  /api/super-admin/backgrounds/:id      — Update poster background
 *   DELETE /api/super-admin/backgrounds/:id    — Delete poster background
 *   GET  /api/super-admin/settings             — Get platform settings
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ────────────────────────────────────────────────────────────
// All jest.mock calls MUST be at the top level so Jest hoists them above imports.

// ── Prisma mock ──────────────────────────────────────────────────────────────────
const mockPrisma = {
  business: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
  },
  user: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  contact: {
    count: jest.fn(),
  },
  message: {
    count: jest.fn(),
  },
  subscription: {
    count: jest.fn(),
    findMany: jest.fn(),
    aggregate: jest.fn(),
  },
  posterBackground: {
    count: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
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

// ── JSON Web Token mock (used by authenticate middleware) ───────────────────────
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

// ── CSRF Service mock (dynamically imported in authenticate middleware) ──────────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── Trap setInterval calls (auth.ts OTP cleanup) so we can clean them up ─────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

// Import the router AFTER all mocks are set up
import superAdminRoutes from '../src/server/routes/super-admin';

// ─── Fixtures ─────────────────────────────────────────────────────────────────────

const mockBusiness = {
  id: 'biz-1',
  name: 'Test Business',
  email: 'business@test.com',
  phone: '+1234567890',
  type: 'general',
  plan: 'FREE',
  planExpiresAt: new Date('2025-12-31'),
  city: 'Test City',
  country: 'US',
  logoUrl: null,
  aiCreditsUsed: 0,
  aiCreditsLimit: 100,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  users: [
    { id: 'user-1', email: 'owner@test.com', name: 'Owner', role: 'OWNER', isActive: true },
    { id: 'user-2', email: 'member@test.com', name: 'Member', role: 'MEMBER', isActive: true },
  ],
  contacts: [{ id: 'contact-1' }, { id: 'contact-2' }],
  campaigns: [{ id: 'campaign-1' }],
  subscriptions: [{ id: 'sub-1', status: 'active', amount: 999, plan: 'STARTER' }],
  _count: {
    users: 2,
    contacts: 2,
    campaigns: 1,
  },
};

const mockUser = {
  id: 'user-1',
  email: 'owner@test.com',
  name: 'Business Owner',
  password: 'hashed_password',
  role: 'OWNER',
  businessId: 'biz-1',
  isActive: true,
  image: null,
  googleId: null,
  appleId: null,
  lastLoginAt: new Date('2025-01-15'),
  phone: '+1234567890',
  emailVerified: true,
  isVerified: false,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  business: {
    id: 'biz-1',
    name: 'Test Business',
    type: 'general',
    plan: 'FREE',
  },
};

const mockSubscription = {
  id: 'sub-1',
  businessId: 'biz-1',
  status: 'active',
  plan: 'STARTER',
  amount: 999,
  createdAt: new Date('2025-01-01'),
  business: {
    id: 'biz-1',
    name: 'Test Business',
    type: 'general',
    plan: 'FREE',
  },
};

const mockBackground = {
  id: 'bg-1',
  name: 'Default Background',
  imageUrl: 'https://example.com/bg.jpg',
  thumbnailUrl: 'https://example.com/bg-thumb.jpg',
  category: 'general',
  scheduleType: 'manual',
  expiresAt: null,
  isActive: true,
  isSystem: true,
  createdAt: new Date('2025-01-01'),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/super-admin', superAdminRoutes);
  return app;
}

function resetMocks(): void {
  jest.resetAllMocks();

  // Re-apply default mock implementations for auth
  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'super-admin-1',
    email: 'super@admin.com',
    businessId: null,
    role: 'SUPER_ADMIN',
  });

  // Mock prisma.user.findUnique so authenticate middleware succeeds
  // (it queries the DB after verifying the JWT)
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
  // Clear the OTP cleanup interval from auth.ts so Jest can exit cleanly
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── Tests ────────────────────────────────────────────────────────────────────────

describe('Super Admin API', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  // ==================== GET /stats ====================
  describe('GET /api/super-admin/stats', () => {
    it('should return platform statistics successfully (200)', async () => {
      mockPrisma.business.count.mockResolvedValueOnce(100); // totalBusinesses
      mockPrisma.user.count.mockResolvedValueOnce(250); // totalUsers
      mockPrisma.contact.count.mockResolvedValueOnce(5000); // totalContacts
      mockPrisma.message.count.mockResolvedValueOnce(10000); // totalMessages

      mockPrisma.subscription.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 5000000 } }); // totalRevenue

      mockPrisma.subscription.count.mockResolvedValueOnce(50); // activeSubscriptions

      mockPrisma.business.groupBy.mockResolvedValue([
        { plan: 'FREE', _count: { id: 60 } },
        { plan: 'STARTER', _count: { id: 25 } },
        { plan: 'PRO', _count: { id: 15 } },
      ]);

      mockPrisma.business.findMany.mockResolvedValue([
        { ...mockBusiness, id: 'biz-1', _count: { users: 2, contacts: 2, campaigns: 1 }, subscriptions: [{ status: 'active' }] },
        { ...mockBusiness, id: 'biz-2', _count: { users: 1, contacts: 5, campaigns: 3 }, subscriptions: [{ status: 'active' }] },
      ]);

      const res = await request(app)
        .get('/api/super-admin/stats')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        totalBusinesses: 100,
        totalUsers: 250,
        totalContacts: 5000,
        totalMessages: 10000,
        totalRevenue: 5000000,
        activeSubscriptions: 50,
        planBreakdown: { FREE: 60, STARTER: 25, PRO: 15 },
      });
      expect(res.body.data.recentBusinesses).toHaveLength(2);
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/super-admin/stats')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Authentication required');
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .get('/api/super-admin/stats')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Insufficient permissions');
    });

    it('should return 500 when database query fails', async () => {
      mockPrisma.business.count.mockRejectedValue(new Error('DB connection failed'));

      const res = await request(app)
        .get('/api/super-admin/stats')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to fetch stats');
      expect(res.body.details).toBe('DB connection failed');
    });
  });

  // ==================== GET /analytics ====================
  describe('GET /api/super-admin/analytics', () => {
    it('should return analytics with default 30-day period (200)', async () => {
      mockPrisma.business.count.mockResolvedValueOnce(10); // newBusinesses
      mockPrisma.user.count.mockResolvedValueOnce(25); // newUsers
      mockPrisma.contact.count.mockResolvedValueOnce(100); // newContacts
      mockPrisma.message.count.mockResolvedValueOnce(500); // messagesSent
      mockPrisma.subscription.count.mockResolvedValueOnce(20); // subscriptionsCreated

      mockPrisma.subscription.aggregate.mockResolvedValue({ _sum: { amount: 1000000 } }); // monthlyRevenue

      mockPrisma.business.groupBy.mockResolvedValue([
        { createdAt: new Date('2025-01-01'), _count: { id: 5 } },
        { createdAt: new Date('2025-02-01'), _count: { id: 5 } },
      ]);

      const res = await request(app)
        .get('/api/super-admin/analytics')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        period: '30 days',
        newBusinesses: 10,
        newUsers: 25,
        newContacts: 100,
        messagesSent: 500,
        subscriptionsCreated: 20,
        monthlyRevenue: 1000000,
      });
      expect(res.body.data.growthTrend).toHaveLength(2);
    });

    it('should accept custom period parameter', async () => {
      mockPrisma.business.count.mockResolvedValue(5);
      mockPrisma.user.count.mockResolvedValue(10);
      mockPrisma.contact.count.mockResolvedValue(50);
      mockPrisma.message.count.mockResolvedValue(200);
      mockPrisma.subscription.count.mockResolvedValue(10);
      mockPrisma.subscription.aggregate.mockResolvedValue({ _sum: { amount: 500000 } });
      mockPrisma.business.groupBy.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/super-admin/analytics?period=60')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.period).toBe('60 days');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/super-admin/analytics')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.business.count.mockRejectedValue(new Error('Query timeout'));

      const res = await request(app)
        .get('/api/super-admin/analytics')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to fetch analytics');
    });
  });

  // ==================== GET /growth ====================
  describe('GET /api/super-admin/growth', () => {
    it('should return 12-month growth trend (200)', async () => {
      // Mock the loop of 12 months
      for (let i = 0; i < 12; i++) {
        mockPrisma.business.count.mockResolvedValueOnce(i + 1);
        mockPrisma.user.count.mockResolvedValueOnce((i + 1) * 2);
        mockPrisma.subscription.aggregate.mockResolvedValueOnce({ _sum: { amount: (i + 1) * 100000 } });
      }

      const res = await request(app)
        .get('/api/super-admin/growth')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(12);
      expect(res.body.data[0]).toHaveProperty('month');
      expect(res.body.data[0]).toHaveProperty('businesses');
      expect(res.body.data[0]).toHaveProperty('users');
      expect(res.body.data[0]).toHaveProperty('revenue');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/super-admin/growth')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.business.count.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/super-admin/growth')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to fetch growth data');
    });
  });

  // ==================== GET /businesses ====================
  describe('GET /api/super-admin/businesses', () => {
    it('should return paginated businesses list (200)', async () => {
      mockPrisma.business.findMany.mockResolvedValue([mockBusiness, { ...mockBusiness, id: 'biz-2' }]);
      mockPrisma.business.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/super-admin/businesses')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.businesses).toHaveLength(2);
      expect(res.body.data.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it('should support search filter', async () => {
      mockPrisma.business.findMany.mockResolvedValue([mockBusiness]);
      mockPrisma.business.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/api/super-admin/businesses?search=test')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockPrisma.business.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.any(Object) }),
              expect.objectContaining({ email: expect.any(Object) }),
              expect.objectContaining({ phone: expect.any(Object) }),
            ]),
          }),
        })
      );
    });

    it('should support plan filter', async () => {
      mockPrisma.business.findMany.mockResolvedValue([mockBusiness]);
      mockPrisma.business.count.mockResolvedValue(1);

      await request(app)
        .get('/api/super-admin/businesses?plan=PRO')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.business.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ plan: 'PRO' }),
        })
      );
    });

    it('should support type filter', async () => {
      mockPrisma.business.findMany.mockResolvedValue([mockBusiness]);
      mockPrisma.business.count.mockResolvedValue(1);

      await request(app)
        .get('/api/super-admin/businesses?type=agency')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.business.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'agency' }),
        })
      );
    });

    it('should support pagination', async () => {
      mockPrisma.business.findMany.mockResolvedValue([]);
      mockPrisma.business.count.mockResolvedValue(50);

      const res = await request(app)
        .get('/api/super-admin/businesses?page=2&limit=10')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.data.pagination).toMatchObject({
        page: 2,
        limit: 10,
        total: 50,
        totalPages: 5,
      });
    });

    it('should return empty array when no businesses match', async () => {
      mockPrisma.business.findMany.mockResolvedValue([]);
      mockPrisma.business.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/api/super-admin/businesses')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.businesses).toEqual([]);
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/super-admin/businesses')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('ADMIN');

      const res = await request(app)
        .get('/api/super-admin/businesses')
        .set('Authorization', 'Bearer admin_token')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.business.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/super-admin/businesses')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to list businesses');
    });
  });

  // ==================== GET /businesses/:id ====================
  describe('GET /api/super-admin/businesses/:id', () => {
    it('should return single business with relations (200)', async () => {
      mockPrisma.business.findUnique.mockResolvedValue(mockBusiness);

      const res = await request(app)
        .get('/api/super-admin/businesses/biz-1')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: 'biz-1',
        name: 'Test Business',
      });
      expect(res.body.data.users).toHaveLength(2);
      expect(res.body.data.contacts).toHaveLength(2);
      expect(res.body.data.campaigns).toHaveLength(1);
    });

    it('should return 404 when business not found', async () => {
      mockPrisma.business.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/super-admin/businesses/nonexistent')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Business not found');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/super-admin/businesses/biz-1')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .get('/api/super-admin/businesses/biz-1')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.business.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/super-admin/businesses/biz-1')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to get business');
    });
  });

  // ==================== PUT /businesses/:id/plan ====================
  describe('PUT /api/super-admin/businesses/:id/plan', () => {
    it('should update business plan successfully (200)', async () => {
      const updatedBusiness = { ...mockBusiness, plan: 'PRO', planExpiresAt: new Date('2026-12-31') };
      mockPrisma.business.update.mockResolvedValue(updatedBusiness);

      const res = await request(app)
        .put('/api/super-admin/businesses/biz-1/plan')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ plan: 'PRO', expiresAt: '2026-12-31' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.plan).toBe('PRO');
      expect(mockPrisma.business.update).toHaveBeenCalledWith({
        where: { id: 'biz-1' },
        data: {
          plan: 'PRO',
          planExpiresAt: expect.any(Date),
        },
      });
    });

    it('should return 400 when plan is missing', async () => {
      const res = await request(app)
        .put('/api/super-admin/businesses/biz-1/plan')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ expiresAt: '2026-12-31' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Plan is required');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .put('/api/super-admin/businesses/biz-1/plan')
        .send({ plan: 'PRO' })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .put('/api/super-admin/businesses/biz-1/plan')
        .set('Authorization', 'Bearer owner_token')
        .send({ plan: 'PRO' })
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.business.update.mockRejectedValue(new Error('Update failed'));

      const res = await request(app)
        .put('/api/super-admin/businesses/biz-1/plan')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ plan: 'PRO' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to update plan');
    });
  });

  // ==================== PUT /businesses/:id/status ====================
  describe('PUT /api/super-admin/businesses/:id/status', () => {
    it('should suspend business successfully (200)', async () => {
      mockPrisma.business.update.mockResolvedValue(mockBusiness);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 2 });

      const res = await request(app)
        .put('/api/super-admin/businesses/biz-1/status')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ isActive: false, reason: 'Policy violation' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Business suspended successfully');
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { businessId: 'biz-1' },
        data: { isActive: false },
      });
    });

    it('should activate business successfully (200)', async () => {
      mockPrisma.business.update.mockResolvedValue(mockBusiness);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 2 });

      const res = await request(app)
        .put('/api/super-admin/businesses/biz-1/status')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ isActive: true })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Business activated successfully');
    });

    it('should return 400 when isActive is missing', async () => {
      const res = await request(app)
        .put('/api/super-admin/businesses/biz-1/status')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ reason: 'test' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('isActive is required');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .put('/api/super-admin/businesses/biz-1/status')
        .send({ isActive: false })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .put('/api/super-admin/businesses/biz-1/status')
        .set('Authorization', 'Bearer owner_token')
        .send({ isActive: false })
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.business.update.mockRejectedValue(new Error('Update failed'));

      const res = await request(app)
        .put('/api/super-admin/businesses/biz-1/status')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ isActive: false })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to update status');
    });
  });

  // ==================== GET /users ====================
  describe('GET /api/super-admin/users', () => {
    it('should return paginated users list (200)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser, { ...mockUser, id: 'user-2', role: 'MEMBER' }]);
      mockPrisma.user.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/super-admin/users')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.users).toHaveLength(2);
      expect(res.body.data.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it('should support search filter', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);
      mockPrisma.user.count.mockResolvedValue(1);

      await request(app)
        .get('/api/super-admin/users?search=owner')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ email: expect.any(Object) }),
              expect.objectContaining({ name: expect.any(Object) }),
            ]),
          }),
        })
      );
    });

    it('should support role filter', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);
      mockPrisma.user.count.mockResolvedValue(1);

      await request(app)
        .get('/api/super-admin/users?role=OWNER')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: 'OWNER' }),
        })
      );
    });

    it('should support businessId filter', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);
      mockPrisma.user.count.mockResolvedValue(1);

      await request(app)
        .get('/api/super-admin/users?businessId=biz-1')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ businessId: 'biz-1' }),
        })
      );
    });

    it('should return empty array when no users match', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/api/super-admin/users')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.users).toEqual([]);
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/super-admin/users')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .get('/api/super-admin/users')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.user.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/super-admin/users')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to list users');
    });
  });

  // ==================== PUT /users/:id/role ====================
  describe('PUT /api/super-admin/users/:id/role', () => {
    it('should update user role successfully (200)', async () => {
      const updatedUser = { ...mockUser, role: 'ADMIN' };
      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const res = await request(app)
        .put('/api/super-admin/users/user-1/role')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ role: 'ADMIN' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('ADMIN');
    });

    it('should prevent SUPER_ADMIN from demoting themselves (403)', async () => {
      const res = await request(app)
        .put('/api/super-admin/users/super-admin-1/role')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ role: 'OWNER' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('You cannot change your own SUPER_ADMIN role.');
    });

    it('should return 400 for invalid role', async () => {
      const res = await request(app)
        .put('/api/super-admin/users/user-1/role')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ role: 'INVALID_ROLE' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid role');
    });

    it('should return 400 when role is missing', async () => {
      const res = await request(app)
        .put('/api/super-admin/users/user-1/role')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .put('/api/super-admin/users/user-1/role')
        .send({ role: 'ADMIN' })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .put('/api/super-admin/users/user-1/role')
        .set('Authorization', 'Bearer owner_token')
        .send({ role: 'ADMIN' })
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.user.update.mockRejectedValue(new Error('Update failed'));

      const res = await request(app)
        .put('/api/super-admin/users/user-1/role')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ role: 'ADMIN' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to update role');
    });
  });

  // ==================== PUT /users/:id/status ====================
  describe('PUT /api/super-admin/users/:id/status', () => {
    it('should suspend user successfully (200)', async () => {
      const updatedUser = { ...mockUser, isActive: false };
      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const res = await request(app)
        .put('/api/super-admin/users/user-1/status')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ isActive: false })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('User suspended successfully');
      expect(res.body.data.isActive).toBe(false);
    });

    it('should activate user successfully (200)', async () => {
      const updatedUser = { ...mockUser, isActive: true };
      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const res = await request(app)
        .put('/api/super-admin/users/user-1/status')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ isActive: true })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('User activated successfully');
    });

    it('should return 400 when isActive is missing', async () => {
      const res = await request(app)
        .put('/api/super-admin/users/user-1/status')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('isActive is required');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .put('/api/super-admin/users/user-1/status')
        .send({ isActive: false })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .put('/api/super-admin/users/user-1/status')
        .set('Authorization', 'Bearer owner_token')
        .send({ isActive: false })
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.user.update.mockRejectedValue(new Error('Update failed'));

      const res = await request(app)
        .put('/api/super-admin/users/user-1/status')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ isActive: false })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to update user status');
    });
  });

  // ==================== DELETE /users/:id ====================
  describe('DELETE /api/super-admin/users/:id', () => {
    it('should delete user successfully (200)', async () => {
      mockPrisma.user.delete.mockResolvedValue(mockUser);

      const res = await request(app)
        .delete('/api/super-admin/users/user-1')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('User deleted successfully');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .delete('/api/super-admin/users/user-1')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .delete('/api/super-admin/users/user-1')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.user.delete.mockRejectedValue(new Error('Delete failed'));

      const res = await request(app)
        .delete('/api/super-admin/users/user-1')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to delete user');
    });
  });

  // ==================== GET /subscriptions ====================
  describe('GET /api/super-admin/subscriptions', () => {
    it('should return paginated subscriptions list (200)', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([mockSubscription, { ...mockSubscription, id: 'sub-2' }]);
      mockPrisma.subscription.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/super-admin/subscriptions')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.subscriptions).toHaveLength(2);
      expect(res.body.data.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it('should support status filter', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([mockSubscription]);
      mockPrisma.subscription.count.mockResolvedValue(1);

      await request(app)
        .get('/api/super-admin/subscriptions?status=active')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        })
      );
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/super-admin/subscriptions')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .get('/api/super-admin/subscriptions')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.subscription.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/super-admin/subscriptions')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to list subscriptions');
    });
  });

  // ==================== GET /backgrounds ====================
  describe('GET /api/super-admin/backgrounds', () => {
    it('should return paginated backgrounds list (200)', async () => {
      mockPrisma.posterBackground.findMany.mockResolvedValue([mockBackground, { ...mockBackground, id: 'bg-2' }]);
      mockPrisma.posterBackground.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/super-admin/backgrounds')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('should support category filter', async () => {
      mockPrisma.posterBackground.findMany.mockResolvedValue([mockBackground]);
      mockPrisma.posterBackground.count.mockResolvedValue(1);

      await request(app)
        .get('/api/super-admin/backgrounds?category=general')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.posterBackground.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'general' }),
        })
      );
    });

    it('should support isActive filter', async () => {
      mockPrisma.posterBackground.findMany.mockResolvedValue([mockBackground]);
      mockPrisma.posterBackground.count.mockResolvedValue(1);

      await request(app)
        .get('/api/super-admin/backgrounds?isActive=true')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(mockPrisma.posterBackground.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        })
      );
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/super-admin/backgrounds')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .get('/api/super-admin/backgrounds')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.posterBackground.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/super-admin/backgrounds')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to fetch backgrounds');
    });
  });

  // ==================== POST /backgrounds ====================
  describe('POST /api/super-admin/backgrounds', () => {
    it('should create background successfully (201)', async () => {
      const newBackground = { ...mockBackground, id: 'bg-new', name: 'New Background' };
      mockPrisma.posterBackground.create.mockResolvedValue(newBackground);

      const res = await request(app)
        .post('/api/super-admin/backgrounds')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ name: 'New Background', imageUrl: 'https://example.com/new.jpg', category: 'seasonal' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('New Background');
      expect(mockPrisma.posterBackground.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'New Background',
            imageUrl: 'https://example.com/new.jpg',
            category: 'seasonal',
            isSystem: true,
          }),
        })
      );
    });

    it('should return 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/super-admin/backgrounds')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ imageUrl: 'https://example.com/bg.jpg' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Name and imageUrl are required');
    });

    it('should return 400 when imageUrl is missing', async () => {
      const res = await request(app)
        .post('/api/super-admin/backgrounds')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ name: 'Test Background' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Name and imageUrl are required');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .post('/api/super-admin/backgrounds')
        .send({ name: 'Test', imageUrl: 'https://example.com/bg.jpg' })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .post('/api/super-admin/backgrounds')
        .set('Authorization', 'Bearer owner_token')
        .send({ name: 'Test', imageUrl: 'https://example.com/bg.jpg' })
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.posterBackground.create.mockRejectedValue(new Error('Create failed'));

      const res = await request(app)
        .post('/api/super-admin/backgrounds')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ name: 'Test', imageUrl: 'https://example.com/bg.jpg' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to create background');
    });
  });

  // ==================== PUT /backgrounds/:id ====================
  describe('PUT /api/super-admin/backgrounds/:id', () => {
    it('should update background successfully (200)', async () => {
      const updatedBackground = { ...mockBackground, name: 'Updated Background', isActive: false };
      mockPrisma.posterBackground.update.mockResolvedValue(updatedBackground);

      const res = await request(app)
        .put('/api/super-admin/backgrounds/bg-1')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ name: 'Updated Background', isActive: false })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Updated Background');
      expect(res.body.data.isActive).toBe(false);
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .put('/api/super-admin/backgrounds/bg-1')
        .send({ name: 'Updated' })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .put('/api/super-admin/backgrounds/bg-1')
        .set('Authorization', 'Bearer owner_token')
        .send({ name: 'Updated' })
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.posterBackground.update.mockRejectedValue(new Error('Update failed'));

      const res = await request(app)
        .put('/api/super-admin/backgrounds/bg-1')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .send({ name: 'Updated' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to update background');
    });
  });

  // ==================== DELETE /backgrounds/:id ====================
  describe('DELETE /api/super-admin/backgrounds/:id', () => {
    it('should delete background successfully (200)', async () => {
      mockPrisma.posterBackground.delete.mockResolvedValue(mockBackground);

      const res = await request(app)
        .delete('/api/super-admin/backgrounds/bg-1')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Background deleted');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .delete('/api/super-admin/backgrounds/bg-1')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .delete('/api/super-admin/backgrounds/bg-1')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.posterBackground.delete.mockRejectedValue(new Error('Delete failed'));

      const res = await request(app)
        .delete('/api/super-admin/backgrounds/bg-1')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to delete background');
    });
  });

  // ==================== GET /settings ====================
  describe('GET /api/super-admin/settings', () => {
    it('should return platform settings (200)', async () => {
      mockPrisma.business.count.mockResolvedValueOnce(100); // totalBusinesses
      mockPrisma.user.count.mockResolvedValueOnce(250); // totalUsers

      mockPrisma.business.groupBy.mockResolvedValue([
        { plan: 'FREE', _count: { id: 60 } },
        { plan: 'PRO', _count: { id: 40 } },
      ]);

      const res = await request(app)
        .get('/api/super-admin/settings')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        totalBusinesses: 100,
        totalUsers: 250,
        planDistribution: { FREE: 60, PRO: 40 },
      });
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/super-admin/settings')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 403 for non-SUPER_ADMIN role', async () => {
      setUserRole('OWNER');

      const res = await request(app)
        .get('/api/super-admin/settings')
        .set('Authorization', 'Bearer owner_token')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.business.count.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/super-admin/settings')
        .set('Authorization', 'Bearer valid_super_admin_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to fetch settings');
    });
  });
});