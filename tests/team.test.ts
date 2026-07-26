/**
 * @jest-environment node
 *
 * Integration tests for the Team management API.
 * Tests team member listing, inviting, role management, removal,
 * password reset, ownership transfer, audit logs, and API keys.
 *
 * Endpoints tested:
 *   GET    /api/team                  list team members
 *   GET    /api/team/members          list members alias
 *   POST   /api/team/invite           invite user
 *   PUT    /api/team/:id/role         change user role
 *   DELETE /api/team/:id              remove user
 *   PUT    /api/team/members/:id      update member
 *   DELETE /api/team/members/:id      remove member alias
 *   POST   /api/team/:id/reset-password  reset user password
 *   POST   /api/team/transfer-ownership  transfer ownership
 *   GET    /api/team/audit-logs       get audit logs
 *   GET    /api/team/audit-logs/export  export audit logs
 *   GET    /api/team/api-keys         get API keys
 *   POST   /api/team/api-keys         create API key
 *   DELETE /api/team/api-keys/:id     revoke API key
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  business: {
    findUnique: jest.fn(),
  },
  auditLog: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  apiKey: {
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  activity: {
    create: jest.fn(),
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
    email: 'owner@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  }),
  hashPassword: jest.fn().mockResolvedValue('hashed_temp_password'),
  comparePassword: jest.fn(),
  generateToken: jest.fn().mockReturnValue('mock_jwt_token'),
  generateRefreshToken: jest.fn().mockReturnValue('mock_refresh_token'),
  getJwtSecret: jest.fn().mockReturnValue('test-secret'),
  encrypt: jest.fn().mockReturnValue('encrypted'),
  decrypt: jest.fn().mockReturnValue('decrypted'),
}));

// ── API key auth mock (hashApiKey used by team route) ────────────────────────
jest.mock('../src/server/middleware/api-key-auth', () => ({
  hashApiKey: jest.fn().mockReturnValue('mocked_hash_abc123'),
  authenticateApiKey: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  generateApiKey: jest.fn().mockReturnValue({ raw: 'bka_xxx', hash: 'hash', prefix: 'bka_xxx' }),
}));

// ── Plan limits middleware mock (checkUserLimit used by invite) ──────────────
jest.mock('../src/server/middleware/planLimits', () => ({
  checkUserLimit: jest.fn((_req: any, _res: any, next: any) => next()),
  checkContactLimit: jest.fn((_req: any, _res: any, next: any) => next()),
  checkMessageLimit: jest.fn((_req: any, _res: any, next: any) => next()),
  checkAICredits: jest.fn((_req: any, _res: any, next: any) => next()),
  getUsageStats: jest.fn(),
  PLAN_LIMITS: {},
  getPlanLimits: jest.fn(),
  isExempt: jest.fn().mockReturnValue(true),
}));

// ── Disable rate limiting ────────────────────────────────────────────────────
jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

// ── JSON Web Token mock ──────────────────────────────────────────────────────
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({
    id: 'user-1',
    email: 'owner@test.com',
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

// Keep crypto as-is (needed for temp password generation in route)
// jest.mock('crypto' ...

// Import router AFTER all mocks
import teamRoutes from '../src/server/routes/team';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockOwnerUser = {
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
  lastLoginAt: null,
  phone: '+1234567890',
  emailVerified: true,
  isVerified: false,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  avatar: null,
};

const mockMemberUser = {
  id: 'user-2',
  email: 'member@test.com',
  name: 'Team Member',
  password: 'hashed_password',
  role: 'MEMBER',
  businessId: 'biz-1',
  isActive: true,
  image: null,
  googleId: null,
  appleId: null,
  lastLoginAt: null,
  phone: '+9876543210',
  emailVerified: true,
  isVerified: false,
  createdAt: new Date('2025-01-02'),
  updatedAt: new Date('2025-01-02'),
  avatar: null,
};

const mockAdminUser = {
  id: 'user-3',
  email: 'admin@test.com',
  name: 'Admin User',
  password: 'hashed_password',
  role: 'ADMIN',
  businessId: 'biz-1',
  isActive: true,
  createdAt: new Date('2025-01-03'),
  updatedAt: new Date('2025-01-03'),
};

const mockAuditLog = {
  id: 'log-1',
  businessId: 'biz-1',
  userId: 'user-1',
  userEmail: 'owner@test.com',
  action: 'user.invite',
  description: { invited: 'member@test.com' },
  ipAddress: '127.0.0.1',
  createdAt: new Date('2025-01-01'),
};

const mockApiKey = {
  id: 'apikey-1',
  name: 'Test Key',
  prefix: 'bka_abc...',
  permissions: ['contacts:read'],
  lastUsedAt: null,
  expiresAt: null,
  isActive: true,
  createdAt: new Date('2025-01-01'),
  businessId: 'biz-1',
  keyHash: 'hashed_key',
  key: 'bka_full_key',
  createdBy: 'user-1',
};

const userSelectFields = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  avatar: true,
  createdAt: true,
  updatedAt: true,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/team', teamRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'user-1',
    email: 'owner@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  });

  mockPrisma.user.findUnique.mockResolvedValue(mockOwnerUser);

  const { CSRFService } = jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');
}

function setUserRole(role: string): void {
  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: role === 'OWNER' ? 'user-1' : 'user-member',
    email: `${role.toLowerCase()}@test.com`,
    businessId: 'biz-1',
    role,
  });
  mockPrisma.user.findUnique.mockResolvedValue({
    ...mockOwnerUser,
    id: role === 'OWNER' ? 'user-1' : 'user-member',
    role,
    email: `${role.toLowerCase()}@test.com`,
  });
}

// ─── GET /api/team — List team members ───────────────────────────────────────

describe('GET /api/team', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findMany.mockResolvedValue([
      { ...mockMemberUser, ...userSelectFields },
      { ...mockOwnerUser, ...userSelectFields },
    ]);
    mockPrisma.user.count.mockResolvedValue(2);
  });

  it('should list team members with pagination', async () => {
    const res = await request(app)
      .get('/api/team')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.users).toHaveLength(2);
    expect(res.body.data.pagination).toMatchObject({
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
    });

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: userSelectFields,
      }),
    );
  });

  it('should apply search filter', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ ...mockMemberUser, ...userSelectFields }]);
    mockPrisma.user.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/team?search=member&role=MEMBER&page=1&limit=10')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data.users).toHaveLength(1);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          role: 'MEMBER',
          OR: expect.arrayContaining([
            { email: { contains: 'member', mode: 'insensitive' } },
            { name: { contains: 'member', mode: 'insensitive' } },
          ]),
        }),
        skip: 0,
        take: 10,
      }),
    );
  });

  it('should handle empty team', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/team')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.users).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/team')
      .expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.user.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/team')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to list team members');
  });
});

// ─── GET /api/team/members — List members alias ──────────────────────────────

describe('GET /api/team/members', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findMany.mockResolvedValue([{ ...mockMemberUser, ...userSelectFields }]);
    mockPrisma.user.count.mockResolvedValue(1);
  });

  it('should list team members via /members alias', async () => {
    const res = await request(app)
      .get('/api/team/members')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.users).toHaveLength(1);
  });

  it('should return empty for user without businessId (non-admin)', async () => {
    // The authenticate middleware blocks non-SUPER_ADMIN users without
    // a businessId with a 403 error. This test validates that behavior.
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-no-biz',
      email: 'nobiz@test.com',
      businessId: null,
      role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      ...mockOwnerUser,
      id: 'user-no-biz',
      businessId: null,
      role: 'MEMBER',
      emailVerified: true,
    });

    const res = await request(app)
      .get('/api/team/members')
      .set('Authorization', 'Bearer valid_token')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('No business associated');
  });

  it('should allow SUPER_ADMIN to see all users', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'super-1',
      email: 'super@admin.com',
      businessId: null,
      role: 'SUPER_ADMIN',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      ...mockOwnerUser,
      id: 'super-1',
      businessId: null,
      role: 'SUPER_ADMIN',
      emailVerified: true,
    });
    mockPrisma.user.findMany.mockResolvedValue([
      { ...mockMemberUser, ...userSelectFields },
      { ...mockOwnerUser, ...userSelectFields },
    ]);
    mockPrisma.user.count.mockResolvedValue(2);

    const res = await request(app)
      .get('/api/team/members')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.users).toHaveLength(2);
    // SUPER_ADMIN should not filter by businessId
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ businessId: expect.anything() }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    mockPrisma.user.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/team/members')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to list team members');
  });
});

// ─── POST /api/team/invite — Invite user ─────────────────────────────────────

describe('POST /api/team/invite', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findFirst.mockResolvedValue(null); // no existing user
    mockPrisma.user.create.mockResolvedValue({
      id: 'new-user',
      email: 'newmember@test.com',
      name: 'New Member',
      role: 'MEMBER',
      isActive: true,
      createdAt: new Date(),
    });
  });

  it('should invite a new user successfully', async () => {
    const res = await request(app)
      .post('/api/team/invite')
      .set('Authorization', 'Bearer valid_token')
      .send({ email: 'newmember@test.com', name: 'New Member', role: 'MEMBER' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('tempPassword');
    expect(res.body.data.user).toMatchObject({
      email: 'newmember@test.com',
      role: 'MEMBER',
    });
    expect(res.body.data.message).toContain('Share temporary password');

    // Verify password was hashed
    const { hashPassword } = jest.requireMock('../src/server/utils/auth');
    expect(hashPassword).toHaveBeenCalled();

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'newmember@test.com',
          name: 'New Member',
          role: 'MEMBER',
          businessId: 'biz-1',
          isActive: true,
        }),
      }),
    );
  });

  it('should return 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/team/invite')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'No Email' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Email is required');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('should return 409 when user already exists in business', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(mockMemberUser);

    const res = await request(app)
      .post('/api/team/invite')
      .set('Authorization', 'Bearer valid_token')
      .send({ email: 'member@test.com', name: 'Existing Member' })
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('User already exists in your business');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('should default role to MEMBER when not provided', async () => {
    await request(app)
      .post('/api/team/invite')
      .set('Authorization', 'Bearer valid_token')
      .send({ email: 'newmember@test.com', name: 'Default Role' })
      .expect(201);

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'MEMBER',
        }),
      }),
    );
  });

  it('should default name from email when not provided', async () => {
    await request(app)
      .post('/api/team/invite')
      .set('Authorization', 'Bearer valid_token')
      .send({ email: 'username@test.com' })
      .expect(201);

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'username',
        }),
      }),
    );
  });

  it('should return 403 for MEMBER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .post('/api/team/invite')
      .set('Authorization', 'Bearer member_token')
      .send({ email: 'new@test.com', name: 'Test' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('should return 500 on creation failure', async () => {
    mockPrisma.user.create.mockRejectedValue(new Error('Creation failed'));

    const res = await request(app)
      .post('/api/team/invite')
      .set('Authorization', 'Bearer valid_token')
      .send({ email: 'new@test.com', name: 'Test' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to invite user');
  });
});

// ─── PUT /api/team/:id/role — Change user role ───────────────────────────────

describe('PUT /api/team/:id/role', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockMemberUser);
    mockPrisma.user.update.mockResolvedValue({
      ...mockMemberUser,
      role: 'ADMIN',
    });
  });

  it('should change user role', async () => {
    const res = await request(app)
      .put('/api/team/user-2/role')
      .set('Authorization', 'Bearer valid_token')
      .send({ role: 'ADMIN' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('ADMIN');
    expect(res.body.message).toBe('User role updated to ADMIN');

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-2', businessId: 'biz-1' },
        data: { role: 'ADMIN' },
      }),
    );
  });

  it('should return 400 for invalid role', async () => {
    const res = await request(app)
      .put('/api/team/user-2/role')
      .set('Authorization', 'Bearer valid_token')
      .send({ role: 'INVALID_ROLE' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Invalid role');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('should return 400 when role is missing', async () => {
    const res = await request(app)
      .put('/api/team/user-2/role')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Invalid role');
  });

  it('should return 404 when user not found in business', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/team/non-existent/role')
      .set('Authorization', 'Bearer valid_token')
      .send({ role: 'ADMIN' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('User not found in your business');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('should return 403 when non-OWNER tries to assign OWNER role', async () => {
    setUserRole('ADMIN');

    const res = await request(app)
      .put('/api/team/user-2/role')
      .set('Authorization', 'Bearer admin_token')
      .send({ role: 'OWNER' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Only current owner can assign owner role');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('should return 403 for MEMBER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .put('/api/team/user-2/role')
      .set('Authorization', 'Bearer member_token')
      .send({ role: 'ADMIN' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
  });

  it('should return 500 when update fails', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(mockMemberUser);
    mockPrisma.user.update.mockRejectedValue(new Error('Update failed'));

    const res = await request(app)
      .put('/api/team/user-2/role')
      .set('Authorization', 'Bearer valid_token')
      .send({ role: 'ADMIN' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to update role');
  });
});

// ─── DELETE /api/team/:id — Remove user ──────────────────────────────────────

describe('DELETE /api/team/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockMemberUser);
    mockPrisma.user.count.mockResolvedValue(2); // multiple owners
    mockPrisma.user.delete.mockResolvedValue(mockMemberUser);
  });

  it('should remove a team member', async () => {
    const res = await request(app)
      .delete('/api/team/user-2')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('User removed successfully');
    expect(mockPrisma.user.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-2', businessId: 'biz-1' } }),
    );
  });

  it('should return 404 when user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/team/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('User not found in your business');
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('should prevent removing the last OWNER', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ ...mockOwnerUser, role: 'OWNER' });
    mockPrisma.user.count.mockResolvedValue(1); // only one owner

    const res = await request(app)
      .delete('/api/team/user-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Cannot remove last owner. Transfer ownership first.');
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('should prevent self-deletion', async () => {
    // Override findFirst to return the OWNER user (same id as authenticated user)
    mockPrisma.user.findFirst.mockResolvedValue(mockOwnerUser);

    const res = await request(app)
      .delete('/api/team/user-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('You cannot remove yourself');
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('should return 403 for MEMBER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .delete('/api/team/user-2')
      .set('Authorization', 'Bearer member_token')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('should allow removing an OWNER when there are multiple', async () => {
    // Return a different owner (not the authenticated user) to avoid self-deletion
    const differentOwner = { ...mockOwnerUser, id: 'user-99', email: 'other-owner@test.com' };
    mockPrisma.user.findFirst.mockResolvedValue({ ...differentOwner, role: 'OWNER' });
    mockPrisma.user.count.mockResolvedValue(2); // multiple owners
    mockPrisma.user.delete.mockResolvedValue(differentOwner);

    const res = await request(app)
      .delete('/api/team/user-99')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.user.delete).toHaveBeenCalled();
  });

  it('should return 500 when deletion fails', async () => {
    mockPrisma.user.delete.mockRejectedValue(new Error('Delete failed'));

    const res = await request(app)
      .delete('/api/team/user-2')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to remove user');
  });
});

// ─── PUT /api/team/members/:id — Update member ───────────────────────────────

describe('PUT /api/team/members/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockMemberUser);
    mockPrisma.user.update.mockResolvedValue({
      ...mockMemberUser,
      name: 'Updated Name',
      phone: '+1111111111',
    });
    mockPrisma.user.count.mockResolvedValue(2);
  });

  it('should update team member details', async () => {
    const res = await request(app)
      .put('/api/team/members/user-2')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated Name', phone: '+1111111111', isActive: false })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'Updated Name',
      phone: '+1111111111',
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-2', businessId: 'biz-1' },
        data: expect.objectContaining({ name: 'Updated Name', phone: '+1111111111', isActive: false }),
      }),
    );
  });

  it('should return 404 when user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/team/members/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Ghost' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('User not found');
  });

  it('should prevent non-OWNER from assigning OWNER role', async () => {
    setUserRole('ADMIN');

    const res = await request(app)
      .put('/api/team/members/user-2')
      .set('Authorization', 'Bearer admin_token')
      .send({ role: 'OWNER' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Only the current owner can assign the owner role');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('should prevent demoting the last OWNER', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ ...mockOwnerUser, role: 'OWNER' });
    mockPrisma.user.count.mockResolvedValue(1); // only one owner

    const res = await request(app)
      .put('/api/team/members/user-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ role: 'ADMIN' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Cannot remove the last owner. Assign another owner first.');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('should return 500 on error', async () => {
    mockPrisma.user.update.mockRejectedValue(new Error('Update failed'));

    const res = await request(app)
      .put('/api/team/members/user-2')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to update team member');
  });
});

// ─── DELETE /api/team/members/:id — Remove member alias ──────────────────────

describe('DELETE /api/team/members/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockMemberUser);
    mockPrisma.user.delete.mockResolvedValue(mockMemberUser);
  });

  it('should remove a team member via /members alias', async () => {
    const res = await request(app)
      .delete('/api/team/members/user-2')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Team member removed successfully');
  });

  it('should return 404 when user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/team/members/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('User not found');
  });

  it('should prevent removing an OWNER via /members', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ ...mockOwnerUser, role: 'OWNER' });

    const res = await request(app)
      .delete('/api/team/members/user-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Cannot remove business owner');
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('should return 500 on error', async () => {
    mockPrisma.user.delete.mockRejectedValue(new Error('Delete failed'));

    const res = await request(app)
      .delete('/api/team/members/user-2')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to remove team member');
  });
});

// ─── POST /api/team/:id/reset-password — Reset password ──────────────────────

describe('POST /api/team/:id/reset-password', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockMemberUser);
    mockPrisma.user.update.mockResolvedValue(mockMemberUser);
  });

  it('should reset user password', async () => {
    const res = await request(app)
      .post('/api/team/user-2/reset-password')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('tempPassword');
    expect(res.body.message).toBe('Password reset successfully');

    const { hashPassword } = jest.requireMock('../src/server/utils/auth');
    expect(hashPassword).toHaveBeenCalled();

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-2', businessId: 'biz-1' },
        data: expect.objectContaining({ password: 'hashed_temp_password' }),
      }),
    );
  });

  it('should return 404 when user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/team/non-existent/reset-password')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('User not found');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('should return 403 for MEMBER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .post('/api/team/user-2/reset-password')
      .set('Authorization', 'Bearer member_token')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
  });

  it('should return 500 on error', async () => {
    mockPrisma.user.update.mockRejectedValue(new Error('Update failed'));

    const res = await request(app)
      .post('/api/team/user-2/reset-password')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to reset password');
  });
});

// ─── POST /api/team/transfer-ownership — Transfer ownership ──────────────────

describe('POST /api/team/transfer-ownership', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockMemberUser);
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
    mockPrisma.user.update.mockResolvedValue(mockMemberUser);
  });

  it('should transfer ownership to another user', async () => {
    const res = await request(app)
      .post('/api/team/transfer-ownership')
      .set('Authorization', 'Bearer valid_token')
      .send({ newOwnerId: 'user-2' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Ownership transferred');

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    // Verify current owner demoted to ADMIN
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: { role: 'ADMIN' } }),
    );
    // Verify new owner promoted to OWNER
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-2' }, data: { role: 'OWNER' } }),
    );
  });

  it('should return 400 when newOwnerId is missing', async () => {
    const res = await request(app)
      .post('/api/team/transfer-ownership')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('New owner ID is required');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('should return 404 when new owner not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/team/transfer-ownership')
      .set('Authorization', 'Bearer valid_token')
      .send({ newOwnerId: 'non-existent' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('User not found in your business');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('should return 403 for non-OWNER', async () => {
    setUserRole('ADMIN');

    const res = await request(app)
      .post('/api/team/transfer-ownership')
      .set('Authorization', 'Bearer admin_token')
      .send({ newOwnerId: 'user-2' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('should return 500 on transaction failure', async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error('Transaction failed'));

    const res = await request(app)
      .post('/api/team/transfer-ownership')
      .set('Authorization', 'Bearer valid_token')
      .send({ newOwnerId: 'user-2' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to transfer ownership');
  });
});

// ─── GET /api/team/audit-logs — Get audit logs ───────────────────────────────

describe('GET /api/team/audit-logs', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.auditLog.findMany.mockResolvedValue([mockAuditLog]);
    mockPrisma.auditLog.count.mockResolvedValue(1);
  });

  it('should list audit logs with pagination', async () => {
    const res = await request(app)
      .get('/api/team/audit-logs')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.logs).toHaveLength(1);
    expect(res.body.data.pagination).toMatchObject({
      page: 1,
      limit: 50,
      total: 1,
    });

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        skip: 0,
        take: 50,
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('should filter by userId and action', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/team/audit-logs?userId=user-1&action=user.invite')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data.logs).toEqual([]);
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          userId: 'user-1',
          action: 'user.invite',
        }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    mockPrisma.auditLog.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/team/audit-logs')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to fetch audit logs');
  });
});

// ─── GET /api/team/audit-logs/export — Export audit logs ─────────────────────

describe('GET /api/team/audit-logs/export', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.auditLog.findMany.mockResolvedValue([mockAuditLog]);
  });

  it('should export audit logs as CSV', async () => {
    const res = await request(app)
      .get('/api/team/audit-logs/export')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    // Content type should be csv
    expect(res.headers['content-type'] || '').toContain('csv');
    expect(res.headers['content-disposition'] || '').toContain('attachment; filename="audit-logs-');
    expect(res.text).toContain('Date,User,Action,Details,IP Address');
    expect(res.text).toContain('owner@test.com');
    expect(res.text).toContain('user.invite');
  });

  it('should return JSON when format is not csv', async () => {
    const res = await request(app)
      .get('/api/team/audit-logs/export?format=json')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('should filter by date range', async () => {
    await request(app)
      .get('/api/team/audit-logs/export?startDate=2025-01-01&endDate=2025-01-31')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      }),
    );
  });

  it('should include business relation in export', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([{
      ...mockAuditLog,
      business: { id: 'biz-1', name: 'Test Business' },
    }]);

    await request(app)
      .get('/api/team/audit-logs/export')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          business: expect.objectContaining({ select: { id: true, name: true } }),
        }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    mockPrisma.auditLog.findMany.mockRejectedValue(new Error('Export failed'));

    const res = await request(app)
      .get('/api/team/audit-logs/export')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to export audit logs');
  });
});

// ─── GET /api/team/api-keys — List API keys ──────────────────────────────────

describe('GET /api/team/api-keys', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.apiKey.findMany.mockResolvedValue([mockApiKey]);
  });

  it('should list API keys', async () => {
    const res = await request(app)
      .get('/api/team/api-keys')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      name: 'Test Key',
      prefix: 'bka_abc...',
      permissions: ['contacts:read'],
    });

    // The route selects specific fields (no key, no keyHash in the Prisma select)
    expect(mockPrisma.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        orderBy: { createdAt: 'desc' },
        select: expect.objectContaining({
          id: true,
          name: true,
          prefix: true,
        }),
      }),
    );
  });

  it('should return empty array when no keys exist', async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/team/api-keys')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data).toEqual([]);
  });

  it('should return 500 on error', async () => {
    mockPrisma.apiKey.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/team/api-keys')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to fetch API keys');
  });
});

// ─── POST /api/team/api-keys — Create API key ────────────────────────────────

describe('POST /api/team/api-keys', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.apiKey.create.mockResolvedValue({
      ...mockApiKey,
      key: 'bka_full_key',
    });
  });

  it('should create an API key', async () => {
    const res = await request(app)
      .post('/api/team/api-keys')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'New Key', permissions: ['contacts:read', 'contacts:write'] })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('key');
    expect(res.body.data.name).toBe('Test Key');

    const { hashApiKey } = jest.requireMock('../src/server/middleware/api-key-auth');
    expect(hashApiKey).toHaveBeenCalled();

    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'New Key',
          permissions: ['contacts:read', 'contacts:write'],
          isActive: true,
          createdBy: 'user-1',
        }),
      }),
    );
  });

  it('should return 400 when name or permissions missing', async () => {
    const res1 = await request(app)
      .post('/api/team/api-keys')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Key without permissions' })
      .expect(400);
    expect(res1.body.error).toBe('Name and permissions array are required');

    const res2 = await request(app)
      .post('/api/team/api-keys')
      .set('Authorization', 'Bearer valid_token')
      .send({ permissions: ['read'] })
      .expect(400);
    expect(res2.body.error).toBe('Name and permissions array are required');

    const res3 = await request(app)
      .post('/api/team/api-keys')
      .set('Authorization', 'Bearer valid_token')
      .send({ permissions: 'not-an-array' })
      .expect(400);
    expect(res3.body.error).toBe('Name and permissions array are required');

    expect(mockPrisma.apiKey.create).not.toHaveBeenCalled();
  });

  it('should set expiration when expiresIn is provided', async () => {
    await request(app)
      .post('/api/team/api-keys')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Temp Key', permissions: ['read'], expiresIn: 3600 })
      .expect(201);

    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expiresAt: expect.any(Date),
        }),
      }),
    );
  });

  it('should return 403 for MEMBER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .post('/api/team/api-keys')
      .set('Authorization', 'Bearer member_token')
      .send({ name: 'Key', permissions: ['read'] })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
    expect(mockPrisma.apiKey.create).not.toHaveBeenCalled();
  });

  it('should return 500 on error', async () => {
    mockPrisma.apiKey.create.mockRejectedValue(new Error('Creation failed'));

    const res = await request(app)
      .post('/api/team/api-keys')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Key', permissions: ['read'] })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to create API key');
  });
});

// ─── DELETE /api/team/api-keys/:id — Revoke API key ──────────────────────────

describe('DELETE /api/team/api-keys/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.apiKey.delete.mockResolvedValue(mockApiKey);
  });

  it('should revoke an API key', async () => {
    const res = await request(app)
      .delete('/api/team/api-keys/apikey-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('API key revoked successfully');

    expect(mockPrisma.apiKey.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'apikey-1', businessId: 'biz-1' },
      }),
    );
  });

  it('should return 403 for MEMBER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .delete('/api/team/api-keys/apikey-1')
      .set('Authorization', 'Bearer member_token')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
    expect(mockPrisma.apiKey.delete).not.toHaveBeenCalled();
  });

  it('should return 500 on error', async () => {
    mockPrisma.apiKey.delete.mockRejectedValue(new Error('Deletion failed'));

    const res = await request(app)
      .delete('/api/team/api-keys/apikey-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to revoke API key');
  });
});
