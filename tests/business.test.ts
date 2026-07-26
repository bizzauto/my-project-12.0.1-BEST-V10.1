/**
 * @jest-environment node
 *
 * Integration tests for the Business settings API.
 * Tests the settings CRUD endpoints, WhatsApp config, social media config,
 * and pipeline management.
 *
 * Endpoints tested:
 *   GET    /api/business             get business settings
 *   PUT    /api/business             update business settings
 *   GET    /api/business/settings    alias for frontend
 *   PUT    /api/business/settings    alias for frontend
 *   PUT    /api/business/whatsapp    update WhatsApp config (OWNER only)
 *   PUT    /api/business/social-media  update social media tokens (OWNER only)
 *   GET    /api/business/pipelines   list pipelines
 *   POST   /api/business/pipelines   create pipeline
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  business: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  pipeline: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
}));

// ── Auth utilities mock (verifyToken used by authenticate middleware) ─────────
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
  encrypt: jest.fn().mockImplementation((text: string) => `enc:${text}`),
  decrypt: jest.fn().mockImplementation((text: string) => text.replace('enc:', '')),
}));

// ── Secrets service mock ─────────────────────────────────────────────────────
jest.mock('../src/server/services/secrets.service', () => ({
  encryptBusinessData: jest.fn((data: any) => ({ ...data, _encrypted: true })),
  decryptBusinessData: jest.fn((data: any) => ({ ...data, _decrypted: true })),
  encryptField: jest.fn((v: string) => `enc:${v}`),
  decryptField: jest.fn((v: string) => v?.replace('enc:', '')),
  maskBusinessSecrets: jest.fn((data: any) => ({ ...data, _masked: true })),
}));

// ── Disable rate limiting for tests ──────────────────────────────────────────
jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

// ── JSON Web Token mock (used by authenticate middleware) ────────────────────
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
import businessRoutes from '../src/server/routes/business';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  businessId: 'biz-1',
  role: 'OWNER',
  isActive: true,
  emailVerified: true,
};

const mockBusiness = {
  id: 'biz-1',
  name: 'Test Business',
  type: 'general',
  plan: 'FREE',
  planStartedAt: new Date('2025-01-01'),
  planExpiresAt: new Date('2025-01-15'),
  phone: '+1234567890',
  city: 'Test City',
  email: 'biz@test.com',
  brandColors: null,
  timezone: 'UTC',
  aiCreditsUsed: 0,
  aiCreditsLimit: 100,
  totalContacts: 0,
  wabaId: null,
  waPhoneNumberId: null,
  waAccessToken: null,
  waWebhookSecret: null,
  waPhoneNumber: null,
  fbPageId: null,
  fbAccessToken: null,
  igUserId: null,
  igAccessToken: null,
};

const mockPipeline = {
  id: 'pipeline-1',
  businessId: 'biz-1',
  name: 'Sales Pipeline',
  stages: ['Lead', 'Qualified', 'Proposal', 'Closed'],
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/business', businessRoutes);
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

  const { CSRFService } = jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');
}

function setUserRole(role: string): void {
  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'user-1',
    email: 'test@test.com',
    businessId: 'biz-1',
    role,
  });
  mockPrisma.user.findUnique.mockResolvedValue({
    ...mockUser,
    role,
  });
}

// ─── GET /api/business ───────────────────────────────────────────────────────

describe('GET /api/business', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.business.findUnique.mockResolvedValue(mockBusiness);
  });

  it('should return business settings', async () => {
    const res = await request(app)
      .get('/api/business')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'Test Business',
      type: 'general',
      plan: 'FREE',
    });
    // Verify decryptBusinessData was called
    const { decryptBusinessData } = jest.requireMock('../src/server/services/secrets.service');
    expect(decryptBusinessData).toHaveBeenCalled();
  });

  it('should return 404 when business not found', async () => {
    mockPrisma.business.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/business')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Business not found');
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/business')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.business.findUnique.mockRejectedValue(new Error('DB connection error'));

    const res = await request(app)
      .get('/api/business')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to fetch business');
  });
});

// ─── PUT /api/business ───────────────────────────────────────────────────────

describe('PUT /api/business', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.business.update.mockResolvedValue({
      ...mockBusiness,
      name: 'Updated Business',
    });
  });

  it('should update business settings', async () => {
    const res = await request(app)
      .put('/api/business')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated Business', city: 'New City', timezone: 'America/New_York' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'Updated Business',
    });

    // Verify encryptBusinessData was called
    const { encryptBusinessData } = jest.requireMock('../src/server/services/secrets.service');
    expect(encryptBusinessData).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Updated Business', city: 'New City', timezone: 'America/New_York' }),
    );

    expect(mockPrisma.business.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'biz-1' },
        data: expect.objectContaining({ _encrypted: true }),
      }),
    );
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .put('/api/business')
      .send({ name: 'Updated' })
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 when update fails', async () => {
    mockPrisma.business.update.mockRejectedValue(new Error('Update failed'));

    const res = await request(app)
      .put('/api/business')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated Business' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to update business');
  });
});

// ─── GET /api/business/settings ──────────────────────────────────────────────

describe('GET /api/business/settings', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.business.findUnique.mockResolvedValue(mockBusiness);
  });

  it('should return business settings via alias', async () => {
    const res = await request(app)
      .get('/api/business/settings')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'Test Business',
    });
  });

  it('should return 404 when business not found', async () => {
    mockPrisma.business.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/business/settings')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Business not found');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/business/settings')
      .expect(401);

    expect(res.body.success).toBe(false);
  });
});

// ─── PUT /api/business/settings ──────────────────────────────────────────────

describe('PUT /api/business/settings', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.business.update.mockResolvedValue({
      ...mockBusiness,
      name: 'Updated Via Alias',
    });
  });

  it('should update business settings via alias', async () => {
    const res = await request(app)
      .put('/api/business/settings')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated Via Alias', brandColors: { primary: '#000' } })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated Via Alias');

    const { encryptBusinessData } = jest.requireMock('../src/server/services/secrets.service');
    expect(encryptBusinessData).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Updated Via Alias', brandColors: { primary: '#000' } }),
    );
  });

  it('should return 500 when update fails', async () => {
    mockPrisma.business.update.mockRejectedValue(new Error('Update failed'));

    const res = await request(app)
      .put('/api/business/settings')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to update business settings');
  });
});

// ─── PUT /api/business/whatsapp ──────────────────────────────────────────────

describe('PUT /api/business/whatsapp', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.business.update.mockResolvedValue(mockBusiness);
  });

  it('should update WhatsApp configuration', async () => {
    const res = await request(app)
      .put('/api/business/whatsapp')
      .set('Authorization', 'Bearer valid_token')
      .send({
        wabaId: 'waba-123',
        waPhoneNumberId: 'pn-456',
        waAccessToken: 'secret-token',
        waWebhookSecret: 'wh-secret',
        waPhoneNumber: '+1234567890',
      })
      .expect(200);

    expect(res.body.success).toBe(true);

    const { encryptBusinessData } = jest.requireMock('../src/server/services/secrets.service');
    expect(encryptBusinessData).toHaveBeenCalledWith(
      expect.objectContaining({
        wabaId: 'waba-123',
        waPhoneNumberId: 'pn-456',
        waAccessToken: 'secret-token',
      }),
    );
  });

  it('should return 403 for non-OWNER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .put('/api/business/whatsapp')
      .set('Authorization', 'Bearer member_token')
      .send({ wabaId: 'waba-123' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Only business owners can perform this action');
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .put('/api/business/whatsapp')
      .send({ wabaId: 'waba-123' })
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 when update fails', async () => {
    mockPrisma.business.update.mockRejectedValue(new Error('WhatsApp update failed'));

    const res = await request(app)
      .put('/api/business/whatsapp')
      .set('Authorization', 'Bearer valid_token')
      .send({ wabaId: 'waba-123' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to update WhatsApp config');
  });
});

// ─── PUT /api/business/social-media ──────────────────────────────────────────

describe('PUT /api/business/social-media', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.business.update.mockResolvedValue(mockBusiness);
  });

  it('should update social media tokens', async () => {
    const res = await request(app)
      .put('/api/business/social-media')
      .set('Authorization', 'Bearer valid_token')
      .send({
        fbPageId: 'fb-page-1',
        fbAccessToken: 'fb-token',
        igUserId: 'ig-user-1',
        igAccessToken: 'ig-token',
      })
      .expect(200);

    expect(res.body.success).toBe(true);

    const { encryptBusinessData } = jest.requireMock('../src/server/services/secrets.service');
    expect(encryptBusinessData).toHaveBeenCalledWith(
      expect.objectContaining({
        fbPageId: 'fb-page-1',
        fbAccessToken: 'fb-token',
        igUserId: 'ig-user-1',
        igAccessToken: 'ig-token',
      }),
    );
  });

  it('should return 403 for non-OWNER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .put('/api/business/social-media')
      .set('Authorization', 'Bearer member_token')
      .send({ fbPageId: 'fb-page-1' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it('should return 500 when update fails', async () => {
    mockPrisma.business.update.mockRejectedValue(new Error('Social media update failed'));

    const res = await request(app)
      .put('/api/business/social-media')
      .set('Authorization', 'Bearer valid_token')
      .send({ fbPageId: 'fb-page-1' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to update social media config');
  });
});

// ─── GET /api/business/pipelines ─────────────────────────────────────────────

describe('GET /api/business/pipelines', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.pipeline.findMany.mockResolvedValue([mockPipeline]);
  });

  it('should list pipelines', async () => {
    const res = await request(app)
      .get('/api/business/pipelines')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      name: 'Sales Pipeline',
      stages: ['Lead', 'Qualified', 'Proposal', 'Closed'],
    });

    expect(mockPrisma.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('should return empty array when no pipelines exist', async () => {
    mockPrisma.pipeline.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/business/pipelines')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('should return 500 when query fails', async () => {
    mockPrisma.pipeline.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/business/pipelines')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to fetch pipelines');
  });
});

// ─── POST /api/business/pipelines ────────────────────────────────────────────

describe('POST /api/business/pipelines', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.pipeline.create.mockResolvedValue(mockPipeline);
  });

  it('should create a pipeline', async () => {
    const res = await request(app)
      .post('/api/business/pipelines')
      .set('Authorization', 'Bearer valid_token')
      .send({
        name: 'Sales Pipeline',
        stages: ['Lead', 'Qualified', 'Proposal', 'Closed'],
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'Sales Pipeline',
    });

    expect(mockPrisma.pipeline.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          name: 'Sales Pipeline',
          stages: ['Lead', 'Qualified', 'Proposal', 'Closed'],
        }),
      }),
    );
  });

  it('should create pipeline with empty stages', async () => {
    const pipelineNoStages = { ...mockPipeline, stages: [] };
    mockPrisma.pipeline.create.mockResolvedValue(pipelineNoStages);

    const res = await request(app)
      .post('/api/business/pipelines')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Simple Pipeline' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.pipeline.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stages: [],
        }),
      }),
    );
  });

  it('should return 500 when creation fails', async () => {
    mockPrisma.pipeline.create.mockRejectedValue(new Error('Creation failed'));

    const res = await request(app)
      .post('/api/business/pipelines')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Pipeline' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to create pipeline');
  });
});
