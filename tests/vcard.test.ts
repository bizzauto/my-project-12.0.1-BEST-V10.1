/**
 * @jest-environment node
 *
 * Integration tests for the vCard API.
 * Tests CRUD operations, public view, view/share tracking, and statistics.
 *
 * Endpoints tested:
 *   GET    /api/vcard              list all vCards for business
 *   POST   /api/vcard              create new vCard
 *   PUT    /api/vcard/:id          update vCard
 *   DELETE /api/vcard/:id          delete vCard
 *   POST   /api/vcard/:id/view     track view
 *   POST   /api/vcard/:id/share    track share
 *   GET    /api/vcard/public/:id   public vCard view (no auth)
 *   GET    /api/vcard/stats        vCard statistics
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────

// ── Prisma mock ──────────────────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  vCards: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
}));

// ── Auth utilities mock ──────────────────────────────────────────────────
jest.mock('../src/server/utils/auth', () => ({
  verifyToken: jest.fn().mockResolvedValue({
    id: 'user-1',
    email: 'test@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  }),
  hashPassword: jest.fn().mockResolvedValue('hashed_password'),
  comparePassword: jest.fn(),
  generateToken: jest.fn().mockReturnValue('mock_jwt_token'),
  generateRefreshToken: jest.fn().mockReturnValue('mock_refresh_token'),
  getJwtSecret: jest.fn().mockReturnValue('test-secret'),
  encrypt: jest.fn().mockReturnValue('encrypted'),
  decrypt: jest.fn().mockReturnValue('decrypted'),
}));

// ── Disable rate limiting for tests ──────────────────────────────
jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

// ── JSON Web Token mock ──────────────────────────────────────────────────
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

// ── CSRF Service mock ────────────────────────────────────────────────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── Cache middleware mock ────────────────────────────────────────────
jest.mock('../src/server/middleware/cache', () => ({
  cacheResponse: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// ── Auth middleware mock ──────────────────────────────────
jest.mock('../src/server/middleware/auth', () => ({
  authenticate: jest.fn((req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    req.user = { id: 'user-1', businessId: 'biz-1', role: 'OWNER' };
    next();
  }),
  AuthRequest: class AuthRequest extends Request {},
}));

// Import the router AFTER all mocks are set up
import vCardRoutes from '../src/server/routes/vcard';

// ─── Fixtures ────────────────────────────────────────────────────

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  businessId: 'biz-1',
  role: 'OWNER',
  isActive: true,
  emailVerified: true,
};

const mockVCard = {
  id: 'vcard-1',
  businessId: 'biz-1',
  name: 'John Doe',
  title: 'CEO',
  company: 'Acme Inc',
  phone: '+1234567890',
  email: 'john@acme.com',
  website: 'https://acme.com',
  address: '123 Main St',
  template: 'professional',
  color: '#2563eb',
  socialLinks: [{ platform: 'linkedin', url: 'https://linkedin.com/in/johndoe' }],
  status: 'active',
  views: 10,
  shares: 5,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockVCards = [
  mockVCard,
  {
    ...mockVCard,
    id: 'vcard-2',
    name: 'Jane Smith',
    title: 'CTO',
    status: 'inactive',
    views: 5,
    shares: 2,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/vcard', vCardRoutes);
  return app;
}

// Token used for routes that require auth (routes are mocked to pass)
const AUTH_TOKEN = 'Bearer valid_token';
const UNAUTH_TOKEN = 'Bearer invalid_unauth';

function resetMocks(): void {
  jest.clearAllMocks();

  mockPrisma.user.findUnique.mockResolvedValue(mockUser);

  const { CSRFService } = jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');
}

// ═══════════════════════════════════════════════════════════════════
//  GET /api/vcard — List vCards
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/vcard', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should list all vCards for business', async () => {
    mockPrisma.vCards.findMany.mockResolvedValue(mockVCards);

    const res = await request(app)
      .get('/api/vcard')
      .set('Authorization', AUTH_TOKEN)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.cards).toHaveLength(2);
    expect(res.body.data.cards[0]).toMatchObject({
      id: 'vcard-1',
      name: 'John Doe',
      title: 'CEO',
    });
    expect(mockPrisma.vCards.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('should return empty array when no vCards exist', async () => {
    mockPrisma.vCards.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/vcard')
      .set('Authorization', AUTH_TOKEN)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.cards).toEqual([]);
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/vcard')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.vCards.findMany.mockRejectedValue(new Error('DB connection lost'));

    const res = await request(app)
      .get('/api/vcard')
      .set('Authorization', AUTH_TOKEN)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch vCards');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  POST /api/vcard — Create vCard
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/vcard', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  const validPayload = {
    name: 'New Card',
    title: 'Manager',
    company: 'New Corp',
    phone: '+1987654321',
    email: 'new@corp.com',
    website: 'https://newcorp.com',
    address: '456 Oak Ave',
    template: 'modern',
    color: '#dc2626',
    socialLinks: [{ platform: 'twitter', url: 'https://twitter.com/newcorp' }],
  };

  it('should create vCard successfully with all fields', async () => {
    mockPrisma.vCards.create.mockResolvedValue({
      ...mockVCard,
      id: 'vcard-new',
      ...validPayload,
    });

    const res = await request(app)
      .post('/api/vcard')
      .set('Authorization', AUTH_TOKEN)
      .send(validPayload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.card).toMatchObject({
      name: 'New Card',
      title: 'Manager',
      company: 'New Corp',
    });
    expect(mockPrisma.vCards.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          name: 'New Card',
          title: 'Manager',
          company: 'New Corp',
          phone: '+1987654321',
          email: 'new@corp.com',
          website: 'https://newcorp.com',
          address: '456 Oak Ave',
          template: 'modern',
          color: '#dc2626',
          socialLinks: [{ platform: 'twitter', url: 'https://twitter.com/newcorp' }],
        }),
      }),
    );
  });

  it('should create vCard with only required name field (defaults for others)', async () => {
    mockPrisma.vCards.create.mockResolvedValue({
      ...mockVCard,
      id: 'vcard-minimal',
      name: 'Minimal Card',
      title: '',
      company: '',
      phone: '',
      email: '',
      website: '',
      address: '',
      template: 'professional',
      color: '#2563eb',
      socialLinks: [],
    });

    const res = await request(app)
      .post('/api/vcard')
      .set('Authorization', AUTH_TOKEN)
      .send({ name: 'Minimal Card' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.card.name).toBe('Minimal Card');
    expect(mockPrisma.vCards.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          name: 'Minimal Card',
          title: '',
          company: '',
          phone: '',
          email: '',
          website: '',
          address: '',
          template: 'professional',
          color: '#2563eb',
          socialLinks: [],
        }),
      }),
    );
  });

  it('should reject creation with missing name field', async () => {
    const res = await request(app)
      .post('/api/vcard')
      .set('Authorization', AUTH_TOKEN)
      .send({ title: 'No Name' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Name is required');
    expect(mockPrisma.vCards.create).not.toHaveBeenCalled();
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .post('/api/vcard')
      .send(validPayload)
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database create fails', async () => {
    mockPrisma.vCards.create.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/vcard')
      .set('Authorization', AUTH_TOKEN)
      .send(validPayload)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to create vCard');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  PUT /api/vcard/:id — Update vCard
// ═══════════════════════════════════════════════════════════════════

describe('PUT /api/vcard/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should update vCard successfully', async () => {
    mockPrisma.vCards.findFirst.mockResolvedValue(mockVCard);
    mockPrisma.vCards.update.mockResolvedValue({
      ...mockVCard,
      name: 'Updated Name',
      title: 'Senior Manager',
    });

    const res = await request(app)
      .put('/api/vcard/vcard-1')
      .set('Authorization', AUTH_TOKEN)
      .send({ name: 'Updated Name', title: 'Senior Manager' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.card.name).toBe('Updated Name');
    expect(res.body.data.card.title).toBe('Senior Manager');
    expect(mockPrisma.vCards.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vcard-1', businessId: 'biz-1' },
      }),
    );
    expect(mockPrisma.vCards.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vcard-1' },
        data: expect.objectContaining({
          name: 'Updated Name',
          title: 'Senior Manager',
        }),
      }),
    );
  });

  it('should update only provided fields (partial update)', async () => {
    mockPrisma.vCards.findFirst.mockResolvedValue(mockVCard);
    mockPrisma.vCards.update.mockResolvedValue({
      ...mockVCard,
      status: 'inactive',
    });

    const res = await request(app)
      .put('/api/vcard/vcard-1')
      .set('Authorization', AUTH_TOKEN)
      .send({ status: 'inactive' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.card.status).toBe('inactive');
    expect(mockPrisma.vCards.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'inactive' }),
      }),
    );
  });

  it('should return 404 for non-existent vCard', async () => {
    mockPrisma.vCards.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/vcard/non-existent')
      .set('Authorization', AUTH_TOKEN)
      .send({ name: 'Test' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('vCard not found');
    expect(mockPrisma.vCards.update).not.toHaveBeenCalled();
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .put('/api/vcard/vcard-1')
      .send({ name: 'Test' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database update fails', async () => {
    mockPrisma.vCards.findFirst.mockResolvedValue(mockVCard);
    mockPrisma.vCards.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .put('/api/vcard/vcard-1')
      .set('Authorization', AUTH_TOKEN)
      .send({ name: 'Test' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to update vCard');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  DELETE /api/vcard/:id — Delete vCard
// ═══════════════════════════════════════════════════════════════════

describe('DELETE /api/vcard/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should delete vCard successfully', async () => {
    mockPrisma.vCards.findFirst.mockResolvedValue(mockVCard);
    mockPrisma.vCards.delete.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/vcard/vcard-1')
      .set('Authorization', AUTH_TOKEN)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('vCard deleted');
    expect(mockPrisma.vCards.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vcard-1', businessId: 'biz-1' },
      }),
    );
    expect(mockPrisma.vCards.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'vcard-1' } }),
    );
  });

  it('should return 404 for non-existent vCard', async () => {
    mockPrisma.vCards.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/vcard/non-existent')
      .set('Authorization', AUTH_TOKEN)
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('vCard not found');
    expect(mockPrisma.vCards.delete).not.toHaveBeenCalled();
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .delete('/api/vcard/vcard-1')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database delete fails', async () => {
    mockPrisma.vCards.findFirst.mockResolvedValue(mockVCard);
    mockPrisma.vCards.delete.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/api/vcard/vcard-1')
      .set('Authorization', AUTH_TOKEN)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to delete vCard');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  POST /api/vcard/:id/view — Track view
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/vcard/:id/view', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should track view successfully', async () => {
    mockPrisma.vCards.update.mockResolvedValue({ ...mockVCard, views: 11 });

    const res = await request(app)
      .post('/api/vcard/vcard-1/view')
      .set('Authorization', AUTH_TOKEN)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.vCards.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vcard-1' },
        data: { views: { increment: 1 } },
      }),
    );
  });

  it('should return 500 when database update fails', async () => {
    mockPrisma.vCards.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/vcard/vcard-1/view')
      .set('Authorization', AUTH_TOKEN)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to track view');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  POST /api/vcard/:id/share — Track share
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/vcard/:id/share', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should track share successfully', async () => {
    mockPrisma.vCards.update.mockResolvedValue({ ...mockVCard, shares: 6 });

    const res = await request(app)
      .post('/api/vcard/vcard-1/share')
      .set('Authorization', AUTH_TOKEN)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.vCards.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vcard-1' },
        data: { shares: { increment: 1 } },
      }),
    );
  });

  it('should return 500 when database update fails', async () => {
    mockPrisma.vCards.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/vcard/vcard-1/share')
      .set('Authorization', AUTH_TOKEN)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to track share');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  GET /api/vcard/public/:id — Public vCard view (no auth)
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/vcard/public/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
  });

  it('should return public vCard and increment views', async () => {
    mockPrisma.vCards.findUnique.mockResolvedValue(mockVCard);
    mockPrisma.vCards.update.mockResolvedValue({ ...mockVCard, views: 11 });

    const res = await request(app)
      .get('/api/vcard/public/vcard-1')
      .set('Authorization', AUTH_TOKEN)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.card).toMatchObject({
      id: 'vcard-1',
      name: 'John Doe',
      title: 'CEO',
    });
    expect(mockPrisma.vCards.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'vcard-1' } }),
    );
    expect(mockPrisma.vCards.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vcard-1' },
        data: { views: { increment: 1 } },
      }),
    );
  });

  it('should return 404 for non-existent vCard', async () => {
    mockPrisma.vCards.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/vcard/public/non-existent')
      .set('Authorization', AUTH_TOKEN)
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('vCard not found');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.vCards.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/vcard/public/vcard-1')
      .set('Authorization', AUTH_TOKEN)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch vCard');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  GET /api/vcard/stats — vCard statistics
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/vcard/stats', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should return vCard statistics', async () => {
    mockPrisma.vCards.findMany.mockResolvedValue(mockVCards);

    const res = await request(app)
      .get('/api/vcard/stats')
      .set('Authorization', AUTH_TOKEN)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      total: 2,
      active: 1,
      totalViews: 15,
      totalShares: 7,
    });
    expect(mockPrisma.vCards.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'biz-1' } }),
    );
  });

  it('should return zero stats when no vCards exist', async () => {
    mockPrisma.vCards.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/vcard/stats')
      .set('Authorization', AUTH_TOKEN)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      total: 0,
      active: 0,
      totalViews: 0,
      totalShares: 0,
    });
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/vcard/stats')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.vCards.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/vcard/stats')
      .set('Authorization', AUTH_TOKEN)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch stats');
  });
});